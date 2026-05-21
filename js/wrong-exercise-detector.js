/**
 * GYMONIC — Wrong Exercise Detector
 * Compares live pose angles against expected exercise angle profile.
 * Warns user if they appear to be doing a different exercise.
 */

// Expected angle ranges for each exercise (degrees)
// Format: { joint: [min, max] }
const EXERCISE_PROFILES = {
  bicep_curl: {
    // Elbows should be moving significantly (not locked out like push-up)
    left_elbow:  [40, 160],
    right_elbow: [40, 160],
    // Knees roughly straight (not squatting)
    left_knee:   [150, 180],
    right_knee:  [150, 180],
  },
  squat: {
    // Knees bent significantly at bottom
    left_knee:   [60, 170],
    right_knee:  [60, 170],
    // Hips bent
    left_hip:    [50, 150],
    right_hip:   [50, 150],
  },
  push_up: {
    // Elbows bending during rep
    left_elbow:  [60, 170],
    right_elbow: [60, 170],
    // Knees roughly straight
    left_knee:   [150, 180],
    right_knee:  [150, 180],
  },
  lateral_raise: {
    // Shoulders changing angle (arms raising out)
    left_shoulder:  [20, 160],
    right_shoulder: [20, 160],
    // Elbows roughly straight (not curling)
    left_elbow:  [140, 180],
    right_elbow: [140, 180],
  },
};

export class WrongExerciseDetector {
  constructor(opts = {}) {
    this.confirmFrames   = opts.confirmFrames   ?? 30;  // frames before warning
    this.cooldownMs      = opts.cooldownMs      ?? 15000; // ms between warnings
    this._mismatchFrames = 0;
    this._lastWarnTime   = 0;
    this._warned         = false;
  }

  /**
   * @param {string} expectedExercise - e.g. 'bicep_curl'
   * @param {Object} angles           - computed angles from angle-engine
   * @param {number} now              - timestamp
   * @returns {{ wrong, message } | null}
   */
  check(expectedExercise, angles, now = performance.now()) {
    const profile = EXERCISE_PROFILES[expectedExercise];
    if (!profile || !angles) return null;

    // Check how many joints are COMPLETELY outside the expected range
    let outsideCount = 0;
    let totalChecked = 0;

    for (const [joint, [min, max]] of Object.entries(profile)) {
      const angle = angles[joint];
      if (angle === null || angle === undefined) continue;
      totalChecked++;

      // If the angle never falls in range across all frames, flag it
      const inRange = angle >= min && angle <= max;
      if (!inRange) outsideCount++;
    }

    if (totalChecked === 0) return null;

    // If majority of joints are out of expected range
    const mismatch = outsideCount / totalChecked >= 0.6;

    if (mismatch) {
      this._mismatchFrames++;
    } else {
      this._mismatchFrames = Math.max(0, this._mismatchFrames - 2); // decay
    }

    // Need sustained mismatch and not in cooldown
    if (
      this._mismatchFrames >= this.confirmFrames &&
      now - this._lastWarnTime > this.cooldownMs
    ) {
      this._lastWarnTime   = now;
      this._mismatchFrames = 0;
      return {
        wrong: true,
        message: `⚠️ This doesn't look like ${this._formatName(expectedExercise)} — check your form or exercise selection`,
      };
    }

    return null;
  }

  reset() {
    this._mismatchFrames = 0;
    this._lastWarnTime   = 0;
    this._warned         = false;
  }

  _formatName(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
