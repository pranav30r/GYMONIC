/**
 * GYMONIC — Skeleton Renderer (v2)
 * Enhanced: side info display, angle labels on joints, improved HUD.
 */

import { SKELETON_CONNECTIONS, JOINT_DEFINITIONS } from './angle-engine.js';
import { FORM_COLORS } from './form-validator.js';

// Landmark groups per exercise
const EXERCISE_LANDMARK_GROUPS = {
  bicep_curl: {
    primary: [11, 12, 13, 14, 15, 16],
    secondary: [23, 24],
  },
  squat: {
    primary: [23, 24, 25, 26, 27, 28],
    secondary: [11, 12],
  },
  push_up: {
    primary: [11, 12, 13, 14, 15, 16, 23, 24],
    secondary: [25, 26, 27, 28],
  },
  lateral_raise: {
    primary: [11, 12, 13, 14, 15, 16],
    secondary: [23, 24],
  },
};

// Which joint angles to display on screen per exercise
const ANGLE_DISPLAY_JOINTS = {
  bicep_curl: [
    { name: 'left_elbow', landmarkIdx: 13, label: 'L' },
    { name: 'right_elbow', landmarkIdx: 14, label: 'R' },
  ],
  squat: [
    { name: 'left_knee', landmarkIdx: 25, label: 'L' },
    { name: 'right_knee', landmarkIdx: 26, label: 'R' },
  ],
  push_up: [
    { name: 'left_elbow', landmarkIdx: 13, label: 'L' },
    { name: 'right_elbow', landmarkIdx: 14, label: 'R' },
  ],
  lateral_raise: [
    { name: 'left_shoulder', landmarkIdx: 11, label: 'L' },
    { name: 'right_shoulder', landmarkIdx: 12, label: 'R' },
  ],
};

export class SkeletonRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(landmarks, formScore, exerciseId, width, height, angles = null) {
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length < 33) return;

    const groups = EXERCISE_LANDMARK_GROUPS[exerciseId] || { primary: [], secondary: [] };
    const allRelevant = new Set([...groups.primary, ...groups.secondary]);
    const primarySet = new Set(groups.primary);

    // Draw connections
    for (const [startIdx, endIdx] of SKELETON_CONNECTIONS) {
      const start = landmarks[startIdx];
      const end = landmarks[endIdx];
      if (!start || !end || start.visibility < 0.5 || end.visibility < 0.5) continue;

      const x1 = start.x * width;
      const y1 = start.y * height;
      const x2 = end.x * width;
      const y2 = end.y * height;

      const isPrimary = primarySet.has(startIdx) || primarySet.has(endIdx);
      const color = this._getColor(startIdx, endIdx, formScore, allRelevant, isPrimary);

      // Glow for RED
      if (color === FORM_COLORS.RED && isPrimary) {
        ctx.save();
        ctx.shadowColor = FORM_COLORS.RED;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = 'rgba(244,67,54,0.4)';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
      }

      // Glow for GREEN
      if (color === FORM_COLORS.GREEN && isPrimary) {
        ctx.save();
        ctx.shadowColor = FORM_COLORS.GREEN;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = 'rgba(76,175,80,0.25)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
      }

      // Main line
      ctx.strokeStyle = color;
      ctx.lineWidth = isPrimary ? 5 : 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw joint points
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm || lm.visibility < 0.5) continue;
      if (i <= 10) continue; // Skip face

      const x = lm.x * width;
      const y = lm.y * height;
      const isPrimary = primarySet.has(i);
      const color = allRelevant.has(i) ? (formScore?.colorHex || '#6C63FF') : 'rgba(255,255,255,0.3)';
      const radius = isPrimary ? 8 : 5;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Inner white dot
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw angle labels on key joints
    if (angles) {
      const displayJoints = ANGLE_DISPLAY_JOINTS[exerciseId] || [];
      for (const { name, landmarkIdx, label } of displayJoints) {
        const angle = angles[name];
        const lm = landmarks[landmarkIdx];
        if (angle === null || !lm || lm.visibility < 0.5) continue;

        const x = lm.x * width;
        const y = lm.y * height;
        const text = `${label}:${Math.round(angle)}°`;

        // Background pill
        ctx.font = '700 12px Inter, sans-serif';
        const textWidth = ctx.measureText(text).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        this._roundRect(ctx, x + 12, y - 8, textWidth, 18, 4);
        ctx.fill();

        // Text
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.fillText(text, x + 17, y + 5);
      }
    }
  }

  _getColor(startIdx, endIdx, formScore, relevantLandmarks, isPrimary) {
    const startRelevant = relevantLandmarks.has(startIdx);
    const endRelevant = relevantLandmarks.has(endIdx);
    if (!startRelevant && !endRelevant) return 'rgba(255,255,255,0.15)';
    if (!formScore || formScore.color === 'GRAY') return '#6C63FF';
    return formScore.colorHex;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/**
 * HUD Renderer — enhanced with side info, angle display, and better layout.
 */
export class HUDRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.currentMessage = null;
    this.messageStartTime = 0;
    this.messageDuration = 3000;
  }

  render(formScore, fsmState, width, height) {
    const ctx = this.ctx;

    // ─── Rep Counter (top-left) ─────────────────────────
    this._drawPill(ctx, 16, 16, 90, 65, 'rgba(13,13,26,0.85)');
    ctx.fillStyle = '#B0B0C0';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('REPS', 61, 33);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 30px Inter, sans-serif';
    ctx.fillText(fsmState?.repCount ?? 0, 61, 68);

    // ─── Score (top-right) ──────────────────────────────
    const scoreX = width - 106;
    this._drawPill(ctx, scoreX, 16, 90, 65, 'rgba(13,13,26,0.85)');
    ctx.fillStyle = '#B0B0C0';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FORM', scoreX + 45, 33);
    ctx.fillStyle = formScore?.colorHex || '#6C63FF';
    ctx.font = '800 26px Inter, sans-serif';
    ctx.fillText(`${formScore?.overallScore ?? '--'}`, scoreX + 45, 66);

    // ─── Phase + Side Info (top-center) ─────────────────
    const phase = fsmState?.phase || 'IDLE';
    const exercise = fsmState?.exerciseName || '';
    if (phase !== 'IDLE') {
      const sideStr = formScore?.sideInfo ? ` • ${formScore.sideInfo}` : '';
      const phaseText = `${exercise} — ${phase}${sideStr}`;
      ctx.font = '600 13px Inter, sans-serif';
      const phaseWidth = ctx.measureText(phaseText).width + 24;
      const phaseX = (width - phaseWidth) / 2;
      this._drawPill(ctx, phaseX, 16, phaseWidth, 28, 'rgba(108,99,255,0.75)');
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(phaseText, width / 2, 35);
    }

    // ─── Feedback Message (bottom) ──────────────────────
    const now = performance.now();

    // Update current message
    if (formScore?.topError) {
      this.currentMessage = formScore.topError.message;
      this.messageStartTime = now;
    }

    // Show positive feedback when score is good
    if (formScore?.overallScore >= 90 && phase !== 'IDLE' && !formScore?.topError) {
      if (!this.currentMessage || now - this.messageStartTime > this.messageDuration) {
        this.currentMessage = '✅ Great form! Keep it up!';
        this.messageStartTime = now;
      }
    }

    // Render message with fade
    if (this.currentMessage && now - this.messageStartTime < this.messageDuration) {
      const elapsed = now - this.messageStartTime;
      const fadeOut = elapsed > this.messageDuration - 500
        ? (this.messageDuration - elapsed) / 500 : 1;

      const msgColor = formScore?.color === 'RED' ? `rgba(244,67,54,${0.9 * fadeOut})`
        : formScore?.color === 'YELLOW' ? `rgba(255,193,7,${0.9 * fadeOut})`
        : `rgba(76,175,80,${0.9 * fadeOut})`;

      ctx.font = '600 14px Inter, sans-serif';
      const msgWidth = Math.min(ctx.measureText(this.currentMessage).width + 32, width - 32);
      const msgX = (width - msgWidth) / 2;
      const msgY = height - 100;

      this._drawPill(ctx, msgX, msgY, msgWidth, 38, msgColor);
      ctx.fillStyle = `rgba(255,255,255,${fadeOut})`;
      ctx.textAlign = 'center';
      ctx.fillText(this.currentMessage, width / 2, msgY + 24);
    }

    // ─── Waiting indicator (when IDLE) ──────────────────
    if (phase === 'IDLE' && fsmState?.repCount === 0) {
      ctx.font = '600 16px Inter, sans-serif';
      const waitMsg = '🎯 Get into position to start';
      const waitWidth = ctx.measureText(waitMsg).width + 32;
      const waitX = (width - waitWidth) / 2;
      const waitY = height / 2 - 20;

      this._drawPill(ctx, waitX, waitY, waitWidth, 40, 'rgba(108,99,255,0.7)');
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(waitMsg, width / 2, waitY + 26);
    }
  }

  _drawPill(ctx, x, y, w, h, color) {
    const r = Math.min(h / 2, 12);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }
}
