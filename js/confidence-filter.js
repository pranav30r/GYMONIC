/**
 * GYMONIC — Confidence Filter
 * Per-frame and per-rep landmark confidence scoring.
 * Ignores low-confidence frames to prevent phantom reps.
 */

// Landmark indices for key joints
const EXERCISE_LANDMARKS = {
  bicep_curl:    [11, 12, 13, 14, 15, 16],   // shoulders, elbows, wrists
  squat:         [23, 24, 25, 26, 27, 28],   // hips, knees, ankles
  push_up:       [11, 12, 13, 14, 15, 16, 23, 24], // upper body
  lateral_raise: [11, 12, 13, 14, 15, 16],  // shoulders, elbows, wrists
  default:       [11, 12, 13, 14, 15, 16, 23, 24, 25, 26],
};

export class ConfidenceFilter {
  constructor(opts = {}) {
    this.frameThreshold = opts.frameThreshold ?? 0.55; // min avg visibility to process frame
    this.repThreshold   = opts.repThreshold   ?? 0.60; // min confidence to count a rep
    this.windowSize     = opts.windowSize     ?? 5;    // rolling window for smoothed confidence

    this._confidenceWindow = [];
    this._frameCount       = 0;
    this._droppedFrames    = 0;
  }

  /**
   * Check if a frame is trustworthy for the given exercise.
   * Returns { ok, confidence, reason }
   */
  checkFrame(landmarks, exerciseId = 'default') {
    if (!landmarks || landmarks.length === 0) {
      return { ok: false, confidence: 0, reason: 'No landmarks detected' };
    }

    const indices = EXERCISE_LANDMARKS[exerciseId] || EXERCISE_LANDMARKS.default;
    const visibilities = indices.map(i => landmarks[i]?.visibility ?? 0);
    const avgConf = visibilities.reduce((a, b) => a + b, 0) / visibilities.length;

    // Update rolling window
    this._confidenceWindow.push(avgConf);
    if (this._confidenceWindow.length > this.windowSize) {
      this._confidenceWindow.shift();
    }

    const smoothedConf = this._confidenceWindow.reduce((a, b) => a + b, 0) / this._confidenceWindow.length;

    this._frameCount++;
    if (smoothedConf < this.frameThreshold) {
      this._droppedFrames++;
      return { ok: false, confidence: smoothedConf, reason: this._getReason(visibilities, indices, landmarks) };
    }

    return { ok: true, confidence: smoothedConf, reason: null };
  }

  /**
   * Validate confidence for counting a rep.
   * Returns true only if confidence has been consistently high.
   */
  isRepCountable() {
    if (this._confidenceWindow.length < 3) return false;
    const avg = this._confidenceWindow.reduce((a, b) => a + b, 0) / this._confidenceWindow.length;
    return avg >= this.repThreshold;
  }

  /**
   * Get current smoothed confidence (0–1).
   */
  getSmoothedConfidence() {
    if (this._confidenceWindow.length === 0) return 0;
    return this._confidenceWindow.reduce((a, b) => a + b, 0) / this._confidenceWindow.length;
  }

  /**
   * Get drop rate (percentage of frames ignored).
   */
  getDropRate() {
    if (this._frameCount === 0) return 0;
    return Math.round((this._droppedFrames / this._frameCount) * 100);
  }

  reset() {
    this._confidenceWindow = [];
    this._frameCount = 0;
    this._droppedFrames = 0;
  }

  _getReason(visibilities, indices, landmarks) {
    // Find which joint has the lowest visibility
    let minVis = 1, minIdx = -1;
    visibilities.forEach((v, i) => {
      if (v < minVis) { minVis = v; minIdx = indices[i]; }
    });

    const names = {
      11: 'left shoulder', 12: 'right shoulder',
      13: 'left elbow',    14: 'right elbow',
      15: 'left wrist',    16: 'right wrist',
      23: 'left hip',      24: 'right hip',
      25: 'left knee',     26: 'right knee',
      27: 'left ankle',    28: 'right ankle',
    };

    const jointName = names[minIdx] || 'joint';
    if (minVis < 0.3) return `${jointName} not visible — adjust your position`;
    return 'Pose unclear — ensure good lighting and camera angle';
  }
}
