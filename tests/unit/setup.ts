import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Chrome mock API for Vitest environment
if (typeof globalThis.chrome === 'undefined') {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getManifest: vi.fn().mockReturnValue({}),
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 1, url: 'https://example.com' },
      ]),
      sendMessage: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 2 }),
      goBack: vi.fn().mockResolvedValue(undefined),
      goForward: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({
        id: 1,
        url: 'https://example.com',
      }),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([{ result: undefined }]),
    },
    windows: {
      getLastFocused: vi.fn().mockResolvedValue({
        id: 1,
        type: 'normal',
      }),
    },
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

// Mock matchMedia for tests that use responsive UI features.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// JSDOM doesn't implement document.elementFromPoint.
// Stub it so cursor rendering and HoverDetector don't throw.
if (
  typeof document !== 'undefined' &&
  typeof document.elementFromPoint !== 'function'
) {
  document.elementFromPoint = () => null;
}

// JSDOM doesn't implement ResizeObserver.
// The observer won't fire callbacks during tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
  };
}

// JSDOM doesn't implement PointerEvent.
// Provide a basic stub for synthetic pointer events.
if (typeof globalThis.PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  // Assign the stub for the JSDOM test environment.
  (globalThis as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
    PointerEventStub as unknown as typeof PointerEvent;
}

// Align window.AbortController and window.AbortSignal with Node's native implementation in JSDOM
if (typeof window !== 'undefined' && typeof globalThis.AbortController !== 'undefined') {
  window.AbortController = globalThis.AbortController;
  window.AbortSignal = globalThis.AbortSignal;
}

// Ensure fetch supports aborting without undici webidl brand-check mismatch in JSDOM environment
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  const wrappedFetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (init && init.signal) {
      const { signal, ...rest } = init;
      if (signal.aborted) {
        const error = new DOMException('The operation was aborted.', 'AbortError');
        return Promise.reject(error);
      }
      const fetchPromise = originalFetch(input, rest);
      if (typeof signal.addEventListener === 'function') {
        return Promise.race([
          fetchPromise,
          new Promise<Response>((_, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              },
              { once: true }
            );
          }),
        ]);
      }
      return fetchPromise;
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = wrappedFetch;
  if (typeof window !== 'undefined') {
    window.fetch = wrappedFetch;
  }
}

