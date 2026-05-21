/**
 * GYMONIC — Form Validation Engine (v2)
 * Side-specific feedback: tells user LEFT/RIGHT, exact angles, and HOW to correct.
 */

import { computeTorsoLean, computeElbowDrift } from './angle-engine.js';

// ─── Color Constants ────────────────────────────────────────────────
export const FORM_COLORS = {
  GREEN:  '#4CAF50',
  YELLOW: '#FFC107',
  RED:    '#F44336',
  GRAY:   '#9E9E9E',
};

// ─── Scoring Function ───────────────────────────────────────────────
function scoreMetric(value, expectedMin, expectedMax, tolerance) {
  if (value === null || value === undefined) return 100;
  if (expectedMin <= value && value <= expectedMax) return 100;
  const deviation = value < expectedMin ? expectedMin - value : value - expectedMax;
  if (tolerance <= 0) return 0;
  return Math.max(0, 100 - (deviation / tolerance) * 100);
}

// ─── Side-Specific Error Generator ──────────────────────────────────
function sideMessage(side, baseMsg, leftVal, rightVal, unit = '°') {
  if (side === 'both' && leftVal != null && rightVal != null) {
    // Compare left and right — find the worse one
    const diff = Math.abs(leftVal - rightVal);
    if (diff > 15) {
      const worseSide = leftVal < rightVal ? 'LEFT' : 'RIGHT';
      return `${worseSide} side: ${baseMsg} (L:${Math.round(leftVal)}${unit} R:${Math.round(rightVal)}${unit})`;
    }
    return `${baseMsg} (L:${Math.round(leftVal)}${unit} R:${Math.round(rightVal)}${unit})`;
  }
  if (side === 'left' || side === 'right') {
    const val = side === 'left' ? leftVal : rightVal;
    return `${side.toUpperCase()} side: ${baseMsg} (${Math.round(val || 0)}${unit})`;
  }
  return baseMsg;
}

// ─── Exercise Rule Definitions ──────────────────────────────────────

const RULES = {
  bicep_curl: [
    {
      id: 'curl_rom',
      check: (angles, lm, fsmState) => {
        const a = fsmState.activeSide === 'left' ? angles.left_elbow : 
                  fsmState.activeSide === 'right' ? angles.right_elbow :
                  angles.left_elbow !== null && angles.right_elbow !== null ? 
                  Math.min(angles.left_elbow, angles.right_elbow) : (angles.left_elbow || angles.right_elbow);
        return { value: a, min: 30, max: 60, tolerance: 15 };
      },
      weight: 0.25,
      phases: ['PEAK'],
      getMessage: (val, side, fsmState) => {
        const target = 45;
        if (val > 60) {
          const needed = Math.round(val - target);
          return sideMessage(side, `Curl ${needed}° higher for full contraction`, fsmState.leftAngle, fsmState.rightAngle);
        }
        return null;
      },
    },
    {
      id: 'curl_extension',
      check: (angles, lm, fsmState) => {
        const a = fsmState.activeSide === 'left' ? angles.left_elbow :
                  fsmState.activeSide === 'right' ? angles.right_elbow :
                  angles.left_elbow !== null && angles.right_elbow !== null ?
                  Math.max(angles.left_elbow, angles.right_elbow) : (angles.left_elbow || angles.right_elbow);
        return { value: a, min: 150, max: 175, tolerance: 15 };
      },
      weight: 0.15,
      phases: ['START'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val < 150) {
          const needed = Math.round(150 - val);
          return sideMessage(side, `Extend ${needed}° more at bottom`, fsmState.leftAngle, fsmState.rightAngle);
        }
        return null;
      },
    },
    {
      id: 'curl_elbow_drift',
      check: (angles, lm, fsmState) => {
        const side = fsmState.activeSide || 'left';
        const drift = computeElbowDrift(lm, side === 'both' ? 'left' : side);
        return { value: drift, min: 0, max: 0.15, tolerance: 0.08 };
      },
      weight: 0.30,
      phases: ['CONCENTRIC', 'ECCENTRIC', 'START'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 0.15) {
          return `Keep your ${(side || 'LEFT').toUpperCase()} elbow pinned to your side — it's drifting forward`;
        }
        return null;
      },
    },
    {
      id: 'curl_torso',
      check: (angles, lm) => {
        const lean = computeTorsoLean(lm);
        return { value: lean, min: 0, max: 12, tolerance: 8 };
      },
      weight: 0.20,
      phases: ['CONCENTRIC', 'ECCENTRIC'],
      getMessage: (val) => {
        if (val !== null && val > 12) {
          return `Stand straight — you're leaning ${Math.round(val)}° (max 12°)`;
        }
        return null;
      },
    },
    {
      id: 'curl_symmetry',
      check: (angles) => {
        if (angles.left_elbow !== null && angles.right_elbow !== null) {
          const diff = Math.abs(angles.left_elbow - angles.right_elbow);
          return { value: diff, min: 0, max: 20, tolerance: 15 };
        }
        return { value: null, min: 0, max: 20, tolerance: 15 };
      },
      weight: 0.10,
      phases: ['CONCENTRIC', 'PEAK', 'ECCENTRIC'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 20) {
          const worseSide = fsmState.leftAngle > fsmState.rightAngle ? 'LEFT' : 'RIGHT';
          return `${worseSide} arm is ${Math.round(val)}° behind — even out both arms`;
        }
        return null;
      },
    },
  ],

  squat: [
    {
      id: 'squat_depth',
      check: (angles) => {
        const lk = angles.left_knee, rk = angles.right_knee;
        const k = (lk !== null && rk !== null) ? (lk + rk) / 2 : (lk || rk);
        return { value: k, min: 70, max: 105, tolerance: 15 };
      },
      weight: 0.30,
      phases: ['BOTTOM'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 105) {
          const needed = Math.round(val - 90);
          return `Go ${needed}° deeper — thighs should reach parallel (L:${fsmState.leftAngle}° R:${fsmState.rightAngle}°)`;
        }
        return null;
      },
    },
    {
      id: 'squat_torso',
      check: (angles, lm) => {
        const lean = computeTorsoLean(lm);
        return { value: lean, min: 0, max: 45, tolerance: 10 };
      },
      weight: 0.25,
      phases: ['DESCENT', 'BOTTOM', 'ASCENT'],
      getMessage: (val) => {
        if (val !== null && val > 45) {
          return `Chest too far forward (${Math.round(val)}°) — keep your chest up`;
        }
        return null;
      },
    },
    {
      id: 'squat_symmetry',
      check: (angles) => {
        const lk = angles.left_knee, rk = angles.right_knee;
        if (lk !== null && rk !== null) {
          return { value: Math.abs(lk - rk), min: 0, max: 12, tolerance: 8 };
        }
        return { value: null, min: 0, max: 12, tolerance: 8 };
      },
      weight: 0.25,
      phases: ['DESCENT', 'BOTTOM', 'ASCENT'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 12) {
          const worseSide = fsmState.leftAngle > fsmState.rightAngle ? 'LEFT' : 'RIGHT';
          return `${worseSide} knee is ${Math.round(val)}° off — distribute weight evenly`;
        }
        return null;
      },
    },
    {
      id: 'squat_lockout',
      check: (angles) => {
        const lk = angles.left_knee, rk = angles.right_knee;
        const k = (lk !== null && rk !== null) ? (lk + rk) / 2 : (lk || rk);
        return { value: k, min: 160, max: 180, tolerance: 10 };
      },
      weight: 0.20,
      phases: ['STANDING'],
      getMessage: (val) => {
        if (val !== null && val < 160) {
          return `Stand all the way up — fully lock out your knees (${Math.round(val)}°)`;
        }
        return null;
      },
    },
  ],

  push_up: [
    {
      id: 'pushup_depth',
      check: (angles) => {
        const le = angles.left_elbow, re = angles.right_elbow;
        const e = (le !== null && re !== null) ? (le + re) / 2 : (le || re);
        return { value: e, min: 70, max: 100, tolerance: 15 };
      },
      weight: 0.30,
      phases: ['BOTTOM'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 100) {
          return `Go ${Math.round(val - 90)}° lower — chest should nearly touch ground (L:${fsmState.leftAngle}° R:${fsmState.rightAngle}°)`;
        }
        return null;
      },
    },
    {
      id: 'pushup_lockout',
      check: (angles) => {
        const le = angles.left_elbow, re = angles.right_elbow;
        const e = (le !== null && re !== null) ? (le + re) / 2 : (le || re);
        return { value: e, min: 155, max: 180, tolerance: 10 };
      },
      weight: 0.20,
      phases: ['PLANK'],
      getMessage: (val) => {
        if (val !== null && val < 155) {
          return `Fully extend arms at top (${Math.round(val)}° — need 155°+)`;
        }
        return null;
      },
    },
    {
      id: 'pushup_body_line',
      check: (angles, lm) => {
        if (!lm[11] || !lm[23] || !lm[27]) return { value: null, min: 165, max: 180, tolerance: 10 };
        const A = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
        const B = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
        const C = { x: (lm[27].x + lm[28].x) / 2, y: (lm[27].y + lm[28].y) / 2 };
        const BAx = A.x - B.x, BAy = A.y - B.y;
        const BCx = C.x - B.x, BCy = C.y - B.y;
        const cross = Math.abs(BAx * BCy - BAy * BCx);
        const dot = BAx * BCx + BAy * BCy;
        const angle = Math.atan2(cross, dot) * (180 / Math.PI);
        return { value: angle, min: 165, max: 180, tolerance: 10 };
      },
      weight: 0.30,
      phases: ['PLANK', 'DESCENT', 'BOTTOM', 'ASCENT'],
      getMessage: (val) => {
        if (val !== null && val < 165) {
          return `Body not straight (${Math.round(val)}°) — engage your core, no hip sag`;
        }
        return null;
      },
    },
  ],

  lateral_raise: [
    {
      id: 'raise_height',
      check: (angles) => {
        const ls = angles.left_shoulder, rs = angles.right_shoulder;
        const s = (ls !== null && rs !== null) ? (ls + rs) / 2 : (ls || rs);
        return { value: s, min: 60, max: 100, tolerance: 15 };
      },
      weight: 0.35,
      phases: ['TOP'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 100) {
          return sideMessage(side, `Raise arms ${Math.round(val - 90)}° higher`, fsmState.leftAngle, fsmState.rightAngle);
        }
        return null;
      },
    },
    {
      id: 'raise_symmetry',
      check: (angles) => {
        const ls = angles.left_shoulder, rs = angles.right_shoulder;
        if (ls !== null && rs !== null) {
          return { value: Math.abs(ls - rs), min: 0, max: 15, tolerance: 10 };
        }
        return { value: null, min: 0, max: 15, tolerance: 10 };
      },
      weight: 0.30,
      phases: ['RAISING', 'TOP', 'LOWERING'],
      getMessage: (val, side, fsmState) => {
        if (val !== null && val > 15) {
          const worseSide = fsmState.leftAngle > fsmState.rightAngle ? 'LEFT' : 'RIGHT';
          return `${worseSide} arm is ${Math.round(val)}° lower — raise it to match the other side`;
        }
        return null;
      },
    },
    {
      id: 'raise_torso',
      check: (angles, lm) => {
        const lean = computeTorsoLean(lm);
        return { value: lean, min: 0, max: 10, tolerance: 5 };
      },
      weight: 0.25,
      phases: ['RAISING', 'TOP', 'LOWERING'],
      getMessage: (val) => {
        if (val !== null && val > 10) {
          return `Don't lean (${Math.round(val)}°) — keep torso upright`;
        }
        return null;
      },
    },
  ],
};

// ─── Main Validator ─────────────────────────────────────────────────

export class FormValidator {
  constructor() {
    this.repScores = [];
    this.currentRepFrameScores = [];
    this.lastFeedbackTime = 0;
    this.feedbackCooldownMs = 2500;
    this.lastMessage = null;
  }

  validate(exerciseId, angles, landmarks, fsmState) {
    const rules = RULES[exerciseId];
    if (!rules) return this._defaultScore(fsmState);

    const jointScores = {};
    const errors = [];
    let weightedSum = 0;
    let totalWeight = 0;

    for (const rule of rules) {
      // Phase filtering
      if (rule.phases && !rule.phases.includes(fsmState.phase)) {
        jointScores[rule.id] = 100;
        continue;
      }

      const { value, min, max, tolerance } = rule.check(angles, landmarks, fsmState);
      const score = scoreMetric(value, min, max, tolerance);
      jointScores[rule.id] = score;
      weightedSum += score * rule.weight;
      totalWeight += rule.weight;

      if (score < 80) {
        const msg = rule.getMessage(value, fsmState.activeSide, fsmState);
        if (msg) {
          errors.push({
            ruleId: rule.id,
            severity: (80 - score) / 80,
            message: msg,
            score,
          });
        }
      }
    }

    const overall = totalWeight > 0 ? weightedSum / totalWeight : 100;
    const color = overall >= 80 ? 'GREEN' : overall >= 50 ? 'YELLOW' : 'RED';

    errors.sort((a, b) => b.severity - a.severity);

    // Apply cooldown — don't spam same message
    const now = performance.now();
    let topError = null;
    if (errors.length > 0) {
      for (const err of errors) {
        if (err.message !== this.lastMessage || now - this.lastFeedbackTime > this.feedbackCooldownMs) {
          topError = err;
          this.lastMessage = err.message;
          this.lastFeedbackTime = now;
          break;
        }
      }
    }

    this.currentRepFrameScores.push(overall);

    // Build side info string
    let sideInfo = '';
    if (fsmState.activeSide) {
      if (fsmState.activeSide === 'both') {
        sideInfo = fsmState.leftAngle != null && fsmState.rightAngle != null
          ? `L:${fsmState.leftAngle}° R:${fsmState.rightAngle}°`
          : '';
      } else {
        const val = fsmState.activeSide === 'left' ? fsmState.leftAngle : fsmState.rightAngle;
        sideInfo = val != null ? `${fsmState.activeSide.toUpperCase()}: ${val}°` : '';
      }
    }

    return {
      overallScore: Math.round(overall),
      color,
      colorHex: FORM_COLORS[color],
      jointScores,
      errors,
      topError,
      phase: fsmState.phase,
      repCount: fsmState.repCount,
      activeSide: fsmState.activeSide,
      sideInfo,
    };
  }

  onRepComplete() {
    if (this.currentRepFrameScores.length === 0) return null;
    const sorted = [...this.currentRepFrameScores].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const repScore = 0.4 * p25 + 0.3 * p50 + 0.3 * mean;
    this.repScores.push(Math.round(repScore));
    this.currentRepFrameScores = [];
    return Math.round(repScore);
  }

  getRepScores() { return [...this.repScores]; }

  getAvgScore() {
    if (this.repScores.length === 0) return null;
    return Math.round(this.repScores.reduce((a, b) => a + b, 0) / this.repScores.length);
  }

  _defaultScore(fsmState) {
    return {
      overallScore: 100, color: 'GRAY', colorHex: FORM_COLORS.GRAY,
      jointScores: {}, errors: [], topError: null,
      phase: fsmState?.phase || 'IDLE', repCount: fsmState?.repCount || 0,
      activeSide: null, sideInfo: '',
    };
  }

  reset() {
    this.repScores = [];
    this.currentRepFrameScores = [];
    this.lastMessage = null;
    this.lastFeedbackTime = 0;
  }
}
