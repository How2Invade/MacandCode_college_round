/**
 * One Euro Filter implementation in TypeScript.
 * Removes high-frequency jitter while maintaining low lag during rapid movements.
 */

class LowPassFilter {
  private y: number;
  private s: number;
  private a: number;
  private initialized: boolean;

  constructor(alpha: number, initVal = 0) {
    this.y = initVal;
    this.s = initVal;
    this.a = alpha;
    this.initialized = false;
  }

  setAlpha(alpha: number) {
    if (alpha <= 0 || alpha > 1) {
      console.warn("alpha should be in (0.0, 1.0]");
    }
    this.a = alpha;
  }

  filter(value: number): number {
    let result: number;
    if (this.initialized) {
      result = this.a * value + (1 - this.a) * this.s;
    } else {
      result = value;
      this.initialized = true;
    }
    this.y = value;
    this.s = result;
    return result;
  }

  filterWithAlpha(value: number, alpha: number): number {
    this.setAlpha(alpha);
    return this.filter(value);
  }

  hasLastRawValue(): boolean {
    return this.initialized;
  }

  lastRawValue(): number {
    return this.y;
  }

  reset() {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  private freq: number;
  private mincutoff: number;
  private beta_: number;
  private dcutoff: number;
  private x: LowPassFilter;
  private dx: LowPassFilter;
  private lasttime?: number;

  constructor(freq: number, mincutoff = 1, beta = 0, dcutoff = 1) {
    this.freq = freq;
    this.mincutoff = mincutoff;
    this.beta_ = beta;
    this.dcutoff = dcutoff;
    this.x = new LowPassFilter(this.alpha(mincutoff));
    this.dx = new LowPassFilter(this.alpha(dcutoff));
  }

  private alpha(cutoff: number): number {
    const te = 1 / this.freq;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / te);
  }

  setFrequency(freq: number) {
    if (freq <= 0) console.warn("freq should be >0");
    this.freq = freq;
  }

  setMinCutoff(mincutoff: number) {
    if (mincutoff <= 0) console.warn("mincutoff should be >0");
    this.mincutoff = mincutoff;
  }

  setBeta(beta: number) {
    this.beta_ = beta;
  }

  setDerivateCutoff(dcutoff: number) {
    if (dcutoff <= 0) console.warn("dcutoff should be >0");
    this.dcutoff = dcutoff;
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lasttime = undefined;
  }

  filter(value: number, timestamp?: number): number {
    if (this.lasttime !== undefined && timestamp !== undefined) {
      const dtime = timestamp - this.lasttime;
      if (dtime > 0) {
        this.freq = 1 / dtime;
      }
    }
    this.lasttime = timestamp;
    const dx = this.x.hasLastRawValue() ? (value - this.x.lastRawValue()) * this.freq : 0;
    const edx = this.dx.filterWithAlpha(dx, this.alpha(this.dcutoff));
    const cutoff = this.mincutoff + this.beta_ * Math.abs(edx);
    return this.x.filterWithAlpha(value, this.alpha(cutoff));
  }
}
