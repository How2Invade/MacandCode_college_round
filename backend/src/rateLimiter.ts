/**
 * In-Memory Sliding Window Rate Limiter
 * Protects backend from DoS, brute force, and runaway LLM budget exhaustion.
 */

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequestsPerWindow: number;
  private windowMs: number;

  constructor(maxRequestsPerWindow = 60, windowMs = 60_000) {
    this.maxRequestsPerWindow = maxRequestsPerWindow;
    this.windowMs = windowMs;
  }

  public isAllowed(clientIp: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const timestamps = (this.requests.get(clientIp) || []).filter(
      (ts) => now - ts < this.windowMs
    );

    if (timestamps.length >= this.maxRequestsPerWindow) {
      const oldest = timestamps[0];
      const resetMs = this.windowMs - (now - oldest);
      return { allowed: false, remaining: 0, resetMs };
    }

    timestamps.push(now);
    this.requests.set(clientIp, timestamps);

    return {
      allowed: true,
      remaining: this.maxRequestsPerWindow - timestamps.length,
      resetMs: this.windowMs,
    };
  }

  public reset(): void {
    this.requests.clear();
  }
}
