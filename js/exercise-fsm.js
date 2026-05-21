/**
 * GYMONIC — Exercise State Machines (v2)
 * Fixed: false rep counting via minimum ROM, minimum rep duration, and stricter thresholds.
 * Added: active side detection (left/right).
 */

// ─── Base FSM ───────────────────────────────────────────────────────
class ExerciseFSM {
  constructor(name) {
    this.name = name;
    this.currentState = 'IDLE';
    this.repCount = 0;
    this.lastTransitionTime = 0;
    this.minPhaseDurationMs = 200;     // Must stay in phase ≥200ms
    this.minRepDurationMs = 800;       // A rep must take at least 800ms
    this.minROM = 50;                  // Minimum range of motion (degrees) for a valid rep
    this.phaseHistory = [];
    this.repStartTime = 0;
    this.repDurations = [];
    this.currentRepMinAngle = 360;
    this.currentRepMaxAngle = 0;
    this.repROMs = [];
    this.activeSide = null;            // 'left', 'right', or 'both'
    this.phasesVisited = new Set();    // Track which phases were visited in this rep
    this.idleStartTime = 0;
    this.startConfirmFrames = 0;       // Frames confirming START position
    this.START_CONFIRM_REQUIRED = 5;   // Need 5 consecutive frames to confirm START
  }

  _debounceOk(timestampMs) {
    return (timestampMs - this.lastTransitionTime) >= this.minPhaseDurationMs;
  }

  // Hysteresis: only transition when value crosses a threshold by a margin.
  // enterBelow: transition fires when value drops BELOW this
  // exitAbove:  transition fires when value rises ABOVE this
  // Use different enter/exit to create a dead-zone (hysteresis band)
  _crossedBelow(value, threshold, hysteresis = 8) {
    return value < (threshold - hysteresis);
  }

  _crossedAbove(value, threshold, hysteresis = 8) {
    return value > (threshold + hysteresis);
  }

  _transition(newState, timestampMs) {
    const oldState = this.currentState;
    this.currentState = newState;
    this.lastTransitionTime = timestampMs;
    this.phaseHistory.push({ from: oldState, to: newState, time: timestampMs });
    this.phasesVisited.add(newState);
    return oldState;
  }

  _completeRep(timestampMs) {
    const duration = timestampMs - this.repStartTime;
    const rom = this.currentRepMaxAngle - this.currentRepMinAngle;

    // VALIDATION: Only count rep if it meets minimum criteria
    if (duration < this.minRepDurationMs) {
      // Too fast — likely noise, not a real rep
      this._resetRepTracking(timestampMs);
      return false;
    }

    if (rom < this.minROM) {
      // Not enough range of motion — not a real rep
      this._resetRepTracking(timestampMs);
      return false;
    }

    // Valid rep!
    this.repCount++;
    this.repDurations.push(duration);
    this.repROMs.push(rom);
    this._resetRepTracking(timestampMs);
    return true;
  }

  _resetRepTracking(timestampMs) {
    this.currentRepMinAngle = 360;
    this.currentRepMaxAngle = 0;
    this.repStartTime = timestampMs;
    this.phasesVisited.clear();
  }

  _trackAngle(angle) {
    if (angle !== null && angle !== undefined) {
      this.currentRepMinAngle = Math.min(this.currentRepMinAngle, angle);
      this.currentRepMaxAngle = Math.max(this.currentRepMaxAngle, angle);
    }
  }

  getAvgTempo() {
    if (this.repDurations.length === 0) return null;
    const sum = this.repDurations.reduce((a, b) => a + b, 0);
    return (sum / this.repDurations.length / 1000).toFixed(1);
  }

  getLastROM() {
    return this.repROMs.length > 0 ? this.repROMs[this.repROMs.length - 1] : null;
  }

  reset() {
    this.currentState = 'IDLE';
    this.repCount = 0;
    this.lastTransitionTime = 0;
    this.phaseHistory = [];
    this.repStartTime = 0;
    this.repDurations = [];
    this.currentRepMinAngle = 360;
    this.currentRepMaxAngle = 0;
    this.repROMs = [];
    this.activeSide = null;
    this.phasesVisited = new Set();
    this.startConfirmFrames = 0;
  }
}

// ─── Side Detection Helper ──────────────────────────────────────────
function detectActiveSide(leftAngle, rightAngle, leftPrev, rightPrev) {
  // Determine which side is more active (has more movement)
  if (leftAngle === null && rightAngle === null) return { side: null, angle: null };
  if (leftAngle === null) return { side: 'right', angle: rightAngle };
  if (rightAngle === null) return { side: 'left', angle: leftAngle };

  // Both visible — check which side has more flexion (smaller angle = more curl)
  const leftDelta = leftPrev !== null ? Math.abs(leftAngle - leftPrev) : 0;
  const rightDelta = rightPrev !== null ? Math.abs(rightAngle - rightPrev) : 0;

  // If both are moving similarly, treat as 'both'
  if (Math.abs(leftAngle - rightAngle) < 20) {
    return { side: 'both', angle: (leftAngle + rightAngle) / 2, leftAngle, rightAngle };
  }

  // Otherwise, the side with the smaller angle is the active one (more curled/bent)
  if (leftAngle < rightAngle) {
    return { side: 'left', angle: leftAngle, leftAngle, rightAngle };
  } else {
    return { side: 'right', angle: rightAngle, leftAngle, rightAngle };
  }
}


// ─── Bicep Curl FSM ─────────────────────────────────────────────────
export class BicepCurlFSM extends ExerciseFSM {
  constructor() {
    super('bicep_curl');
    this.minROM = 60; // Need at least 60° ROM for a valid curl rep
    this.prevLeftElbow = null;
    this.prevRightElbow = null;
  }

  update(angles, timestampMs, velocities = {}) {
    const { side, angle: elbowAngle, leftAngle, rightAngle } = detectActiveSide(
      angles.left_elbow, angles.right_elbow,
      this.prevLeftElbow, this.prevRightElbow
    );

    this.prevLeftElbow = angles.left_elbow;
    this.prevRightElbow = angles.right_elbow;

    if (elbowAngle === null) {
      return this._result(false, side, leftAngle, rightAngle);
    }

    this.activeSide = side;
    this._trackAngle(elbowAngle);
    let repCompleted = false;

    switch (this.currentState) {
      case 'IDLE':
        // Require sustained confirmation of START position
        if (elbowAngle > 145) {
          this.startConfirmFrames++;
          if (this.startConfirmFrames >= this.START_CONFIRM_REQUIRED) {
            this._transition('START', timestampMs);
            this.repStartTime = timestampMs;
            this.startConfirmFrames = 0;
          }
        } else {
          this.startConfirmFrames = 0;
        }
        break;

      // START: arm relatively straight, waiting for curl to begin
      case 'START':
        if (this._crossedBelow(elbowAngle, 130) && this._debounceOk(timestampMs)) {
          this._transition('CONCENTRIC', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 6000) {
          this._transition('IDLE', timestampMs); this.startConfirmFrames = 0;
        }
        break;

      // CONCENTRIC: arm curling up
      case 'CONCENTRIC':
        if (this._crossedBelow(elbowAngle, 70) && this._debounceOk(timestampMs)) {
          this._transition('PEAK', timestampMs);
        }
        // Bail-out: arm went back to start without completing
        if (this._crossedAbove(elbowAngle, 145) && this._debounceOk(timestampMs)) {
          this._transition('IDLE', timestampMs); this.startConfirmFrames = 0;
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs); this.startConfirmFrames = 0;
        }
        break;

      // PEAK: arm fully curled — wait for it to go down (hysteresis: must exceed 80° before eccentric)
      case 'PEAK':
        if (this._crossedAbove(elbowAngle, 78) && this._debounceOk(timestampMs)) {
          this._transition('ECCENTRIC', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs); this.startConfirmFrames = 0;
        }
        break;

      // ECCENTRIC: arm lowering back down
      case 'ECCENTRIC':
        if (this._crossedAbove(elbowAngle, 140) && this._debounceOk(timestampMs)) {
          this._transition('START', timestampMs);
          const valid = this._completeRep(timestampMs);
          repCompleted = valid;
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs); this.startConfirmFrames = 0;
        }
        break;
    }

    return this._result(repCompleted, side, leftAngle, rightAngle);
  }

  _result(repCompleted, side, leftAngle, rightAngle) {
    return {
      state: this.currentState,
      repCount: this.repCount,
      repCompleted,
      phase: this.currentState,
      exerciseName: 'Bicep Curl',
      activeSide: side || this.activeSide,
      leftAngle: leftAngle != null ? Math.round(leftAngle) : null,
      rightAngle: rightAngle != null ? Math.round(rightAngle) : null,
    };
  }
}

// ─── Squat FSM ──────────────────────────────────────────────────────
export class SquatFSM extends ExerciseFSM {
  constructor() {
    super('squat');
    this.minROM = 40; // Need at least 40° knee ROM for a valid squat
  }

  update(angles, timestampMs, velocities = {}) {
    const leftKnee = angles.left_knee;
    const rightKnee = angles.right_knee;
    let kneeAngle = null;
    let side = 'both';

    if (leftKnee !== null && rightKnee !== null) {
      kneeAngle = (leftKnee + rightKnee) / 2;
    } else {
      kneeAngle = leftKnee !== null ? leftKnee : rightKnee;
      side = leftKnee !== null ? 'left' : 'right';
    }

    if (kneeAngle === null) return this._result(false, side, leftKnee, rightKnee);

    this.activeSide = side;
    this._trackAngle(kneeAngle);
    let repCompleted = false;

    switch (this.currentState) {
      case 'IDLE':
        if (kneeAngle > 155) {
          this.startConfirmFrames++;
          if (this.startConfirmFrames >= this.START_CONFIRM_REQUIRED) {
            this._transition('STANDING', timestampMs);
            this.repStartTime = timestampMs;
            this.startConfirmFrames = 0;
          }
        } else {
          this.startConfirmFrames = 0;
        }
        break;

      case 'STANDING':
        if (kneeAngle < 145 && this._debounceOk(timestampMs)) {
          this._transition('DESCENT', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 6000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;

      case 'DESCENT':
        if (kneeAngle < 110 && this._debounceOk(timestampMs)) {
          this._transition('BOTTOM', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;

      case 'BOTTOM':
        if (kneeAngle > 110 && this._debounceOk(timestampMs)) {
          this._transition('ASCENT', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;

      case 'ASCENT':
        if (kneeAngle > 150 && this._debounceOk(timestampMs)) {
          this._transition('STANDING', timestampMs);
          const valid = this._completeRep(timestampMs);
          repCompleted = valid;
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;
    }

    return this._result(repCompleted, side, leftKnee, rightKnee);
  }

  _result(repCompleted, side, leftAngle, rightAngle) {
    return {
      state: this.currentState,
      repCount: this.repCount,
      repCompleted,
      phase: this.currentState,
      exerciseName: 'Squat',
      activeSide: side || 'both',
      leftAngle: leftAngle != null ? Math.round(leftAngle) : null,
      rightAngle: rightAngle != null ? Math.round(rightAngle) : null,
    };
  }
}

// ─── Push-Up FSM ────────────────────────────────────────────────────
export class PushUpFSM extends ExerciseFSM {
  constructor() {
    super('push_up');
    this.minROM = 40;
  }

  update(angles, timestampMs, velocities = {}, isHorizontal = false) {
    const leftElbow = angles.left_elbow;
    const rightElbow = angles.right_elbow;
    let elbowAngle = null;

    if (leftElbow !== null && rightElbow !== null) {
      elbowAngle = (leftElbow + rightElbow) / 2;
    } else {
      elbowAngle = leftElbow !== null ? leftElbow : rightElbow;
    }

    if (elbowAngle === null) return this._result(false, 'both', leftElbow, rightElbow);

    this._trackAngle(elbowAngle);
    let repCompleted = false;

    switch (this.currentState) {
      case 'IDLE':
        if (isHorizontal && elbowAngle > 147) {
          this.startConfirmFrames++;
          if (this.startConfirmFrames >= this.START_CONFIRM_REQUIRED) {
            this._transition('PLANK', timestampMs);
            this.repStartTime = timestampMs;
            this.startConfirmFrames = 0;
          }
        } else {
          this.startConfirmFrames = 0;
        }
        break;

      case 'PLANK':
        if (!isHorizontal && timestampMs - this.lastTransitionTime > 2000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
          break;
        }
        if (elbowAngle < 135 && this._debounceOk(timestampMs)) {
          this._transition('DESCENT', timestampMs);
        }
        break;

      case 'DESCENT':
        if (elbowAngle < 100 && this._debounceOk(timestampMs)) {
          this._transition('BOTTOM', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;

      case 'BOTTOM':
        if (elbowAngle > 100 && this._debounceOk(timestampMs)) {
          this._transition('ASCENT', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;

      case 'ASCENT':
        if (elbowAngle > 147 && this._debounceOk(timestampMs)) {
          this._transition('PLANK', timestampMs);
          const valid = this._completeRep(timestampMs);
          repCompleted = valid;
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;
    }

    return this._result(repCompleted, 'both', leftElbow, rightElbow);
  }

  _result(repCompleted, side, leftAngle, rightAngle) {
    return {
      state: this.currentState,
      repCount: this.repCount,
      repCompleted,
      phase: this.currentState,
      exerciseName: 'Push-Up',
      activeSide: 'both',
      leftAngle: leftAngle != null ? Math.round(leftAngle) : null,
      rightAngle: rightAngle != null ? Math.round(rightAngle) : null,
    };
  }
}

// ─── Lateral Raise FSM ──────────────────────────────────────────────
export class LateralRaiseFSM extends ExerciseFSM {
  constructor() {
    super('lateral_raise');
    this.minROM = 40;
  }

  update(angles, timestampMs) {
    const leftShoulder = angles.left_shoulder;
    const rightShoulder = angles.right_shoulder;
    let shoulderAngle = null;
    let side = 'both';

    if (leftShoulder !== null && rightShoulder !== null) {
      shoulderAngle = (leftShoulder + rightShoulder) / 2;
      side = 'both';
    } else {
      shoulderAngle = leftShoulder !== null ? leftShoulder : rightShoulder;
      side = leftShoulder !== null ? 'left' : 'right';
    }

    if (shoulderAngle === null) return this._result(false, side, leftShoulder, rightShoulder);
    this.activeSide = side;
    this._trackAngle(shoulderAngle);
    let repCompleted = false;

    switch (this.currentState) {
      case 'IDLE':
        if (shoulderAngle > 150) {
          this.startConfirmFrames++;
          if (this.startConfirmFrames >= this.START_CONFIRM_REQUIRED) {
            this._transition('START', timestampMs);
            this.repStartTime = timestampMs;
            this.startConfirmFrames = 0;
          }
        } else {
          this.startConfirmFrames = 0;
        }
        break;
      case 'START':
        if (shoulderAngle < 130 && this._debounceOk(timestampMs)) {
          this._transition('RAISING', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 6000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;
      case 'RAISING':
        if (shoulderAngle < 80 && this._debounceOk(timestampMs)) {
          this._transition('TOP', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;
      case 'TOP':
        if (shoulderAngle > 80 && this._debounceOk(timestampMs)) {
          this._transition('LOWERING', timestampMs);
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;
      case 'LOWERING':
        if (shoulderAngle > 150 && this._debounceOk(timestampMs)) {
          this._transition('START', timestampMs);
          const valid = this._completeRep(timestampMs);
          repCompleted = valid;
        }
        if (timestampMs - this.lastTransitionTime > 5000) {
          this._transition('IDLE', timestampMs);
          this.startConfirmFrames = 0;
        }
        break;
    }

    return this._result(repCompleted, side, leftShoulder, rightShoulder);
  }

  _result(repCompleted, side, leftAngle, rightAngle) {
    return {
      state: this.currentState,
      repCount: this.repCount,
      repCompleted,
      phase: this.currentState,
      exerciseName: 'Lateral Raise',
      activeSide: side || 'both',
      leftAngle: leftAngle != null ? Math.round(leftAngle) : null,
      rightAngle: rightAngle != null ? Math.round(rightAngle) : null,
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────
export function createFSM(exerciseId) {
  switch (exerciseId) {
    case 'bicep_curl': return new BicepCurlFSM();
    case 'squat': return new SquatFSM();
    case 'push_up': return new PushUpFSM();
    case 'lateral_raise': return new LateralRaiseFSM();
    default: return new BicepCurlFSM();
  }
}
