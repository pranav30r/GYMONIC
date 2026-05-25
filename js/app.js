/**
 * GYMONIC — Main Application Orchestrator (v3)
 * Full flow: Home → Body Parts → Workout Builder → Session → Summary
 */

import { computeAllAngles, isBodyHorizontal } from './angle-engine.js';
import { AngleSmootherBank } from './smoother.js';
import { createFSM } from './exercise-fsm.js';
import { FormValidator, FORM_COLORS } from './form-validator.js';
import { SkeletonRenderer, HUDRenderer } from './renderer.js';
import { VoiceCoach } from './voice-coach.js';
import { BODY_PARTS, EXERCISES, generateWorkout, getAllExercises } from './exercise-database.js';
import { ProgressTracker } from './progress-tracker.js';
import { GoalSystem, GOAL_TYPES } from './goals.js';
import { AnalyticsEngine } from './analytics.js';
import { GamificationSystem } from './gamification.js';
import { AdaptiveAI } from './adaptive-ai.js';
import { CalibrationSystem } from './calibration.js';
import { ConfidenceFilter } from './confidence-filter.js';
import { SessionGuard } from './session-guard.js';
import { RestTimer } from './rest-timer.js';
import { FatigueDetector } from './fatigue-detector.js';
import { WrongExerciseDetector } from './wrong-exercise-detector.js';

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .catch(e => console.warn('[PWA] Service worker registration failed:', e));
}

// ─── Constants ──────────────────────────────────────────────────────
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

// ─── State ──────────────────────────────────────────────────────────
const state = {
  poseLandmarker: null,
  videoStream: null,

  // Selection
  selectedBodyParts: new Set(),
  workout: [],
  currentExerciseIndex: 0,
  currentSet: 1,

  // Session
  isRunning: false,
  fsm: null,
  validator: null,
  smoother: null,
  skeletonRenderer: null,
  hudRenderer: null,
  frameCount: 0,
  fpsTimestamp: 0,
  fps: 0,
  facingMode: 'user',
  voiceCoach: new VoiceCoach(),
  animationFrameId: null,
  lastTimestamp: 0,

  // Results
  sessionStartTime: null,
  allRepScores: [],
  totalReps: 0,
  exercisesCompleted: 0,
  progressTracker: new ProgressTracker(),
  goalSystem: null,
  analytics: null,
  gamification: null,
  adaptiveAI: null,
  calibration: new CalibrationSystem(),
  confidenceFilter: null,
  lastConfidenceWarning: '',
  sessionGuard: null,

  // New feature modules
  restTimer: new RestTimer({ defaultDuration: 60 }),
  fatigueDetector: null,          // Created per-session
  wrongExerciseDetector: null,    // Created per-session
  _repStartTime: null,            // For fatigue tracking
};

// ─── DOM Helpers ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = ['home-screen', 'bodypart-screen', 'workout-screen', 'single-screen', 'session-screen', 'summary-screen', 'history-screen', 'goals-screen', 'analytics-screen', 'achievements-screen', 'calibration-screen'];

function showScreen(screenId) {
  screens.forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('active', id === screenId);
  });
}

// ─── Init MediaPipe ─────────────────────────────────────────────────
async function initMediaPipe() {
  $('loading-text').textContent = 'Loading AI Vision Module...';
  const { PoseLandmarker, FilesetResolver } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'
  );
  $('loading-text').textContent = 'Downloading Pose Model...';
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN);
  state.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 3,  // Bug fix: allow up to 3 — SessionGuard locks to primary
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  $('loading-text').textContent = 'Ready!';
  setTimeout(() => $('loading-overlay').classList.add('hidden'), 500);
}

// ─── Camera ─────────────────────────────────────────────────────────
async function startCamera() {
  if (state.videoStream) state.videoStream.getTracks().forEach(t => t.stop());
  try {
    state.videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    $('camera-feed').srcObject = state.videoStream;
    await $('camera-feed').play();

    // ── Warm up speechSynthesis on first user gesture ──
    // Browsers require a user interaction before TTS works.
    // Sending a silent utterance here satisfies that requirement.
    if (!state._speechWarmedUp) {
      state._speechWarmedUp = true;
      const warmup = new SpeechSynthesisUtterance('');
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
    }

    // Apply current rotation (DroidCam / external cam users may need 90°)
    if (typeof _applyCameraTransform === 'function') _applyCameraTransform();
  } catch (err) {
    console.error('Camera error:', err);
    // Show a styled toast instead of a blocking alert
    showToast('⚠️ Camera denied — allow camera access and refresh');
    // Also show a visible banner in the session screen
    const overlay = $('session-pause-overlay');
    const txt = $('pause-overlay-text');
    if (overlay && txt) {
      overlay.style.display = 'flex';
      txt.textContent = '📷 Camera blocked — allow access in browser settings';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SCREEN 1: HOME
// ═══════════════════════════════════════════════════════════════════
$('btn-quick-workout').addEventListener('click', () => {
  // Quick Workout: use AdaptiveAI if history exists, otherwise body-part selection
  if (state.adaptiveAI && state.progressTracker.getTotalWorkouts() >= 3) {
    const smart = state.adaptiveAI.generateSmartWorkout(getAllExercises(), BODY_PARTS);
    if (smart && smart.length > 0) {
      state.workout = smart;
      // Collect body parts from the smart workout
      state.selectedBodyParts = new Set(
        smart.flatMap(ex => ex.bodyParts || [ex.primaryMuscle]).filter(Boolean)
      );
      renderWorkoutList();
      showToast('🤖 Smart workout generated based on your history!');
      showScreen('workout-screen');
      return;
    }
  }
  // Fallback: body-part selection
  showScreen('bodypart-screen');
});
$('btn-custom-workout').addEventListener('click', () => showScreen('bodypart-screen'));
$('btn-single-exercise').addEventListener('click', () => {
  renderSingleExerciseGrid();
  showScreen('single-screen');
});

// ═══════════════════════════════════════════════════════════════════
// SCREEN 2: BODY PART SELECTION
// ═══════════════════════════════════════════════════════════════════
function renderBodyPartGrid() {
  const grid = $('bodypart-grid');
  grid.innerHTML = '';

  for (const part of BODY_PARTS) {
    const exerciseCount = EXERCISES.filter(e => e.primaryMuscle === part.id).length;
    const card = document.createElement('div');
    card.className = 'bodypart-card';
    card.dataset.id = part.id;
    card.innerHTML = `
      <span class="bodypart-icon">${part.icon}</span>
      <span class="bodypart-name">${part.name}</span>
      <span class="bodypart-count">${exerciseCount} exercises</span>
    `;
    card.addEventListener('click', () => toggleBodyPart(part.id, card));
    grid.appendChild(card);
  }
}

function toggleBodyPart(partId, card) {
  if (state.selectedBodyParts.has(partId)) {
    state.selectedBodyParts.delete(partId);
    card.classList.remove('selected');
  } else {
    state.selectedBodyParts.add(partId);
    card.classList.add('selected');
  }
  const count = state.selectedBodyParts.size;
  $('selected-count').textContent = `${count} selected`;
  $('btn-generate-workout').disabled = count === 0;
}

$('btn-generate-workout').addEventListener('click', () => {
  state.workout = generateWorkout([...state.selectedBodyParts]);
  renderWorkoutList();
  showScreen('workout-screen');
});

$('btn-back-bodypart').addEventListener('click', () => {
  state.selectedBodyParts.clear();
  $('bodypart-grid').querySelectorAll('.bodypart-card').forEach(c => c.classList.remove('selected'));
  $('selected-count').textContent = '0 selected';
  $('btn-generate-workout').disabled = true;
  showScreen('home-screen');
});

// ═══════════════════════════════════════════════════════════════════
// SCREEN 3: WORKOUT BUILDER
// ═══════════════════════════════════════════════════════════════════
function renderWorkoutList() {
  const list = $('workout-list');
  list.innerHTML = '';

  state.workout.forEach((ex, index) => {
    const item = document.createElement('div');
    item.className = 'workout-item';
    item.dataset.index = index;
    item.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="workout-item-icon">${ex.icon}</span>
      <div class="workout-item-info">
        <div class="workout-item-name">${ex.name}</div>
        <div class="workout-item-detail">${ex.description}</div>
        ${ex.hasAIValidation ? '<span class="workout-item-ai">🤖 AI Form Check</span>' : ''}
      </div>
      <div class="workout-item-sets">
        <div>
          <input type="number" class="sets-input" value="${ex.sets}" min="1" max="10" data-field="sets" data-index="${index}">
          <div class="sets-label">sets</div>
        </div>
        <span style="color: var(--text-muted)">×</span>
        <div>
          <input type="number" class="reps-input" value="${ex.reps}" min="1" max="50" data-field="reps" data-index="${index}">
          <div class="sets-label">reps</div>
        </div>
      </div>
      <button class="btn-remove-exercise" data-index="${index}">✕</button>
    `;
    list.appendChild(item);
  });

  // Event listeners for sets/reps inputs
  list.querySelectorAll('.sets-input, .reps-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      const field = e.target.dataset.field;
      state.workout[idx][field] = parseInt(e.target.value) || 1;
      updateWorkoutSummary();
    });
  });

  // Remove buttons
  list.querySelectorAll('.btn-remove-exercise').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      state.workout.splice(idx, 1);
      renderWorkoutList();
    });
  });

  updateWorkoutSummary();
}

function updateWorkoutSummary() {
  const totalSets = state.workout.reduce((sum, ex) => sum + ex.sets, 0);
  $('workout-summary').textContent = `${state.workout.length} exercises • ${totalSets} sets`;
  $('btn-start-workout').disabled = state.workout.length === 0;
}

// Add Exercise Modal
$('btn-add-exercise').addEventListener('click', () => {
  renderAddExerciseModal();
  $('add-exercise-modal').classList.add('active');
});

$('btn-close-modal').addEventListener('click', () => {
  $('add-exercise-modal').classList.remove('active');
});

$('exercise-search').addEventListener('input', (e) => {
  renderAddExerciseModal(e.target.value);
});

function renderAddExerciseModal(search = '') {
  const list = $('exercise-add-list');
  list.innerHTML = '';
  const usedIds = new Set(state.workout.map(e => e.id));
  const allExercises = getAllExercises();
  const filtered = search
    ? allExercises.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : allExercises;

  for (const ex of filtered) {
    const isUsed = usedIds.has(ex.id);
    const item = document.createElement('div');
    item.className = `exercise-add-item ${isUsed ? 'disabled' : ''}`;
    item.innerHTML = `
      <span class="exercise-add-icon">${ex.icon}</span>
      <span class="exercise-add-name">${ex.name}</span>
      <span class="exercise-add-meta">${ex.hasAIValidation ? '🤖 AI' : ''} ${ex.difficulty}</span>
    `;
    if (!isUsed) {
      item.addEventListener('click', () => {
        state.workout.push({ ...ex, sets: ex.defaultSets, reps: ex.defaultReps });
        renderWorkoutList();
        $('add-exercise-modal').classList.remove('active');
        $('exercise-search').value = '';
      });
    }
    list.appendChild(item);
  }
}

$('btn-back-workout').addEventListener('click', () => showScreen('bodypart-screen'));

$('btn-start-workout').addEventListener('click', () => {
  state.currentExerciseIndex = 0;
  state.currentSet = 1;
  state.sessionStartTime = Date.now();
  state.allRepScores = [];
  state.totalReps = 0;
  state.exercisesCompleted = 0;
  startExerciseSession();
});

// ═══════════════════════════════════════════════════════════════════
// SCREEN 5: SINGLE EXERCISE (AI-only)
// ═══════════════════════════════════════════════════════════════════
function renderSingleExerciseGrid() {
  const grid = $('single-exercise-grid');
  grid.innerHTML = '';
  const aiExercises = EXERCISES.filter(e => e.hasAIValidation);

  for (const ex of aiExercises) {
    const card = document.createElement('div');
    card.className = 'exercise-card';
    card.innerHTML = `
      <span class="exercise-card-icon">${ex.icon}</span>
      <span class="exercise-card-name">${ex.name}</span>
      <span class="exercise-card-ai">🤖 AI Form Check</span>
    `;
    card.addEventListener('click', () => {
      state.workout = [{ ...ex, sets: 3, reps: 12 }];
      state.currentExerciseIndex = 0;
      state.currentSet = 1;
      state.sessionStartTime = Date.now();
      state.allRepScores = [];
      state.totalReps = 0;
      state.exercisesCompleted = 0;
      startExerciseSession();
    });
    grid.appendChild(card);
  }
}

$('btn-back-single').addEventListener('click', () => showScreen('home-screen'));

// ═══════════════════════════════════════════════════════════════════
// SCREEN 4: EXERCISE SESSION
// ═══════════════════════════════════════════════════════════════════
// createFSM is imported from exercise-fsm.js — no local duplicate needed

async function startExerciseSession() {
  const exercise = state.workout[state.currentExerciseIndex];
  if (!exercise) { endWorkout(); return; }

  // Initialize — createFSM imported from exercise-fsm.js returns null for unknown ids
  state.fsm = exercise.fsmId ? createFSM(exercise.fsmId) : null;
  state.validator = new FormValidator();
  state.smoother = new AngleSmootherBank();
  state.skeletonRenderer = new SkeletonRenderer($('skeleton-canvas'));
  state.hudRenderer = new HUDRenderer($('hud-canvas'));
  state.isRunning = true;
  state.frameCount = 0;
  state.fpsTimestamp = performance.now();

  // Voice announcement
  state.voiceCoach.speakAnnouncement(`Starting ${exercise.name}. Set ${state.currentSet} of ${exercise.sets}.`);
  state.lastTimestamp = 0;

  // Init confidence filter + session guard for this exercise
  state.confidenceFilter = new ConfidenceFilter({ frameThreshold: 0.55, repThreshold: 0.62 });
  state.sessionGuard = new SessionGuard({ targetFPS: 30, minFPS: 12 });

  // ── SmartLock: load stored body signature (Signal 2) if calibrated ──
  const storedBodySig = state.calibration.getBodySignature();
  if (storedBodySig) {
    state.sessionGuard.setBodySignature(storedBodySig);
  }

  // ── Fatigue + Wrong Exercise detectors ────────────────────────────
  state.fatigueDetector       = new FatigueDetector();
  state.wrongExerciseDetector = new WrongExerciseDetector();
  state._repStartTime         = null;

  state.sessionGuard.onPause = (reason) => {
    if (reason === 'no_person') {
      state.voiceCoach.speakAnnouncement('Come back into frame!');
    }
  };
  state.sessionGuard.onResume = () => {
    state.voiceCoach.speakAnnouncement('Welcome back! Resuming.');
  };
  state.sessionGuard.onWarning = (msg) => {
    showToast('⚠️ ' + msg);
  };
  state.voiceCoach.resetRepTracking();

  // Update UI
  $('exercise-current-name').textContent = exercise.name;
  updateExerciseInfo();
  renderProgressDots();
  showScreen('session-screen');

  await startCamera();
  await new Promise(resolve => {
    $('camera-feed').onloadeddata = resolve;
    if ($('camera-feed').readyState >= 2) resolve();
  });

  processFrame();
}

function updateExerciseInfo() {
  const ex = state.workout[state.currentExerciseIndex];
  if (!ex) return;
  const targetReps = ex.reps;
  const currentReps = state.fsm?.repCount || 0;
  $('exercise-set-info').textContent = `Set ${state.currentSet}/${ex.sets} • ${currentReps}/${targetReps} reps`;
}

function renderProgressDots() {
  const dots = $('exercise-progress-dots');
  dots.innerHTML = '';
  state.workout.forEach((ex, i) => {
    const dot = document.createElement('div');
    dot.className = `progress-dot ${i < state.currentExerciseIndex ? 'completed' : i === state.currentExerciseIndex ? 'current' : 'upcoming'}`;
    dot.title = ex.name;
    dots.appendChild(dot);
  });
}

// ─── Main Processing Loop ───────────────────────────────────────────
function processFrame() {
  if (!state.isRunning) return;

  const now = performance.now();
  const video = $('camera-feed');

  // FPS counter
  state.frameCount++;
  if (now - state.fpsTimestamp >= 1000) {
    state.fps = state.frameCount;
    state.frameCount = 0;
    state.fpsTimestamp = now;
    $('fps-display').textContent = `${state.fps} FPS`;
  }

  if (video.readyState < 2) {
    state.animationFrameId = requestAnimationFrame(processFrame);
    return;
  }

  const timestamp = Math.max(now, state.lastTimestamp + 1);
  state.lastTimestamp = timestamp;
  const exercise = state.workout[state.currentExerciseIndex];

  try {
    const result = state.poseLandmarker.detectForVideo(video, timestamp);

    // ── Pre-compute smoothed angles if landmarks present ──────────
    let preSmoothed = null;
    if (result.landmarks?.length > 0) {
      const raw = computeAllAngles(
        result.landmarks[0].map((lm, idx) => ({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 1.0, index: idx }))
      );
      preSmoothed = state.smoother.smooth(raw, now / 1000);
    }

    // ── Session Guard — handles all 5 robustness cases ───────────
    const guard = state.sessionGuard.process(now, result, preSmoothed, video);

    if (guard.skip) {
      // Frame throttled due to frame-drop degradation
      state.animationFrameId = requestAnimationFrame(processFrame);
      return;
    }

    // ── Show / hide pause overlay ─────────────────────────────────
    const pauseOverlay = $('session-pause-overlay');
    if (guard.isPaused) {
      if (pauseOverlay) {
        pauseOverlay.style.display = 'flex';
        $('pause-overlay-text').textContent =
          guard.status === 'no_person' ? '👀 Step back into frame to resume' : '⏸ Session paused';
      }
      state.animationFrameId = requestAnimationFrame(processFrame);
      return;
    }
    if (pauseOverlay) pauseOverlay.style.display = 'none';

    // ── Low-light banner ─────────────────────────────────────────
    const lightBanner = $('session-light-warning');
    if (lightBanner) lightBanner.style.display = guard.isLowLight ? 'flex' : 'none';

    const landmarks    = guard.landmarks;
    const smoothedAngles = guard.angles;

    if (!landmarks || !smoothedAngles) {
      // Occluded / no pose — clear canvases, show hint
      _clearCanvases(video);
      state.animationFrameId = requestAnimationFrame(processFrame);
      return;
    }

    const horizontal = isBodyHorizontal(landmarks);

    // ── Confidence gate ─────────────────────────────────────────
    const cf = state.confidenceFilter.checkFrame(landmarks, exercise.fsmId || 'default');

    // Camera placement check (every 90 frames)
    if (state.frameCount % 90 === 0) {
      const camCheck = state.calibration.checkCameraPlacement(landmarks);
      state.lastConfidenceWarning = (!camCheck.ok && camCheck.issues.length > 0)
        ? camCheck.issues[0] : '';
    }

    let fsmState = null;
    let formScore = null;

    if (!cf.ok) {
      // Low confidence — freeze FSM, show reason
      fsmState = { phase: 'LOW_CONFIDENCE', repCount: state.fsm?.repCount || 0, exerciseName: exercise.name, activeSide: null };
      formScore = {
        overallScore: 0, color: 'GRAY', colorHex: '#6B6B80', errors: [], topError: null,
        sideInfo: state.lastConfidenceWarning || cf.reason || 'Adjusting...',
      };
    } else if (state.fsm && exercise.hasAIValidation) {
      // AI-validated exercise
      fsmState = exercise.fsmId === 'push_up'
        ? state.fsm.update(smoothedAngles, now, {}, horizontal)
        : state.fsm.update(smoothedAngles, now);

      formScore = state.validator.validate(exercise.fsmId, smoothedAngles, landmarks, fsmState);

      if (formScore.topError) state.voiceCoach.speakCorrection(formScore.topError.message);

      // Gate rep counting on confidence
      if (fsmState.repCompleted && state.confidenceFilter.isRepCountable()) {
        const repScore = state.validator.onRepComplete();
        state.totalReps++;
        playRepSound();
        updateExerciseInfo();
        state.voiceCoach.speakRep(fsmState.repCount, repScore || 0);

        // ── Fatigue detection on rep complete ──────────────────────
        if (state.fatigueDetector) {
          const fatigueAlert = state.fatigueDetector.onRepComplete(repScore || 0, now);
          if (fatigueAlert) {
            showToast(fatigueAlert.message);
            state.voiceCoach.speakAnnouncement(fatigueAlert.message.replace(/[⚠️🛑⏱️]/g, '').trim());
          }
        }

        if (fsmState.repCount >= exercise.reps) autoAdvanceSet();
      } else if (fsmState.repCompleted) {
        console.debug('Rep ignored: low confidence', state.confidenceFilter.getSmoothedConfidence());
      }

      // ── Fatigue: track rep start ────────────────────────────────
      if (fsmState.phase === 'CONCENTRIC' && !state._repStartTime) {
        state._repStartTime = now;
        state.fatigueDetector?.onRepStart(now);
      } else if (fsmState.phase === 'IDLE' || fsmState.phase === 'START') {
        state._repStartTime = null;
      }

      // ── Wrong exercise check (every 15 frames) ──────────────────
      if (state.frameCount % 15 === 0 && state.wrongExerciseDetector && exercise.hasAIValidation) {
        const wrongAlert = state.wrongExerciseDetector.check(exercise.fsmId, smoothedAngles, now);
        if (wrongAlert) showToast(wrongAlert.message);
      }
    } else {
      fsmState  = { phase: 'TRACKING', repCount: 0, exerciseName: exercise.name, activeSide: null };
      formScore = { overallScore: 100, color: 'GRAY', colorHex: '#6C63FF', errors: [], topError: null, sideInfo: '' };
    }

    // Add occlusion hint to sideInfo if guard flagged it
    if (guard.occluded && formScore.sideInfo === '') {
      formScore.sideInfo = '⚠️ Partial occlusion — using fallback';
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    state.skeletonRenderer.render(landmarks, formScore, exercise.fsmId || 'bicep_curl', vw, vh, smoothedAngles);
    $('hud-canvas').width  = $('skeleton-canvas').clientWidth;
    $('hud-canvas').height = $('skeleton-canvas').clientHeight;
    state.hudRenderer.render(formScore, fsmState, $('hud-canvas').width, $('hud-canvas').height);


    // Update set info continuously
    if (fsmState) updateExerciseInfo();

  } catch (err) {
    console.error('Frame error:', err);
  }

  state.animationFrameId = requestAnimationFrame(processFrame);
}
// Canvas clear helper (used when no landmark data available)
function _clearCanvases(video) {
  const skCanvas = $('skeleton-canvas');
  if (skCanvas) {
    skCanvas.width  = video?.videoWidth  || skCanvas.clientWidth;
    skCanvas.height = video?.videoHeight || skCanvas.clientHeight;
    skCanvas.getContext('2d').clearRect(0, 0, skCanvas.width, skCanvas.height);
  }
  const hudCanvas = $('hud-canvas');
  if (hudCanvas) {
    hudCanvas.width  = skCanvas?.clientWidth  || 640;
    hudCanvas.height = skCanvas?.clientHeight || 480;
    const hctx = hudCanvas.getContext('2d');
    hctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  }
}

function showRestTimer(onComplete) {
  const overlay = $('rest-timer-overlay');
  const countdown = $('rest-countdown');
  if (!overlay || !countdown) { onComplete(); return; }

  overlay.classList.remove('hidden');
  state.isRunning = false; // pause frame processing during rest

  state.restTimer.start(60,
    () => {
      // Timer complete
      overlay.classList.add('hidden');
      state.isRunning = true;
      onComplete();
    },
    (remaining) => {
      countdown.textContent = remaining;
      if (remaining <= 3 && remaining > 0) {
        state.voiceCoach.speakAnnouncement(`${remaining}...`);
      }
      if (remaining === 0) {
        state.voiceCoach.speakAnnouncement('Rest complete. Next set. Go!');
      }
    }
  );
  state.voiceCoach.speakAnnouncement('Set complete! Rest 60 seconds.');
}

function autoAdvanceSet() {
  const ex = state.workout[state.currentExerciseIndex];
  if (state.currentSet < ex.sets) {
    // More sets — show rest timer first
    state.allRepScores.push(...state.validator.getRepScores());
    state.fsm.reset();
    state.validator.reset();
    state.smoother.reset();
    state.fatigueDetector?.reset();
    state.wrongExerciseDetector?.reset();

    showRestTimer(() => {
      state.currentSet++;
      updateExerciseInfo();
      state.voiceCoach.speakAnnouncement(`Set ${state.currentSet} of ${ex.sets}. Go!`);
      state.isRunning = true;
      processFrame();
    });
  } else {
    // Exercise complete — go to next
    state.allRepScores.push(...state.validator.getRepScores());
    state.exercisesCompleted++;
    nextExercise();
  }
}

function nextExercise() {
  state.currentExerciseIndex++;
  state.currentSet = 1;
  if (state.currentExerciseIndex >= state.workout.length) {
    endWorkout();
  } else {
    // Restart session for next exercise
    state.isRunning = false;
    if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
    startExerciseSession();
  }
}

// ─── Controls ───────────────────────────────────────────────────────
$('btn-next-set').addEventListener('click', () => {
  autoAdvanceSet();
});

$('btn-skip-exercise').addEventListener('click', () => {
  state.restTimer.stop(); // cancel any active rest
  $('rest-timer-overlay')?.classList.add('hidden');
  state.allRepScores.push(...state.validator.getRepScores());
  state.exercisesCompleted++;
  nextExercise();
});

$('btn-end-workout').addEventListener('click', () => {
  state.restTimer.stop();
  $('rest-timer-overlay')?.classList.add('hidden');
  state.allRepScores.push(...state.validator.getRepScores());
  endWorkout();
});

// ─── Rest Timer Buttons ─────────────────────────────────────────────
$('btn-rest-skip').addEventListener('click', () => {
  state.restTimer.skip();
});

$('btn-rest-plus').addEventListener('click', () => {
  state.restTimer.addTime(30);
  state.voiceCoach.speakAnnouncement('30 seconds added.');
});

// ─── Camera Mirror Helper ────────────────────────────────────────────
// The mirror (scaleX -1) is applied ONLY to #camera-feed and #skeleton-canvas.
// #camera-viewport receives rotation only — never a scaleX flip.
// This guarantees #hud-canvas text is NEVER mirrored, regardless of DOM position.
function _applyCameraTransform() {
  const vp       = $('camera-viewport');
  const video    = $('camera-feed');
  const skeleton = $('skeleton-canvas');
  const rotation = state.cameraRotation ?? 0;
  const mirror   = state.facingMode === 'user'; // front cam needs mirror

  vp.setAttribute('data-rotation', String(rotation));

  if (rotation === 0 || rotation === 180) {
    // Simple rotation — viewport carries only the rotate
    vp.style.transform = `rotate(${rotation}deg)`;
  } else {
    // 90° / 270° — shrink viewport to fit rotated content in container
    const container = vp.parentElement;
    const cw = container.clientWidth  || window.innerWidth;
    const ch = container.clientHeight || window.innerHeight;
    const scale = Math.min(cw / ch, ch / cw);
    vp.style.transform = `rotate(${rotation}deg) scale(${scale})`;
  }

  // Apply mirror directly to video + skeleton (in their LOCAL coordinate space).
  // Because they are children of the rotating viewport, scaleX(-1) flips them
  // along their local X axis, which correctly mirrors the image for any rotation.
  const mirrorVal = mirror ? 'scaleX(-1)' : '';
  if (video)    video.style.transform    = mirrorVal;
  if (skeleton) skeleton.style.transform = mirrorVal;

  // Update rotate button label
  const btn = $('btn-rotate-cam');
  if (btn) {
    const labels = { 0: '↻ Rotate', 90: '↻ 90°', 180: '↻ 180°', 270: '↻ 270°' };
    btn.textContent = labels[rotation] ?? '↻ Rotate';
    btn.classList.toggle('rotate-active', rotation !== 0);
  }
}

$('btn-switch-camera').addEventListener('click', async () => {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  _applyCameraTransform();
  await startCamera();
});

// ─── Camera Rotation ─────────────────────────────────────────────────
// Initialise rotation state (persisted across sessions)
state.cameraRotation = parseInt(localStorage.getItem('gymonic_cam_rotation') ?? '0', 10) || 0;
_applyCameraTransform(); // apply on load

$('btn-rotate-cam').addEventListener('click', () => {
  state.cameraRotation = (state.cameraRotation + 90) % 360;
  localStorage.setItem('gymonic_cam_rotation', String(state.cameraRotation));
  _applyCameraTransform();
  showToast(`Camera rotated to ${state.cameraRotation}°`);
});


$('btn-toggle-voice').addEventListener('click', () => {
  const enabled = state.voiceCoach.toggle();
  $('btn-toggle-voice').textContent = enabled ? '🔊 Voice' : '🔇 Muted';
});

// ─── Rep Sound (singleton AudioContext — Bug fix #8) ─────────────────
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playRepSound() {
  try {
    const ctx = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════
// SCREEN 6: SUMMARY
// ═══════════════════════════════════════════════════════════════════
function endWorkout() {
  state.isRunning = false;
  if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
  if (state.videoStream) state.videoStream.getTracks().forEach(t => t.stop());
  // Bug fix #11: reset sessionGuard so next session gets clean FPS readings
  state.sessionGuard?.reset();
  // Bug fix #12: hide pause overlay so it doesn't bleed into summary
  const po = $('session-pause-overlay');
  if (po) po.style.display = 'none';
  const lw = $('session-light-warning');
  if (lw) lw.style.display = 'none';

  const duration = Math.round((Date.now() - state.sessionStartTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  $('summary-exercise').textContent = state.workout.map(e => e.name).join(' • ');
  $('stat-reps').textContent = state.totalReps;
  $('stat-exercises').textContent = state.exercisesCompleted;
  $('stat-duration').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;

  const scores = state.allRepScores;
  $('stat-score').textContent = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : '--';

  // Bar chart
  const chart = $('rep-bar-chart');
  chart.innerHTML = '';
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    const bar = document.createElement('div');
    bar.className = 'rep-bar';
    bar.style.height = `${Math.max(5, (s / 100) * 80)}px`;
    bar.style.background = s >= 80 ? FORM_COLORS.GREEN : s >= 50 ? FORM_COLORS.YELLOW : FORM_COLORS.RED;
    bar.innerHTML = `<span class="rep-bar-label">${i + 1}</span>`;
    bar.title = `Rep ${i + 1}: ${s}/100`;
    chart.appendChild(bar);
  }

  // Save session to progress tracker
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  state.progressTracker.saveSession({
    duration,
    bodyParts: [...state.selectedBodyParts],
    exercises: state.workout,
    totalReps: state.totalReps,
    avgScore,
    repScores: scores,
    exercisesCompleted: state.exercisesCompleted,
  });

  // Gamification: award XP + check achievements (guard against null during first boot)
  if (state.gamification) {
    const streak = state.progressTracker.getCurrentStreak();
    const xpResult = state.gamification.addWorkoutXP(state.totalReps, avgScore, streak);
    const newAchievements = state.gamification.checkAchievements();

    // Update goals progress after session
    if (state.goalSystem) {
      state.goalSystem.getGoals(); // triggers progress recompute + autosave
    }

    // Show XP banner
    const xpBanner = $('xp-banner');
    $('xp-gained').textContent = `+${xpResult.xpGained} XP`;
    const lvl = state.gamification.getLevel();
    $('xp-level-tag').textContent = `${lvl.icon} Lvl ${lvl.level} ${lvl.title}`;
    xpBanner.style.display = 'flex';

    // Level-up voice + toast
    if (xpResult.leveledUp) {
      state.voiceCoach.speakLevelUp(xpResult.newLevel);
      showToast(`🎉 LEVEL UP! You're now ${xpResult.newLevel.icon} ${xpResult.newLevel.title}!`);
    } else {
      state.voiceCoach.speakAnnouncement('Workout complete. Great job!');
    }

    // Achievement toasts
    for (const ach of newAchievements) {
      setTimeout(() => showToast(`🏅 Achievement: ${ach.name}!`), 1500);
      state.voiceCoach.speakAchievement(ach.name);
    }
  } else {
    state.voiceCoach.speakAnnouncement('Workout complete. Great job!');
  }

  showScreen('summary-screen');
}

$('btn-restart').addEventListener('click', () => {
  state.selectedBodyParts.clear();
  state.workout = [];
  state.currentExerciseIndex = 0;
  state.currentSet = 1;
  // Bug fix #9: hide XP banner if user navigates away before it auto-hides
  const xpBanner = $('xp-banner');
  if (xpBanner) xpBanner.style.display = 'none';
  updateHomeStats();
  showScreen('home-screen');
});

// ═══════════════════════════════════════════════════════════════════
// SCREEN 7: HISTORY
// ═══════════════════════════════════════════════════════════════════
$('btn-history').addEventListener('click', () => {
  renderHistoryScreen();
  showScreen('history-screen');
});

$('btn-back-history').addEventListener('click', () => showScreen('home-screen'));

function renderHistoryScreen() {
  // Weekly stats
  const weekly = state.progressTracker.getWeeklyStats();
  $('ws-workouts').textContent = weekly.workouts;
  $('ws-reps').textContent = weekly.totalReps;
  $('ws-minutes').textContent = weekly.totalMinutes;
  $('ws-score').textContent = weekly.avgScore !== null ? weekly.avgScore : '--';

  // Personal bests
  const pb = state.progressTracker.getPersonalBests();
  $('pb-score').textContent = pb.bestScore !== null ? pb.bestScore : '--';
  $('pb-reps').textContent = pb.mostReps !== null ? pb.mostReps : '--';
  $('pb-duration').textContent = pb.longestSessionMin !== null ? `${pb.longestSessionMin} min` : '--';

  // Session history
  const sessions = state.progressTracker.getRecentSessions(20);
  const list = $('history-list');
  list.innerHTML = '';

  if (sessions.length === 0) {
    list.innerHTML = '<div class="history-empty">No workouts yet. Start your first one! 💪</div>';
    return;
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  for (const session of sessions) {
    const d = new Date(session.date);
    const scoreColor = session.avgScore >= 80 ? FORM_COLORS.GREEN
      : session.avgScore >= 50 ? FORM_COLORS.YELLOW : FORM_COLORS.RED;

    const exerciseNames = session.exercises.map(e => e.name).join(', ');
    const dur = session.duration;
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-date">
        <span class="history-day">${d.getDate()}</span>
        <span class="history-month">${months[d.getMonth()]}</span>
      </div>
      <div class="history-info">
        <div class="history-exercises">${exerciseNames}</div>
        <div class="history-meta">${session.totalReps} reps • ${mins}:${String(secs).padStart(2, '0')} • ${session.exercisesCompleted} exercises</div>
      </div>
      <div class="history-score" style="color: ${session.avgScore ? scoreColor : 'var(--text-muted)'}">${session.avgScore || '--'}</div>
    `;
    list.appendChild(card);
  }
}

// ─── Home Stats ─────────────────────────────────────────────────────
function updateHomeStats() {
  const streak = state.progressTracker.getCurrentStreak();
  $('hs-streak').textContent = streak;
  $('hs-workouts').textContent = state.progressTracker.getTotalWorkouts();
  $('hs-reps').textContent = state.progressTracker.getTotalRepsAllTime();
  $('hs-score').textContent = state.progressTracker.getAvgScoreAllTime() || '--';
  
  // Update the new header badge
  if ($('hs-streak-badge')) {
    $('hs-streak-badge').textContent = `${streak} Day Streak`;
  }
  
  // Update the greeting date
  if ($('home-date')) {
    const opts = { weekday: 'long', month: 'short', day: 'numeric' };
    $('home-date').textContent = new Date().toLocaleDateString('en-US', opts);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: GOALS SCREEN
// ═══════════════════════════════════════════════════════════════════
$('btn-goals').addEventListener('click', () => {
  renderGoalsScreen();
  showScreen('goals-screen');
});
$('btn-back-goals').addEventListener('click', () => showScreen('home-screen'));

function renderGoalsScreen() {
  const list = $('goals-list');
  list.innerHTML = '';

  for (const type of GOAL_TYPES) {
    const goalData = state.goalSystem.getGoals().find(g => g.typeId === type.id);
    const isSet = !!goalData;

    const card = document.createElement('div');
    card.className = `goal-card ${isSet ? 'active' : ''}`;

    let progressHTML = '';
    if (isSet) {
      const pct = goalData.progress;
      const isDone = goalData.isCompleted;
      progressHTML = `
        <div class="goal-progress-bar"><div class="goal-progress-fill ${isDone ? 'done' : ''}" style="width:${pct}%"></div></div>
        <div class="goal-meta">
          <span>${goalData.current} / ${goalData.targetValue} ${type.unit}</span>
          <span class="goal-badge ${isDone ? 'done' : 'active'}">${isDone ? '✅ Done' : `${pct}%`}</span>
        </div>
      `;
    }

    const targetBtns = type.defaults.map(v =>
      `<button class="goal-target-btn ${isSet && goalData.targetValue === v ? 'selected' : ''}" data-type="${type.id}" data-val="${v}">${v} ${type.unit}</button>`
    ).join('');

    card.innerHTML = `
      <div class="goal-header">
        <div class="goal-title">${type.icon} ${type.name}</div>
        ${isSet ? `<button class="goal-remove-btn" data-remove="${type.id}">✕ Remove</button>` : ''}
      </div>
      <div class="goal-desc">${type.description}</div>
      ${progressHTML}
      <div class="goal-targets">${targetBtns}</div>
    `;
    list.appendChild(card);
  }

  // Bind buttons
  list.querySelectorAll('.goal-target-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.goalSystem.addGoal(btn.dataset.type, parseInt(btn.dataset.val));
      renderGoalsScreen();
    });
  });
  list.querySelectorAll('.goal-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.goalSystem.removeGoal(btn.dataset.remove);
      renderGoalsScreen();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: ANALYTICS SCREEN
// ═══════════════════════════════════════════════════════════════════
$('btn-analytics').addEventListener('click', () => {
  renderAnalyticsScreen();
  showScreen('analytics-screen');
});
$('btn-back-analytics').addEventListener('click', () => showScreen('home-screen'));

function renderAnalyticsScreen() {
  // Daily tip
  const tip = state.adaptiveAI.getDailyTip();
  $('daily-tip').innerHTML = `<span class="daily-tip-icon">${tip.icon}</span><span class="daily-tip-text">${tip.text}</span>`;

  // Score trend chart
  const trend = state.analytics.getScoreTrend(8);
  const chart = $('score-chart').parentElement;
  if (trend.length === 0) {
    chart.innerHTML = '<div class="chart-empty">No sessions yet</div>';
  } else {
    const maxScore = Math.max(...trend.map(t => t.score), 1);
    chart.innerHTML = trend.map(t => `
      <div class="chart-bar-group">
        <div class="chart-bar-value">${t.score || ''}</div>
        <div class="chart-bar-wrap">
          <div class="chart-bar" style="height:${Math.max(4, (t.score / maxScore) * 80)}px; background:${t.score >= 80 ? FORM_COLORS.GREEN : t.score >= 50 ? FORM_COLORS.YELLOW : FORM_COLORS.RED}"></div>
        </div>
        <div class="chart-bar-label">${t.date}</div>
      </div>
    `).join('');
  }

  // Weekly volume bars
  const weekly = state.analytics.getWeeklyVolume();
  const maxReps = Math.max(...weekly.map(w => w.reps), 1);
  $('weekly-bars').innerHTML = weekly.map(w => `
    <div class="analytics-bar-row">
      <div class="analytics-bar-label">${w.label}</div>
      <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.round((w.reps/maxReps)*100)}%; background:var(--accent)"></div></div>
      <div class="analytics-bar-value" style="color:var(--accent)">${w.reps}</div>
    </div>
  `).join('');

  // Body part bars
  const parts = state.analytics.getBodyPartDistribution();
  const maxPct = Math.max(...parts.map(p => p.percent), 1);
  $('bodypart-bars').innerHTML = parts.map(p => `
    <div class="analytics-bar-row">
      <div class="analytics-bar-label">${p.name}</div>
      <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.round((p.percent/maxPct)*100)}%; background:${p.color}"></div></div>
      <div class="analytics-bar-value" style="color:${p.color}">${p.count}x</div>
    </div>
  `).join('');

  // 30-day consistency
  const days = state.analytics.getConsistencyMap();
  $('consistency-grid').innerHTML = days.map(d => `
    <div class="consistency-dot ${d.active ? 'active' : 'inactive'}" title="${d.date.toDateString()}">${d.day}</div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: ACHIEVEMENTS SCREEN
// ═══════════════════════════════════════════════════════════════════
$('btn-achievements').addEventListener('click', () => {
  renderAchievementsScreen();
  showScreen('achievements-screen');
});
$('btn-back-achievements').addEventListener('click', () => showScreen('home-screen'));

function renderAchievementsScreen() {
  const stats = state.gamification.getStats();
  $('ach-count').textContent = `${stats.achievementsUnlocked}/${stats.achievementsTotal} unlocked`;

  // Level card
  const lvl = stats.level;
  const next = stats.nextLevel;
  const prog = stats.levelProgress;
  $('level-card').innerHTML = `
    <div class="level-icon">${lvl.icon}</div>
    <div class="level-title">Level ${lvl.level} — ${lvl.title}</div>
    <div class="level-subtitle">${stats.totalXP} XP total · ${stats.challengesCompleted} challenges done</div>
    <div class="level-xp-bar"><div class="level-xp-fill" style="width:${prog.percent}%"></div></div>
    <div class="level-xp-text">${next ? `${prog.xpInLevel}/${prog.xpNeeded} XP to Level ${next.level} ${next.icon}` : '🌟 MAX LEVEL!'}</div>
  `;

  // Daily challenge
  const ch = state.gamification.getDailyChallenge();
  $('challenge-card').innerHTML = `
    <div class="challenge-header">
      <div class="challenge-name">${ch.name}</div>
      <div class="challenge-xp">+${ch.xpReward} XP</div>
    </div>
    <div class="challenge-desc">${ch.desc}</div>
    <div class="challenge-progress-bar"><div class="challenge-progress-fill" style="width:${ch.progress}%"></div></div>
    <div class="challenge-progress-text">${ch.current} / ${ch.target} ${ch.type}</div>
    ${ch.completed ? '<div class="challenge-done">✅ Completed today!</div>' : ''}
  `;

  // Achievements grid
  const achievements = state.gamification.getAchievements();
  $('achievements-grid').innerHTML = achievements.map(a => `
    <div class="achievement-badge ${a.unlocked ? 'unlocked' : 'locked'}">
      <span class="achievement-icon">${a.icon}</span>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
    </div>
  `).join('');
}

// ─── Toast Helper ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3100);
}

// ═══════════════════════════════════════════════════════════════════
// CALIBRATION SCREEN
// ═══════════════════════════════════════════════════════════════════
let calibStream = null;
let calibAnimId = null;

$('btn-calibrate').addEventListener('click', async () => {
  showScreen('calibration-screen');
  await startCalibCamera();
});

['btn-back-calibration', 'btn-done-calibration'].forEach(id => {
  $(id).addEventListener('click', () => {
    stopCalibCamera();
    // Save height if entered
    const h = parseInt($('calib-height-input').value);
    if (h >= 140 && h <= 220) state.calibration.setUserHeight(h);
    showScreen('home-screen');
  });
});

$('btn-capture-tpose').addEventListener('click', () => {
  // Use last detected landmarks from calibration loop
  if (state._calibLandmarks) {
    const ok = state.calibration.calibrateFromPose(state._calibLandmarks);
    if (ok) {
      $('calib-captured').style.display = 'block';
      showToast('✅ Body calibration saved!');
    } else {
      showToast('❌ Could not detect pose — stand in T-pose and try again');
    }
  } else {
    showToast('⏳ Camera not ready yet — wait a moment');
  }
});

async function startCalibCamera() {
  try {
    calibStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    const video = $('calib-video');
    video.srcObject = calibStream;
    await video.play();
    runCalibLoop();
  } catch (e) {
    $('calib-status-text').textContent = 'Camera access denied. Please allow camera permissions.';
  }
}

function stopCalibCamera() {
  if (calibAnimId) { cancelAnimationFrame(calibAnimId); calibAnimId = null; }
  if (calibStream) { calibStream.getTracks().forEach(t => t.stop()); calibStream = null; }
  state._calibLandmarks = null;
}

function runCalibLoop() {
  const video = $('calib-video');
  let frameNum = 0;

  function loop() {
    if (!calibStream) return;
    calibAnimId = requestAnimationFrame(loop);
    if (!state.poseLandmarker || video.readyState < 2) return;

    frameNum++;
    // Only run detection every 5 frames (save CPU)
    if (frameNum % 5 !== 0) return;

    try {
      const now = performance.now();
      const result = state.poseLandmarker.detectForVideo(video, now);
      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0].map((lm, idx) => ({
          x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 1.0, index: idx,
        }));
        state._calibLandmarks = landmarks;

        const check = state.calibration.checkCameraPlacement(landmarks);
        const statusEl = $('calib-status');
        const icon = $('calib-status-icon');
        const text = $('calib-status-text');

        if (check.ok) {
          statusEl.className = 'calib-status ok';
          icon.textContent = '✅';
          text.textContent = 'Camera position looks great!';
        } else {
          statusEl.className = 'calib-status warn';
          icon.textContent = '⚠️';
          text.textContent = check.issues[0] || 'Adjust your position';
        }
      } else {
        $('calib-status-icon').textContent = '👀';
        $('calib-status-text').textContent = 'No person detected — step into frame';
        state._calibLandmarks = null;
      }
    } catch (e) { /* ignore frame errors */ }
  }

  calibAnimId = requestAnimationFrame(loop);
}

// ─── Boot ───────────────────────────────────────────────────────────
// Note: calibration-screen is already in the screens array above (line 69)
// so we don't push it again here.

// Init all systems after progressTracker is ready
state.goalSystem    = new GoalSystem(state.progressTracker);
state.analytics     = new AnalyticsEngine(state.progressTracker);
state.gamification  = new GamificationSystem(state.progressTracker);
state.adaptiveAI    = new AdaptiveAI(state.progressTracker);

// Populate the home screen and body-part grid
renderBodyPartGrid();
updateHomeStats();

// Boot MediaPipe (async — loads model from CDN)
initMediaPipe().catch(err => {
  console.error('MediaPipe init failed:', err);
  $('loading-text').textContent = `Error: ${err.message}. Refresh to retry.`;
});

// Bug fix #15: Stop all camera streams when user refreshes or navigates away
// Prevents browser from showing the "camera in use" indicator after leaving
window.addEventListener('beforeunload', () => {
  if (calibStream) {
    calibStream.getTracks().forEach(t => t.stop());
  }
  if (state.videoStream) {
    state.videoStream.getTracks().forEach(t => t.stop());
  }
});
