import '@testing-library/jest-dom';

// Chrome mock API for Vitest environment
if (typeof globalThis.chrome === 'undefined') {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      sendMessage: vi.fn(),
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

// JSDOM doesn't implement document.elementFromPoint; stub it so the cursor
// render loop and HoverDetector don't throw. Individual tests can override
// this with vi.spyOn(document, 'elementFromPoint').
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

// JSDOM doesn't implement ResizeObserver; stub it so HoverHighlighter doesn't
// throw during unit tests. The observer will simply not fire callbacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// JSDOM doesn't implement PointerEvent; stub it so HoverDetector's synthetic
// event dispatch doesn't throw during unit tests.
if (typeof globalThis.PointerEvent === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  };
}
