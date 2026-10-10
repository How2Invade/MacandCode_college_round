/**
 * Camera Manager
 *
 * Handles all browser camera API interactions:
 * - Requests permission only on explicit user action.
 * - Guards against opening multiple streams accidentally.
 * - Releases tracks completely when stopped.
 * - Surfaces informative errors without crashing.
 */

export type CameraErrorCode =
  | 'permission_denied'
  | 'no_camera'
  | 'camera_in_use'
  | 'model_unavailable'
  | 'unknown';

export interface CameraError {
  code: CameraErrorCode;
  message: string;
  raw?: unknown;
}

export interface CameraManagerOptions {
  /** Ideal width in pixels — falls back gracefully */
  idealWidth?: number;
  idealHeight?: number;
  /** Frame rate cap — prevents unnecessary CPU load */
  maxFps?: number;
}

export class CameraManager {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;

  public readonly video: HTMLVideoElement;

  constructor(private readonly options: CameraManagerOptions = {}) {
    // Create a detached video element — the caller can attach it to the DOM
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    
    // MediaPipe requires explicit attributes to read video size
    this.video.addEventListener('loadedmetadata', () => {
      this.video.width = this.video.videoWidth;
      this.video.height = this.video.videoHeight;
    });

    this.videoEl = this.video;
  }

  /**
   * Request camera access and start streaming to this.video.
   * Throws a CameraError if anything fails.
   */
  async start(): Promise<void> {
    if (this.stream) {
      // Already running — do not open a second stream
      return;
    }

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: 'user',
        // `ideal` alone lets Chrome keep a high-resolution native stream.
        // Bound it as well so real-time inference has a predictable budget.
        width: this.options.idealWidth
          ? { ideal: this.options.idealWidth, max: this.options.idealWidth }
          : { ideal: 640, max: 640 },
        height: this.options.idealHeight
          ? { ideal: this.options.idealHeight, max: this.options.idealHeight }
          : { ideal: 480, max: 480 },
        frameRate: this.options.maxFps ? { max: this.options.maxFps } : { ideal: 30 },
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;
      if (this.videoEl) {
        this.videoEl.srcObject = stream;
        await this.videoEl.play().catch(() => {
          // Autoplay may be blocked in some contexts — safe to ignore, video will
          // begin as soon as user interacts.
        });
      }
    } catch (err: unknown) {
      throw this.interpretError(err);
    }
  }

  /**
   * Stop all camera tracks and detach from the video element.
   */
  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  isRunning(): boolean {
    return this.stream !== null && this.stream.active;
  }

  /** True once the video has enough metadata to determine dimensions. */
  isVideoReady(): boolean {
    return (
      !!this.videoEl &&
      this.videoEl.readyState >= HTMLMediaElement.HAVE_METADATA &&
      this.videoEl.videoWidth > 0
    );
  }

  get width(): number {
    return this.videoEl?.videoWidth ?? 0;
  }

  get height(): number {
    return this.videoEl?.videoHeight ?? 0;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private interpretError(err: unknown): CameraError {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') {
        return {
          code: 'permission_denied',
          message:
            'Camera permission was denied. Please allow camera access in your browser settings and try again.',
          raw: err,
        };
      }
      if (err.name === 'NotFoundError') {
        return {
          code: 'no_camera',
          message:
            'No camera was found. Please connect a webcam and try again.',
          raw: err,
        };
      }
      if (err.name === 'NotReadableError') {
        return {
          code: 'camera_in_use',
          message:
            'The camera is already in use by another application. Please close the other app and try again.',
          raw: err,
        };
      }
    }
    return {
      code: 'unknown',
      message: `Unexpected camera error: ${String(err)}`,
      raw: err,
    };
  }
}
