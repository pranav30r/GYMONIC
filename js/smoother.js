/**
 * GYMONIC — One-Euro Filter for Temporal Smoothing
 * Implements §7.2.3 from blueprint: adaptive smoothing based on signal speed.
 */

export class OneEuroFilter {
  /**
   * @param {number} minCutoff - Minimum cutoff frequency (smoothing when still). Default 1.0.
   * @param {number} beta - Speed coefficient (responsiveness to fast changes). Default 0.007.
   * @param {number} dCutoff - Cutoff frequency for derivative computation. Default 1.0.
   */
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0.0;
    this.tPrev = null;
  }

  /**
   * Filter a new value.
   * @param {number} x - Raw value
   * @param {number} t - Timestamp in seconds
   * @returns {number} Smoothed value
   */
  filter(x, t) {
    if (this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }

    const dt = t - this.tPrev;
    if (dt <= 0) return this.xPrev;

    // Estimate derivative
    const dx = (x - this.xPrev) / dt;

    // Smooth derivative
    const alphaD = this._alpha(dt, this.dCutoff);
    const dxHat = alphaD * dx + (1 - alphaD) * this.dxPrev;

    // Adaptive cutoff based on speed
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);

    // Smooth signal
    const alpha = this._alpha(dt, cutoff);
    const xHat = alpha * x + (1 - alpha) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;

    return xHat;
  }

  _alpha(dt, cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0.0;
    this.tPrev = null;
  }
}

/**
 * Filter bank: manages one OneEuroFilter per joint angle.
 */
export class AngleSmootherBank {
  /**
   * @param {Object} configs - {jointName: {minCutoff, beta}} per joint, or defaults used.
   */
  constructor(configs = {}) {
    this.filters = {};
    this.configs = configs;
    this.defaults = { minCutoff: 1.5, beta: 0.007, dCutoff: 1.0 };
    this.velocities = {};
  }

  /**
   * Smooth all angles for a frame.
   * @param {Object} rawAngles - {joint_name: angle|null}
   * @param {number} timestampSec - Timestamp in seconds
   * @returns {Object} {joint_name: smoothedAngle|null}
   */
  smooth(rawAngles, timestampSec) {
    const smoothed = {};

    for (const [joint, rawAngle] of Object.entries(rawAngles)) {
      if (rawAngle === null) {
        smoothed[joint] = null;
        this.velocities[joint] = 0;
        continue;
      }

      if (!this.filters[joint]) {
        const cfg = this.configs[joint] || this.defaults;
        this.filters[joint] = new OneEuroFilter(cfg.minCutoff, cfg.beta, cfg.dCutoff);
        this._prevSmoothed = this._prevSmoothed || {};
        this._prevTimestamp = this._prevTimestamp || {};
      }

      const prevVal = this._prevSmoothed?.[joint];
      const prevTime = this._prevTimestamp?.[joint];
      smoothed[joint] = this.filters[joint].filter(rawAngle, timestampSec);

      // Compute angular velocity (degrees/second)
      if (prevVal !== undefined && prevTime !== undefined) {
        const dt = timestampSec - prevTime;
        this.velocities[joint] = dt > 0.001 ? (smoothed[joint] - prevVal) / dt : 0;
      } else {
        this.velocities[joint] = 0;
      }

      if (!this._prevSmoothed) this._prevSmoothed = {};
      if (!this._prevTimestamp) this._prevTimestamp = {};
      this._prevSmoothed[joint] = smoothed[joint];
      this._prevTimestamp[joint] = timestampSec;
    }

    return smoothed;
  }

  /**
   * Get angular velocity for a joint.
   * @param {string} joint
   * @returns {number} degrees/second (positive = extending, negative = flexing)
   */
  getVelocity(joint) {
    return this.velocities[joint] || 0;
  }

  reset() {
    for (const f of Object.values(this.filters)) {
      f.reset();
    }
    this.velocities = {};
  }
}
