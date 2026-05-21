/**
 * GYMONIC — Rest Timer
 * Countdown between sets with auto-advance, skip, and voice countdown.
 */
export class RestTimer {
  constructor(opts = {}) {
    this.defaultDuration = opts.defaultDuration ?? 60; // seconds
    this._timer        = null;
    this._remaining    = 0;
    this._onComplete   = null;
    this._onTick       = null;
    this._onSkip       = null;
    this.isResting     = false;
  }

  /**
   * Start a rest countdown.
   * @param {number} seconds - Duration (default 60s)
   * @param {Function} onComplete - Called when timer hits 0
   * @param {Function} onTick - Called every second with (remaining)
   */
  start(seconds = this.defaultDuration, onComplete, onTick) {
    this.stop();
    this._remaining  = seconds;
    this._onComplete = onComplete;
    this._onTick     = onTick;
    this.isResting   = true;

    if (this._onTick) this._onTick(this._remaining);

    this._timer = setInterval(() => {
      this._remaining--;
      if (this._onTick) this._onTick(this._remaining);

      if (this._remaining <= 0) {
        this.stop();
        if (this._onComplete) this._onComplete();
      }
    }, 1000);
  }

  skip() {
    this.stop();
    if (this._onComplete) this._onComplete();
  }

  addTime(seconds) {
    this._remaining = Math.max(0, this._remaining + seconds);
    if (this._onTick) this._onTick(this._remaining);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.isResting   = false;
    this._remaining  = 0;
  }

  getRemaining() { return this._remaining; }
}
