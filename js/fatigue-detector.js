/**
 * GYMONIC — Fatigue Detector
 * Analyses rep duration trends and form score degradation to detect fatigue.
 *
 * Signals:
 *  1. Slowing reps: rep duration increases >30% vs personal average
 *  2. Form degradation: rolling avg score drops >15pts from session high
 *  3. Combined: both signals together = "Strong fatigue — take a rest"
 */
export class FatigueDetector {
  constructor(opts = {}) {
    this.repDurationWindow  = opts.repDurationWindow  ?? 5;   // last N reps to average
    this.slowThreshold      = opts.slowThreshold      ?? 0.3; // 30% slower than baseline
    this.scoreDropThreshold = opts.scoreDropThreshold ?? 15;  // pts drop from session high
    this.minRepsToAnalyze   = opts.minRepsToAnalyze   ?? 4;  // need at least 4 reps

    this._repDurations   = [];   // ms per rep
    this._repScores      = [];   // form scores per rep
    this._sessionHigh    = 0;    // best form score seen this session
    this._repStartTime   = null;
    this._lastAlert      = null; // 'slow' | 'form' | 'fatigue' | null
    this._alertCooldown  = 20000; // 20s between alerts
    this._lastAlertTime  = 0;
    this.isFatigued      = false;
  }

  /** Call when a rep starts */
  onRepStart(now = performance.now()) {
    this._repStartTime = now;
  }

  /**
   * Call when a rep completes.
   * @param {number} formScore  - 0–100 score for this rep
   * @param {number} now        - timestamp
   * @returns {{ fatigued, type, message } | null}
   */
  onRepComplete(formScore, now = performance.now()) {
    // Track duration
    if (this._repStartTime !== null) {
      const dur = now - this._repStartTime;
      this._repDurations.push(dur);
      if (this._repDurations.length > 20) this._repDurations.shift();
      this._repStartTime = null;
    }

    // Track form
    this._repScores.push(formScore);
    if (this._repScores.length > 20) this._repScores.shift();
    if (formScore > this._sessionHigh) this._sessionHigh = formScore;

    if (this._repDurations.length < this.minRepsToAnalyze) return null;

    // Analyse
    const slowSignal  = this._checkSlowingReps();
    const formSignal  = this._checkFormDegradation();

    let type = null;
    if (slowSignal && formSignal) type = 'fatigue';  // strong
    else if (slowSignal)          type = 'slow';
    else if (formSignal)          type = 'form';

    if (!type) { this.isFatigued = false; return null; }
    this.isFatigued = true;

    // Cooldown — don't spam alerts
    if (now - this._lastAlertTime < this._alertCooldown) return null;
    if (type === this._lastAlert) return null;

    this._lastAlert     = type;
    this._lastAlertTime = now;

    const messages = {
      slow:    '⏱️ Reps slowing down — focus on controlled movement',
      form:    '⚠️ Form dropping — reduce weight or take a breather',
      fatigue: '🛑 Fatigue detected — rest 60–90s before next set',
    };

    return { fatigued: true, type, message: messages[type] };
  }

  /** Returns fatigue severity: 0 = none, 1 = mild, 2 = moderate, 3 = severe */
  getSeverity() {
    if (!this.isFatigued) return 0;
    const slow = this._checkSlowingReps();
    const form = this._checkFormDegradation();
    if (slow && form) return 3;
    if (form) return 2;
    if (slow) return 1;
    return 0;
  }

  reset() {
    this._repDurations  = [];
    this._repScores     = [];
    this._sessionHigh   = 0;
    this._repStartTime  = null;
    this._lastAlert     = null;
    this._lastAlertTime = 0;
    this.isFatigued     = false;
  }

  // ─── Private ───────────────────────────────────────────────────────
  _checkSlowingReps() {
    const n = this._repDurations.length;
    if (n < this.minRepsToAnalyze) return false;

    // Baseline: average of first half of reps
    const halfN    = Math.floor(n / 2);
    const baseline = this._repDurations.slice(0, halfN).reduce((a,b)=>a+b,0) / halfN;
    const recent   = this._repDurations.slice(-3).reduce((a,b)=>a+b,0) / 3;

    return recent > baseline * (1 + this.slowThreshold);
  }

  _checkFormDegradation() {
    if (this._repScores.length < this.minRepsToAnalyze) return false;
    if (this._sessionHigh < 50) return false; // never had good form, can't degrade

    const recent = this._repScores.slice(-3).reduce((a,b)=>a+b,0) / 3;
    return (this._sessionHigh - recent) >= this.scoreDropThreshold;
  }
}
