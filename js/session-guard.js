/**
 * GYMONIC — Session Guard v2 (SmartLock Edition)
 *
 * Person locking uses a 4-signal confidence scoring system:
 *   Signal 1: Skeleton Size Score     (0–40 pts) — always on, closest to camera
 *   Signal 2: Body Proportion Score   (0–40 pts) — if body signature calibrated
 *   Signal 3: Face Match Score        (0–20 pts) — if face descriptor stored (optional)
 *   Signal 4: Spatial Zone Bonus      (0–10 pts) — learned position memory
 *
 * Other robustness features (unchanged):
 *   5. No-person detected  → auto-pause + voice prompt
 *   6. Occlusion           → fallback to last known good angles
 *   7. Low light           → canvas brightness analysis + warning
 *   8. Frame drops         → adaptive processing frequency
 */

export class SessionGuard {
  constructor(opts = {}) {
    // ── Tuning ──────────────────────────────────────────────────────
    this.noPerson_pauseAfterMs   = opts.noPerson_pauseAfterMs  ?? 1500;
    this.noPerson_resumeAfterMs  = opts.noPerson_resumeAfterMs ?? 300;
    this.lightCheckIntervalMs    = opts.lightCheckIntervalMs   ?? 3000;
    this.lightThreshold          = opts.lightThreshold         ?? 40;
    this.targetFPS               = opts.targetFPS              ?? 30;
    this.minFPS                  = opts.minFPS                 ?? 12;
    this.lockRecheckEvery        = opts.lockRecheckEvery       ?? 30;  // frames

    // ── SmartLock State ──────────────────────────────────────────────
    this.isPaused               = false;
    this.pauseReason            = '';
    this.primaryPersonIndex     = null;
    this._framesSinceLockCheck  = 0;

    // Signal 2 — body proportions (set from calibration)
    this.bodySignature          = null;  // { shoulderRatio, upperArmRatio, forearmRatio, upperLegRatio, lowerLegRatio, shoulderHipRatio, armspanRatio }

    // Signal 3 — face descriptor (set from face-api.js scan, optional)
    this.faceDescriptor         = null;  // Float32Array(128) from face-api.js

    // Signal 4 — spatial zone (learned from first few frames)
    this._spatialHistory        = [];    // recent hip-center X positions
    this._learnedZoneX          = null;  // learned X center
    this._learnedZoneRadius     = 0.15;  // normalised tolerance

    // ── No-person timers ─────────────────────────────────────────────
    this._noPerson_since        = null;
    this._person_since          = null;

    // ── Light detection ──────────────────────────────────────────────
    this._lastLightCheck        = 0;
    this._isLowLight            = false;

    // ── Frame-drop tracking ──────────────────────────────────────────
    this._frameTimestamps       = [];
    this._frameDropSkip         = 1;
    this._consecutiveDrops      = 0;

    // ── Occlusion fallback ───────────────────────────────────────────
    this._lastGoodAngles        = null;
    this._occludedFrames        = 0;
    this._maxOccludedFallback   = 10;

    // Callbacks
    this.onPause   = null;
    this.onResume  = null;
    this.onWarning = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: Load body signature from calibration data
  // ═══════════════════════════════════════════════════════════════════
  setBodySignature(sig) {
    this.bodySignature = sig;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC: Load face descriptor (optional face-api.js Float32Array)
  // ═══════════════════════════════════════════════════════════════════
  setFaceDescriptor(descriptor) {
    this.faceDescriptor = descriptor;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIMARY ENTRY — call every frame
  // ═══════════════════════════════════════════════════════════════════
  process(now, result, smoothedAngles, videoElement) {
    // 1. Frame-drop handling
    if (this._shouldSkipFrame(now)) {
      return { skip: true, landmarks: null, angles: null, status: 'throttled' };
    }

    // 2. Low-light check (throttled)
    if (now - this._lastLightCheck > this.lightCheckIntervalMs && videoElement) {
      this._checkLightLevel(videoElement, now);
    }

    const allLandmarks = result?.landmarks ?? [];

    // 3. No-person detection
    if (allLandmarks.length === 0) {
      return this._handleNoPerson(now, smoothedAngles);
    }

    // Person present — handle resume
    if (this._noPerson_since !== null) {
      if (!this._person_since) this._person_since = now;
      if (now - this._person_since < this.noPerson_resumeAfterMs) {
        return { skip: true, landmarks: null, angles: null, status: 'returning' };
      }
    }
    this._noPerson_since = null;
    this._person_since   = null;

    if (this.isPaused && this.pauseReason === 'no_person') {
      this.isPaused    = false;
      this.pauseReason = '';
      if (this.onResume) this.onResume();
    }

    // 4. SmartLock — score all detected people, pick the best match
    this._framesSinceLockCheck++;
    const recheck = this._framesSinceLockCheck >= this.lockRecheckEvery
                 || this.primaryPersonIndex === null
                 || this.primaryPersonIndex >= allLandmarks.length;

    if (recheck) {
      this._framesSinceLockCheck = 0;
      this.primaryPersonIndex = this._smartLock(allLandmarks);
    }

    const lockedLandmarks = allLandmarks[this.primaryPersonIndex];

    // Learn spatial zone from first 60 frames after lock
    this._learnSpatialZone(lockedLandmarks);

    // 5. Occlusion fallback
    const { angles, occluded } = this._handleOcclusion(lockedLandmarks, smoothedAngles);

    return {
      skip:       false,
      landmarks:  lockedLandmarks,
      angles,
      occluded,
      isLowLight: this._isLowLight,
      isPaused:   this.isPaused,
      status:     this.isPaused ? 'paused' : (this._isLowLight ? 'low_light' : 'ok'),
      lockScore:  this._lastLockScore,
      personCount: allLandmarks.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // SMARTLOCK — Score every detected person, return index of best match
  // ═══════════════════════════════════════════════════════════════════
  _smartLock(allLandmarks) {
    if (allLandmarks.length === 1) {
      this._lastLockScore = 110;
      return 0;
    }

    let bestIdx   = 0;
    let bestScore = -Infinity;

    allLandmarks.forEach((lms, i) => {
      const s1 = this._scoreSkeletonSize(lms, allLandmarks);    // 0–40 pts
      const s2 = this._scoreBodyProportions(lms);               // 0–40 pts
      const s3 = 0;                                             // 0–20 pts (face — Phase 3)
      const s4 = this._scoreSpatialZone(lms);                   // 0–10 pts

      const total = s1 + s2 + s3 + s4;

      if (total > bestScore) {
        bestScore = total;
        bestIdx   = i;
      }
    });

    this._lastLockScore = bestScore;

    if (allLandmarks.length > 1 && this.onWarning) {
      this.onWarning(`${allLandmarks.length} people detected — SmartLock score: ${Math.round(bestScore)}/110`);
    }

    return bestIdx;
  }

  // ──────────────────────────────────────────────────────────────────
  // Signal 1: Skeleton Size Score (0–40 pts)
  // Largest skeleton = closest to camera = most likely you
  // ──────────────────────────────────────────────────────────────────
  _scoreSkeletonSize(lms, allLandmarks) {
    const size = this._getSkeletonSize(lms);
    const sizes = allLandmarks.map(l => this._getSkeletonSize(l));
    const maxSize = Math.max(...sizes);

    if (maxSize < 0.001) return 20; // can't differentiate, give neutral score

    const ratio = size / maxSize; // 0–1, 1 = largest
    return Math.round(ratio * 40);
  }

  _getSkeletonSize(lms) {
    // Torso diagonal: shoulder-mid to ankle-mid (scale proxy)
    const ls = lms[11], rs = lms[12]; // shoulders
    const la = lms[27], ra = lms[28]; // ankles
    if (!ls || !rs || !la || !ra) return 0;

    const shoulderMidX = (ls.x + rs.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const ankleMidX    = (la.x + ra.x) / 2;
    const ankleMidY    = (la.y + ra.y) / 2;

    const dx = shoulderMidX - ankleMidX;
    const dy = shoulderMidY - ankleMidY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ──────────────────────────────────────────────────────────────────
  // Signal 2: Body Proportion Score (0–40 pts)
  // Compare 7 limb ratios to stored calibration signature
  // ──────────────────────────────────────────────────────────────────
  _scoreBodyProportions(lms) {
    if (!this.bodySignature) return 0;

    const sig = this._computeBodySignature(lms);
    if (!sig) return 0;

    // Euclidean distance between signatures (7-dim vector)
    const keys = Object.keys(this.bodySignature);
    let sumSqDiff = 0;
    let validKeys = 0;

    for (const k of keys) {
      if (sig[k] != null && this.bodySignature[k] != null) {
        const diff = sig[k] - this.bodySignature[k];
        sumSqDiff += diff * diff;
        validKeys++;
      }
    }

    if (validKeys === 0) return 0;

    const rmsd = Math.sqrt(sumSqDiff / validKeys);
    // rmsd 0.0 = perfect match → 40 pts; rmsd >= 0.25 = no match → 0 pts
    const score = Math.max(0, 40 - (rmsd / 0.25) * 40);
    return Math.round(score);
  }

  // Compute 7 scale-invariant body ratios from landmarks
  _computeBodySignature(lms) {
    const ls = lms[11], rs = lms[12]; // shoulders
    const lh = lms[23], rh = lms[24]; // hips
    const le = lms[13], re = lms[14]; // elbows
    const lw = lms[15], rw = lms[16]; // wrists
    const lk = lms[25], rk = lms[26]; // knees
    const la = lms[27], ra = lms[28]; // ankles

    const MIN_VIS = 0.4;
    const vis = (lm) => (lm?.visibility ?? 0) >= MIN_VIS;

    if (!vis(ls) || !vis(rs) || !vis(lh) || !vis(rh)) return null;

    const dist = (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);

    const sMid   = { x: (ls.x+rs.x)/2, y: (ls.y+rs.y)/2 };
    const hMid   = { x: (lh.x+rh.x)/2, y: (lh.y+rh.y)/2 };
    const torso  = dist(sMid, hMid);

    if (torso < 0.01) return null;

    const sig = {};

    // 1. Shoulder width / torso
    sig.shoulderRatio = dist(ls, rs) / torso;

    // 2. Shoulder width / hip width
    sig.shoulderHipRatio = vis(lh) && vis(rh) ? dist(ls, rs) / dist(lh, rh) : null;

    // 3. Upper arm / torso (average both sides)
    const uaL = vis(ls) && vis(le) ? dist(ls, le) / torso : null;
    const uaR = vis(rs) && vis(re) ? dist(rs, re) / torso : null;
    sig.upperArmRatio = uaL && uaR ? (uaL+uaR)/2 : (uaL ?? uaR);

    // 4. Forearm / torso
    const faL = vis(le) && vis(lw) ? dist(le, lw) / torso : null;
    const faR = vis(re) && vis(rw) ? dist(re, rw) / torso : null;
    sig.forearmRatio = faL && faR ? (faL+faR)/2 : (faL ?? faR);

    // 5. Upper leg / torso
    const ulL = vis(lh) && vis(lk) ? dist(lh, lk) / torso : null;
    const ulR = vis(rh) && vis(rk) ? dist(rh, rk) / torso : null;
    sig.upperLegRatio = ulL && ulR ? (ulL+ulR)/2 : (ulL ?? ulR);

    // 6. Lower leg / torso
    const llL = vis(lk) && vis(la) ? dist(lk, la) / torso : null;
    const llR = vis(rk) && vis(ra) ? dist(rk, ra) / torso : null;
    sig.lowerLegRatio = llL && llR ? (llL+llR)/2 : (llL ?? llR);

    // 7. Arm span / torso (wrist to wrist)
    sig.armspanRatio = vis(lw) && vis(rw) ? dist(lw, rw) / torso : null;

    return sig;
  }

  // PUBLIC: Compute and return body signature from landmarks (for calibration to store)
  computeBodySignature(landmarks) {
    return this._computeBodySignature(landmarks);
  }

  // ──────────────────────────────────────────────────────────────────
  // Signal 3: Face Match Score — placeholder (0 pts until face-api.js added)
  // Will be enabled in Phase 3 when face-api.js is loaded
  // ──────────────────────────────────────────────────────────────────
  _scoreFaceMatch(/* lms */) {
    // Reserved for face-api.js integration
    // When faceDescriptor is set and face-api detects faces per-person,
    // this will return 0–20 based on descriptor distance
    return 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // Signal 4: Spatial Zone Score (0–10 pts)
  // Bonus for person in your learned position
  // ──────────────────────────────────────────────────────────────────
  _learnSpatialZone(lms) {
    if (!lms) return;
    const lh = lms[23], rh = lms[24];
    if (!lh || !rh) return;
    const hipX = (lh.x + rh.x) / 2;

    this._spatialHistory.push(hipX);
    if (this._spatialHistory.length > 60) this._spatialHistory.shift();

    // Update learned zone center as running average
    if (this._spatialHistory.length >= 10) {
      this._learnedZoneX = this._spatialHistory.reduce((a,b)=>a+b,0) / this._spatialHistory.length;
    }
  }

  _scoreSpatialZone(lms) {
    if (this._learnedZoneX === null) return 5; // neutral until learned
    const lh = lms[23], rh = lms[24];
    if (!lh || !rh) return 0;

    const hipX = (lh.x + rh.x) / 2;
    const dist  = Math.abs(hipX - this._learnedZoneX);

    if (dist <= this._learnedZoneRadius * 0.5) return 10;       // In your zone
    if (dist <= this._learnedZoneRadius)       return 5;        // Near your zone
    return 0;                                                    // Out of zone
  }

  // ─── Frame-drop handling ──────────────────────────────────────────
  _shouldSkipFrame(now) {
    this._frameTimestamps.push(now);
    if (this._frameTimestamps.length > 30) this._frameTimestamps.shift();
    if (this._frameTimestamps.length < 5) return false;

    const len     = this._frameTimestamps.length;
    const elapsed = this._frameTimestamps[len-1] - this._frameTimestamps[Math.max(0,len-10)];
    const fps     = (Math.min(len,10) / elapsed) * 1000;

    if (fps < this.minFPS) {
      this._consecutiveDrops++;
      this._frameDropSkip = fps < 8 ? 4 : fps < 12 ? 3 : fps < 18 ? 2 : 1;
      if (this._consecutiveDrops === 5 && this.onWarning) {
        this.onWarning(`Low frame rate (${Math.round(fps)} FPS) — reducing processing load`);
      }
    } else {
      this._consecutiveDrops = 0;
      this._frameDropSkip    = 1;
    }

    const frameNum = this._frameTimestamps.length;
    return this._frameDropSkip > 1 && (frameNum % this._frameDropSkip !== 0);
  }

  getCurrentFPS() {
    const len = this._frameTimestamps.length;
    if (len < 5) return 0;
    const elapsed = this._frameTimestamps[len-1] - this._frameTimestamps[Math.max(0,len-10)];
    return Math.round((Math.min(len,10) / elapsed) * 1000);
  }

  // ─── No-person handling ───────────────────────────────────────────
  _handleNoPerson(now, lastAngles) {
    if (this._noPerson_since === null) this._noPerson_since = now;
    this._person_since = null;

    const missingFor = now - this._noPerson_since;
    if (!this.isPaused && missingFor > this.noPerson_pauseAfterMs) {
      this.isPaused    = true;
      this.pauseReason = 'no_person';
      if (this.onPause) this.onPause('no_person');
    }

    return {
      skip: false, landmarks: null,
      angles: lastAngles, occluded: true,
      isPaused: this.isPaused, status: 'no_person', missingMs: missingFor,
    };
  }

  // ─── Occlusion fallback ───────────────────────────────────────────
  _handleOcclusion(landmarks, smoothedAngles) {
    if (!landmarks) {
      this._occludedFrames++;
      const angles = this._occludedFrames <= this._maxOccludedFallback
        ? this._lastGoodAngles : null;
      return { angles, occluded: true };
    }

    const keyJoints = [11,12,13,14,15,16,23,24,25,26];
    const avgVis = keyJoints.reduce((s,i) => s + (landmarks[i]?.visibility ?? 0), 0) / keyJoints.length;

    if (avgVis < 0.45) {
      this._occludedFrames++;
      if (this._occludedFrames <= this._maxOccludedFallback && this._lastGoodAngles) {
        return { angles: this._lastGoodAngles, occluded: true };
      }
      return { angles: smoothedAngles, occluded: true };
    }

    this._occludedFrames = 0;
    this._lastGoodAngles = { ...smoothedAngles };
    return { angles: smoothedAngles, occluded: false };
  }

  // ─── Low-light detection ──────────────────────────────────────────
  _checkLightLevel(videoElement, now) {
    this._lastLightCheck = now;
    try {
      const canvas  = document.createElement('canvas');
      canvas.width  = 32; canvas.height = 18;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoElement, 0, 0, 32, 18);
      const data = ctx.getImageData(0, 0, 32, 18).data;

      let total = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        total += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      }
      const avgBrightness = total / pixels;
      const wasLowLight   = this._isLowLight;
      this._isLowLight    = avgBrightness < this.lightThreshold;

      if (this._isLowLight && !wasLowLight && this.onWarning) {
        this.onWarning('Low light detected — please improve lighting for better accuracy');
      } else if (!this._isLowLight && wasLowLight && this.onWarning) {
        this.onWarning('Lighting restored — AI tracking resumed at full accuracy');
      }
    } catch (e) { /* Canvas tainted — ignore */ }
  }

  // ─── Public helpers ───────────────────────────────────────────────
  reset() {
    this.isPaused               = false;
    this.pauseReason            = '';
    this.primaryPersonIndex     = null;
    this._framesSinceLockCheck  = 0;
    this._noPerson_since        = null;
    this._person_since          = null;
    this._lastGoodAngles        = null;
    this._occludedFrames        = 0;
    this._frameTimestamps       = [];
    this._frameDropSkip         = 1;
    this._consecutiveDrops      = 0;
    this._isLowLight            = false;
    this._lastLightCheck        = 0;
    this._spatialHistory        = [];
    // Note: bodySignature and faceDescriptor are NOT reset — they persist across sessions
  }

  getStatus() {
    return {
      isPaused:    this.isPaused,
      pauseReason: this.pauseReason,
      fps:         this.getCurrentFPS(),
      frameSkip:   this._frameDropSkip,
      isLowLight:  this._isLowLight,
      occluded:    this._occludedFrames > 0,
      lockScore:   this._lastLockScore ?? 0,
      hasBodySig:  !!this.bodySignature,
      hasFaceSig:  !!this.faceDescriptor,
      learnedZone: this._learnedZoneX,
    };
  }
}
