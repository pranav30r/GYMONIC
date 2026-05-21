/**
 * GYMONIC — Calibration System
 * Camera placement guide + user body calibration (height/limb ratio).
 */

const CALIB_KEY = 'gymonic_calibration';

// ─── Landmark indices needed for calibration ────────────────────────
const LM = {
  NOSE: 0, LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
};

export class CalibrationSystem {
  constructor() {
    this.data = this._load();
  }

  // ─── Camera Placement Checks ───────────────────────────────────────
  /**
   * Analyse landmarks to determine if camera is well-positioned.
   * Returns { ok, issues[] } where issues are human-readable strings.
   */
  checkCameraPlacement(landmarks) {
    if (!landmarks || landmarks.length < 29) {
      return { ok: false, issues: ['Cannot detect your body. Step back until your full body is visible.'] };
    }

    const issues = [];

    // 1. Visibility check — are key landmarks visible?
    const keyPoints = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
    const avgVisibility = keyPoints.reduce((s, i) => s + (landmarks[i]?.visibility || 0), 0) / keyPoints.length;

    if (avgVisibility < 0.6) {
      issues.push('Move closer to the camera or improve lighting.');
    }

    // 2. Distance check — shoulders should be ~20–50% of frame width
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    if (ls && rs) {
      const shoulderWidth = Math.abs(ls.x - rs.x); // normalized 0–1
      if (shoulderWidth < 0.12) {
        issues.push('Too far from camera — move closer.');
      } else if (shoulderWidth > 0.55) {
        issues.push('Too close to camera — step back 1–2 meters.');
      }
    }

    // 3. Vertical framing — check body fills frame vertically
    const nose = landmarks[LM.NOSE];
    const leftAnkle = landmarks[LM.LEFT_ANKLE];
    const rightAnkle = landmarks[LM.RIGHT_ANKLE];

    if (nose && (leftAnkle || rightAnkle)) {
      const ankle = leftAnkle || rightAnkle;
      const bodyHeight = Math.abs(ankle.y - nose.y); // normalized
      if (bodyHeight < 0.45) {
        issues.push('Can\'t see your full body — move camera back or lower it.');
      }
    }

    // 4. Angle check — shoulders should be roughly level (camera not tilted)
    if (ls && rs) {
      const tilt = Math.abs(ls.y - rs.y);
      if (tilt > 0.08) {
        issues.push('Camera appears tilted — straighten it horizontally.');
      }
    }

    return { ok: issues.length === 0, issues };
  }

  // ─── User Body Calibration ────────────────────────────────────────
  /**
   * Capture limb ratios from a "T-pose" reference frame.
   * Stores arm and leg lengths as pixel ratios for better angle thresholds.
   */
  calibrateFromPose(landmarks, sessionGuard = null) {
    if (!landmarks || landmarks.length < 29) return false;

    // Upper arm ratio (shoulder→elbow)
    const leftUpperArm  = this._dist(landmarks[LM.LEFT_SHOULDER],  landmarks[LM.LEFT_ELBOW]);
    const rightUpperArm = this._dist(landmarks[LM.RIGHT_SHOULDER], landmarks[LM.RIGHT_ELBOW]);

    // Forearm ratio (elbow→wrist)
    const leftForearm  = this._dist(landmarks[LM.LEFT_ELBOW],  landmarks[LM.LEFT_WRIST]);
    const rightForearm = this._dist(landmarks[LM.RIGHT_ELBOW], landmarks[LM.RIGHT_WRIST]);

    // Thigh ratio (hip→knee)
    const leftThigh  = this._dist(landmarks[LM.LEFT_HIP],  landmarks[LM.LEFT_KNEE]);
    const rightThigh = this._dist(landmarks[LM.RIGHT_HIP], landmarks[LM.RIGHT_KNEE]);

    // Torso height (shoulder→hip)
    const leftTorso  = this._dist(landmarks[LM.LEFT_SHOULDER],  landmarks[LM.LEFT_HIP]);
    const rightTorso = this._dist(landmarks[LM.RIGHT_SHOULDER], landmarks[LM.RIGHT_HIP]);

    const torso = (leftTorso + rightTorso) / 2;
    if (torso < 0.01) return false; // degenerate

    // Store ratios relative to torso length (scale-invariant)
    this.data.limbRatios = {
      upperArmRatio: ((leftUpperArm + rightUpperArm) / 2) / torso,
      forearmRatio:  ((leftForearm  + rightForearm)  / 2) / torso,
      thighRatio:    ((leftThigh    + rightThigh)    / 2) / torso,
      torsoLength:   torso,
    };

    // ── SmartLock Signal 2: store full 7-ratio body signature ──────────
    if (sessionGuard) {
      const sig = sessionGuard.computeBodySignature(landmarks);
      if (sig) {
        this.data.bodySignature = sig;
        sessionGuard.setBodySignature(sig);
      }
    } else {
      // Compute and store even if guard not available yet — loaded on next session start
      this.data.bodySignature = this._computeSignatureFromRaw(landmarks, torso);
    }

    this.data.calibratedAt = new Date().toISOString();
    this._save();
    return true;
  }

  // Build the 7-ratio signature directly (mirror of SessionGuard._computeBodySignature)
  _computeSignatureFromRaw(lms, torso) {
    const d = (a, b) => this._dist(lms[a], lms[b]);
    const sMid = { x: (lms[11].x+lms[12].x)/2, y: (lms[11].y+lms[12].y)/2 };
    const hMid = { x: (lms[23].x+lms[24].x)/2, y: (lms[23].y+lms[24].y)/2 };
    const t    = this._dist(sMid, hMid) || torso;
    return {
      shoulderRatio:    d(11,12) / t,
      shoulderHipRatio: d(11,12) / (d(23,24) || 1),
      upperArmRatio:    ((d(11,13)+d(12,14))/2) / t,
      forearmRatio:     ((d(13,15)+d(14,16))/2) / t,
      upperLegRatio:    ((d(23,25)+d(24,26))/2) / t,
      lowerLegRatio:    ((d(25,27)+d(26,28))/2) / t,
      armspanRatio:     d(15,16) / t,
    };
  }


  setUserHeight(cm) {
    this.data.heightCm = cm;
    this._save();
  }

  getBodySignature() {
    return this.data.bodySignature || null;
  }

  isCalibrated() {
    return !!this.data.limbRatios;
  }

  getLimbRatios() {
    return this.data.limbRatios || null;
  }

  getUserHeight() {
    return this.data.heightCm || null;
  }

  getCalibrationAge() {
    if (!this.data.calibratedAt) return null;
    const ms = Date.now() - new Date(this.data.calibratedAt).getTime();
    return Math.round(ms / 86400000); // days
  }

  reset() {
    this.data = { heightCm: null, limbRatios: null, calibratedAt: null };
    this._save();
  }

  _dist(a, b) {
    if (!a || !b) return 0;
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(CALIB_KEY) || 'null') || { heightCm: null, limbRatios: null, calibratedAt: null };
    } catch { return { heightCm: null, limbRatios: null, calibratedAt: null }; }
  }

  _save() {
    localStorage.setItem(CALIB_KEY, JSON.stringify(this.data));
  }
}
