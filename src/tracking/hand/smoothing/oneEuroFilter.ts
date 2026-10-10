/**
 * One Euro Filter — tested, configurable low-latency smoothing filter.
 *
 * Based on the algorithm by Géry Casiez, Nicolas Roussel, Daniel Vogel.
 * Reference: https://hal.inria.fr/hal-00670496/document
 *
 * The filter reduces jitter at low speeds while keeping latency low at
 * high speeds, making it well-suited for free-moving cursor control.
 */

export interface OneEuroFilterConfig {
  /** Minimum cutoff frequency in Hz — controls smoothing at rest. Lower = smoother. */
  minCutoff: number;
  /** Speed coefficient — controls how quickly the filter reacts to movement. */
  beta: number;
  /** Derivative cutoff in Hz — controls how the derivative is smoothed. */
  dCutoff: number;
}

function alpha(cutoff: number, rate: number): number {
  const te = 1.0 / rate;
  const tau = 1.0 / (2.0 * Math.PI * cutoff);
  return 1.0 / (1.0 + tau / te);
}

class LowPassFilter {
  private initialized = false;
  private xFilt = 0;

  constructor(private a: number) {}

  filter(x: number, alphaValue?: number): number {
    if (alphaValue !== undefined) {
      this.a = alphaValue;
    }
    if (!this.initialized) {
      this.xFilt = x;
      this.initialized = true;
      return x;
    }
    const result = this.a * x + (1.0 - this.a) * this.xFilt;
    this.xFilt = result;
    return result;
  }

  lastValue(): number {
    return this.xFilt;
  }

  reset(): void {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  private readonly xFilt: LowPassFilter;
  private readonly dxFilt: LowPassFilter;
  private lastTime: number | null = null;
  private lastValue: number | null = null;

  constructor(private readonly config: OneEuroFilterConfig) {
    this.xFilt = new LowPassFilter(0);
    this.dxFilt = new LowPassFilter(alpha(config.dCutoff, 120));
  }

  /**
   * Filter a single scalar value.
   * @param value   The raw input value (e.g. a normalised coordinate 0–1).
   * @param timestamp_ms   Current time in ms (monotonically increasing).
   */
  filter(value: number, timestamp_ms: number): number {
    let rate = 120; // assume 120 Hz if no previous timestamp
    if (this.lastTime !== null) {
      const dt = (timestamp_ms - this.lastTime) / 1000.0;
      rate = dt > 0 ? 1.0 / dt : rate;
    }
    this.lastTime = timestamp_ms;

    // Derivative
    const dx = this.lastValue !== null ? (value - this.lastValue) * rate : 0;
    this.lastValue = value;

    const edx = this.dxFilt.filter(dx, alpha(this.config.dCutoff, rate));
    const cutoff = this.config.minCutoff + this.config.beta * Math.abs(edx);
    return this.xFilt.filter(value, alpha(cutoff, rate));
  }

  reset(): void {
    this.xFilt.reset();
    this.dxFilt.reset();
    this.lastTime = null;
    this.lastValue = null;
  }
}

/** A 2-D One Euro Filter that independently filters X and Y axes. */
export class OneEuroFilter2D {
  private readonly filterX: OneEuroFilter;
  private readonly filterY: OneEuroFilter;

  constructor(config: OneEuroFilterConfig) {
    this.filterX = new OneEuroFilter(config);
    this.filterY = new OneEuroFilter(config);
  }

  filter(x: number, y: number, timestamp_ms: number): { x: number; y: number } {
    return {
      x: this.filterX.filter(x, timestamp_ms),
      y: this.filterY.filter(y, timestamp_ms),
    };
  }

  reset(): void {
    this.filterX.reset();
    this.filterY.reset();
  }
}
