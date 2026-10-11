import { describe, it, expect } from 'vitest';

describe('AbortSignal Compatibility in Test Environment', () => {
  it('provides matching AbortController and AbortSignal constructors on window and globalThis', () => {
    expect(globalThis.AbortController).toBeDefined();
    expect(globalThis.AbortSignal).toBeDefined();
    expect(window.AbortController).toBe(globalThis.AbortController);
    expect(window.AbortSignal).toBe(globalThis.AbortSignal);
  });

  it('accepts AbortController.signal in fetch without WebIDL brand check failure', async () => {
    const controller = new AbortController();
    
    // We expect fetch to accept the signal and attempt the request (not throw TypeError: Expected signal to be an instance of AbortSignal)
    const fetchPromise = fetch('http://127.0.0.1:59999/test-endpoint', {
      signal: controller.signal,
    });

    // It should reject with a network error (e.g. ECONNREFUSED) rather than a brand-check TypeError
    await expect(fetchPromise).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof Error)) return false;
      return !err.message.includes('Expected signal') && !err.message.includes('instance of AbortSignal');
    });
  });

  it('rejects with AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetch('http://127.0.0.1:59999/test-endpoint', { signal: controller.signal }))
      .rejects.toSatisfy((err: unknown) => {
        return err instanceof DOMException && err.name === 'AbortError';
      });
  });

  it('rejects with AbortError when signal is aborted mid-request', async () => {
    const controller = new AbortController();

    const fetchPromise = fetch('http://127.0.0.1:59999/slow-endpoint', {
      signal: controller.signal,
    });

    // Abort shortly after calling fetch
    controller.abort();

    await expect(fetchPromise).rejects.toSatisfy((err: unknown) => {
      return (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError');
    });
  });
});
