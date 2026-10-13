// Turns a stream of hand positions into chest compressions.
//
// Each video frame gives the hands' height in pixels and the arm length in
// pixels. Dividing by the arm length makes the signal independent of how far
// away the phone is. A light low-pass filter removes landmark jitter, and a
// peak detector with hysteresis finds each bottom (one compression) and top.
// It works on timestamps, not frame counts, so a phone that drops from 30 to
// 12 frames per second still reports the right rate.

// American Heart Association adult CPR targets.
export const AHA = {
  rateMin: 100,
  rateMax: 120,
  depthMinCm: 5,
  depthMaxCm: 6,
  fractionMin: 0.6,
  fractionGoal: 0.8,
  maxPauseS: 10,
};

// Typical adult shoulder-to-wrist length. It is the ruler for the depth
// estimate, which is why depth is always labeled "estimated".
export const ARM_CM = 58;
// A gap longer than this ends a run of compressions (under 30 per minute is not CPR).
export const PAUSE_MS = 2000;
// Faster than 240 per minute is noise, not compressions.
const MIN_INTERVAL_MS = 250;
// After a tracking gap this long, start the detector fresh.
const GAP_RESET_MS = 500;

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export class CompressionDetector {
  constructor({ armCm = ARM_CM, minAmp = 0.04, tauMs = 40 } = {}) {
    this.armCm = armCm;
    this.minAmp = minAmp; // in arm lengths, about 2.3 cm
    this.tauMs = tauMs;
    this.compressions = [];
    this.amps = [];
    this.scale = null;
    this.restart();
  }

  // Forget the signal but keep the count, e.g. after the rescuer leaves the frame.
  restart() {
    this.smooth = null;
    this.lastT = null;
    this.state = 'seekTop';
    this.ext = null;
    this.extT = null;
    this.top = null;
  }

  get count() {
    return this.compressions.length;
  }

  get lastAt() {
    return this.compressions.at(-1)?.t ?? null;
  }

  // t in ms, y = hand height in pixels (down is positive), scale = arm length in pixels.
  push(t, y, scale) {
    if (!Number.isFinite(t) || !Number.isFinite(y) || !(scale > 0)) return null;
    this.scale = this.scale === null ? scale : this.scale + 0.05 * (scale - this.scale);
    const u = y / this.scale;

    if (this.smooth === null || t - this.lastT > GAP_RESET_MS || t <= this.lastT) {
      this.smooth = u;
      this.lastT = t;
      this.state = 'seekTop';
      this.ext = u;
      this.extT = t;
      this.top = null;
      return null;
    }
    const alpha = 1 - Math.exp(-(t - this.lastT) / this.tauMs);
    this.smooth += alpha * (u - this.smooth);
    this.lastT = t;
    const s = this.smooth;
    const h = this.hysteresis();

    if (this.state === 'seekTop') {
      if (s < this.ext) {
        this.ext = s;
        this.extT = t;
      } else if (s - this.ext > h) {
        this.top = { t: this.extT, u: this.ext };
        this.state = 'seekBottom';
        this.ext = s;
        this.extT = t;
      }
      return null;
    }
    if (s > this.ext) {
      this.ext = s;
      this.extT = t;
      return null;
    }
    if (this.ext - s > h) {
      const event = this.bottom(this.extT, this.ext);
      this.state = 'seekTop';
      this.ext = s;
      this.extT = t;
      return event;
    }
    return null;
  }

  // The threshold adapts to the rescuer's own stroke so small jitter on a big
  // stroke is ignored but a shallow stroke still counts.
  hysteresis() {
    const typical = median(this.amps);
    return typical === null ? this.minAmp : Math.max(this.minAmp * 0.6, 0.35 * typical);
  }

  bottom(t, u) {
    if (!this.top) return null;
    const amp = u - this.top.u;
    if (amp < this.minAmp) return null;
    const prev = this.compressions.at(-1);
    const interval = prev ? t - prev.t : null;
    if (interval !== null && interval < MIN_INTERVAL_MS) return null;
    this.amps.push(amp);
    if (this.amps.length > 6) this.amps.shift();
    // The low-pass filter shrinks the stroke a little, more at faster rates.
    // Undo its known gain at this stroke's frequency.
    const hz = interval ? 1000 / interval : 110 / 60;
    const gain = 1 / Math.hypot(1, 2 * Math.PI * hz * (this.tauMs / 1000));
    const compression = { t, interval, depthCm: Math.round((amp / gain) * this.armCm * 10) / 10 };
    this.compressions.push(compression);
    return compression;
  }

  // Compressions per minute from the last few strokes, or null when paused
  // or not enough strokes yet.
  rate(now) {
    const c = this.compressions;
    if (c.length < 3 || now - c.at(-1).t > PAUSE_MS) return null;
    const intervals = [];
    for (let i = c.length - 1; i > 0 && intervals.length < 6; i--) {
      const iv = c[i].t - c[i - 1].t;
      if (iv > PAUSE_MS) break;
      intervals.push(iv);
    }
    if (intervals.length < 2) return null;
    return Math.round(60000 / median(intervals));
  }

  // Estimated depth in cm from the last few strokes.
  depth() {
    return median(this.compressions.slice(-5).map((c) => c.depthCm));
  }
}
