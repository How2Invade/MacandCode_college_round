/**
 * HandTracker
 *
 * Core implementation of the ITracker interface for webcam-based hand tracking.
 *
 * Architecture:
 *   CameraManager ──► VideoElement
 *                          │
 *                          ▼
 *              @mediapipe/tasks-vision HandLandmarker
 *                          │
 *                          ▼
 *               HandSelectionManager (stable hand lock)
 *                          │
 *                          ▼
 *               GestureDetector (pinch, scroll)
 *                          │
 *               CoordinateMapper (calibrated, mirrored)
 *                          │
 *               OneEuroFilter2D (jitter smoothing)
 *                          │
 *                          ▼
 *              onPointerMove / onTrackingEvent listeners
 *
 * All class internals are kept private. The public surface matches ITracker exactly.
 */

import {
  ITracker,
  TrackingMode,
  TrackingStatus,
  TrackingState,
  PointerPosition,
  TrackingEvent,
  GestureType,
} from '../../shared/types/tracking';

import { CameraManager } from './cameraManager';
import { HandSelectionManager, DetectedHand } from './handSelectionManager';
import { CoordinateMapper } from './coordinateMapper';
import { OneEuroFilter2D } from './smoothing/oneEuroFilter';
import { GestureDetector } from './gestures/gestureDetector';
import { CalibrationEngine, CalibrationState } from './calibration/calibrationEngine';
import {
  HandTrackingConfig,
  DEFAULT_HAND_TRACKING_CONFIG,
  HandLandmarkerResult,
  NormalizedLandmark,
  LANDMARK,
} from './types';
import { logger } from '../../shared/utils';

interface HandLandmarker {
  detectForVideo(
    source: HTMLCanvasElement,
    timestamp: number
  ): HandLandmarkerResult;
  close(): void;
}

interface HandLandmarkerClass {
  createFromOptions(
    vision: unknown,
    options: {
      baseOptions: { modelAssetBuffer: Uint8Array; delegate?: string };
      runningMode: 'VIDEO';
      numHands: number;
      minHandDetectionConfidence: number;
      minHandPresenceConfidence: number;
      minTrackingConfidence: number;
    }
  ): Promise<HandLandmarker>;
}

// ─── Constants ────────────────────────────────────────────────────────────────
/**
 * Resolve bundled extension assets instead of relying on a CDN.  Extension
 * pages are subject to a restrictive CSP, so a remote MediaPipe runtime can
 * make the Start button appear to do nothing when the fetch is blocked.
 */
function extensionAsset(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return new URL(path, window.location.origin).toString();
}

// ─── HandTracker ──────────────────────────────────────────────────────────────

export class HandTracker implements ITracker {
  // State
  private state: TrackingState = 'idle';
  private mode: TrackingMode = 'hand';
  private errorMessage: string | undefined;

  // MediaPipe's WASM runtime needs an extension page (not a Vite module
  // worker) because its generated loader relies on ModuleFactory globals.
  private landmarker: HandLandmarker | null = null;
  private inferenceCanvas: HTMLCanvasElement | null = null;
  private inferenceContext: CanvasRenderingContext2D | null = null;

  // Sub-systems
  private readonly camera: CameraManager;
  private readonly selector: HandSelectionManager;
  private readonly mapper: CoordinateMapper;
  private readonly filter: OneEuroFilter2D;
  private readonly gestures: GestureDetector;
  private readonly calibration: CalibrationEngine;

  // Animation loop
  private animFrameId: number | null = null;
  private lastFrameTimestamp = -1;
  private processedFrames = 0;
  private resultFrames = 0;
  private lastResultHandCount = 0;
  private lastInferenceMs = 0;
  private lastPointingPose = false;
  private lastPointerAt = 0;
  private calibrationPromise: Promise<void> | null = null;
  private cancelCalibrationRun: (() => void) | null = null;
  private readonly diagnosticTimes = new Map<string, number>();

  // Event listeners
  private readonly pointerListeners: Array<(pos: PointerPosition) => void> = [];
  private readonly trackingListeners: Array<(event: TrackingEvent) => void> = [];
  private readonly rawListeners: Array<(result: HandLandmarkerResult) => void> = [];

  // Last known pointer for tracking events
  private lastPointer: PointerPosition = { x: 0.5, y: 0.5, confidence: 0, timestamp: 0 };

  constructor(config: HandTrackingConfig = DEFAULT_HAND_TRACKING_CONFIG) {
    // 640×480 carries more than enough detail for 21 hand landmarks while
    // reducing per-frame inference work dramatically from a 720p source.
    this.camera = new CameraManager({ idealWidth: 640, idealHeight: 480, maxFps: 60 });
    this.selector = new HandSelectionManager('any', config.stabilityFrames);
    this.mapper = new CoordinateMapper(config);
    this.filter = new OneEuroFilter2D({
      minCutoff: config.filterMinCutoff,
      beta: config.filterBeta,
      dCutoff: 1.0,
    });
    this.gestures = new GestureDetector(config);
    this.calibration = new CalibrationEngine();

    // Pipe gesture events into tracking events
    this.gestures.onGestureEvent((gestureEvent) => {
      const gestureType: GestureType = gestureEvent.gesture;

      const trackingEvent: TrackingEvent = {
        timestamp: gestureEvent.timestamp,
        mode: this.mode,
        position: { ...this.lastPointer },
        gesture: gestureType,
        confidence: gestureEvent.confidence,
      };

      for (const listener of this.trackingListeners) {
        listener(trackingEvent);
      }
    });
  }

  // ─── ITracker public interface ───────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.landmarker) return;
    if (this.state !== 'idle') return;
    this.setState('starting');

    try {
      const modelResponse = await fetch(extensionAsset('models/hand_landmarker.task'));
      if (!modelResponse.ok) {
        throw new Error(`Could not load hand model (HTTP ${modelResponse.status}).`);
      }
      const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
      if (modelAssetBuffer.byteLength < 1_000_000) {
        throw new Error('The bundled hand model is incomplete.');
      }
      this.logDiagnostic('model', 'Loaded bundled hand model.', {
        bytes: modelAssetBuffer.byteLength,
      });

      const { HandLandmarker, FilesetResolver } = await this.importMediaPipe();
      const vision = await (FilesetResolver as any).forVisionTasks(extensionAsset('wasm'));
      this.landmarker = await (HandLandmarker as HandLandmarkerClass).createFromOptions(vision, {
        baseOptions: { modelAssetBuffer, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.25,
        minHandPresenceConfidence: 0.25,
        minTrackingConfidence: 0.25,
      });
      this.logDiagnostic('runtime', 'MediaPipe HandLandmarker initialized from bundled WASM.');
      this.setState('idle');
    } catch (err: unknown) {
      this.errorMessage = `Failed to load hand-tracking model: ${String(err)}`;
      this.setState('error');
      throw err;
    }
  }

  async start(mode?: TrackingMode): Promise<void> {
    this.mode = mode ?? 'hand';

    if (!this.landmarker) {
      await this.initialize();
    }

    if (this.state === 'error') {
      this.setState('idle');
      this.errorMessage = undefined;
    }

    if (this.state === 'active') return;

    this.setState('starting');

    try {
      await this.camera.start();
    } catch (err: unknown) {
      const cameraError = err as { message?: string };
      this.errorMessage = cameraError.message ?? 'Camera access failed';
      this.setState('error');
      throw err;
    }

    // Wait for the video element to have dimensions before starting loop.
    // Keeping this in the failure path prevents a stuck "starting" UI when a
    // camera device grants access but never returns frames.
    try {
      await this.waitForVideo();
    } catch (err) {
      this.camera.stop();
      this.errorMessage = (err as Error).message;
      this.setState('error');
      throw err;
    }

    this.selector.reset();
    this.filter.reset();
    this.gestures.reset();
    this.setState('active');
    this.lastFrameTimestamp = -1;
    this.processedFrames = 0;
    this.resultFrames = 0;
    this.lastResultHandCount = 0;
    this.lastInferenceMs = 0;
    this.lastPointingPose = false;
    this.lastPointerAt = 0;
    this.initializeInferenceCanvas();
    this.scheduleFrame();
  }

  async pause(): Promise<void> {
    if (this.state !== 'active') return;
    this.cancelFrame();
    this.setState('paused');
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.setState('active');
    this.lastFrameTimestamp = -1;
    this.scheduleFrame();
  }

  async stop(): Promise<void> {
    this.cancelCalibrationRun?.();
    this.cancelFrame();
    this.camera.stop();
    this.gestures.reset();
    this.selector.reset();
    this.filter.reset();
    this.setState('idle');
  }

  async calibrate(): Promise<void> {
    if (this.calibrationPromise) return this.calibrationPromise;
    if (this.state !== 'active') {
      throw new Error('Start hand tracking before calibration.');
    }
    this.setState('calibrating');
    this.calibration.start();

    // Calibration data is fed by the processing loop.
    // This promise resolves when calibration completes (or times out after 40 s).
    this.calibrationPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      let check: ReturnType<typeof setInterval>;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(check);
        clearTimeout(timeout);
        this.cancelCalibrationRun = null;
        this.calibrationPromise = null;
        if (this.state !== 'error') this.setState('active');
        if (error) reject(error);
        else resolve();
      };
      const applyResult = () => {
        const result = this.calibration.getResult();
        if (result) {
          this.mapper.updateBounds(result.bounds);
          this.selector.setPreferredHand(result.preferredHand);
        }
      };

      this.cancelCalibrationRun = () => {
        if (settled) return;
        this.calibration.cancel();
        finish();
      };
      timeout = setTimeout(() => {
        if (!this.calibration.isComplete()) {
          const fallback = this.calibration.cancel();
          this.mapper.updateBounds(fallback.bounds);
          this.selector.setPreferredHand(fallback.preferredHand);
          finish(); // graceful fallback — not an error
        }
      }, 40_000);

      check = setInterval(() => {
        if (this.calibration.isComplete()) {
          applyResult();
          finish();
        }
        if (this.state === 'error') {
          finish(new Error(this.errorMessage ?? 'Calibration failed'));
        }
      }, 200);
    });
    return this.calibrationPromise;
  }

  getStatus(): TrackingStatus {
    return {
      mode: this.mode,
      state: this.state,
      confidence: this.lastPointer.confidence,
      message: this.errorMessage,
    };
  }

  onPointerMove(listener: (pos: PointerPosition) => void): () => void {
    this.pointerListeners.push(listener);
    return () => {
      const idx = this.pointerListeners.indexOf(listener);
      if (idx !== -1) this.pointerListeners.splice(idx, 1);
    };
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.camera?.video || null;
  }

  getCalibrationState(): CalibrationState {
    return this.calibration.getState();
  }

  /** Lightweight runtime telemetry for the preview, not persisted anywhere. */
  getDiagnostics(): {
    processedFrames: number;
    resultFrames: number;
    hands: number;
    inferenceMs: number;
    pointing: boolean;
    pointerActive: boolean;
  } {
    return {
      processedFrames: this.processedFrames,
      resultFrames: this.resultFrames,
      hands: this.lastResultHandCount,
      inferenceMs: this.lastInferenceMs,
      pointing: this.lastPointingPose,
      pointerActive: Date.now() - this.lastPointerAt < 500,
    };
  }

  onTrackingEvent(listener: (event: TrackingEvent) => void): () => void {
    this.trackingListeners.push(listener);
    return () => {
      const idx = this.trackingListeners.indexOf(listener);
      if (idx !== -1) this.trackingListeners.splice(idx, 1);
    };
  }

  onRawResult(listener: (result: HandLandmarkerResult) => void): () => void {
    this.rawListeners.push(listener);
    return () => {
      const idx = this.rawListeners.indexOf(listener);
      if (idx !== -1) this.rawListeners.splice(idx, 1);
    };
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.pointerListeners.length = 0;
    this.trackingListeners.length = 0;
    this.setState('idle');
  }

  // ─── Frame Loop ──────────────────────────────────────────────────────────────

  private scheduleFrame(): void {
    if (this.animFrameId !== null) return;
    this.animFrameId = requestAnimationFrame(this.processFrame);
  }

  private cancelFrame(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private processFrame = (timestamp: number): void => {
    this.animFrameId = null;

    // "lost" means no hand is currently visible, not that camera inference
    // should stop. Keeping this loop alive is what lets a hand entering the
    // frame be acquired on a later frame.
    if (this.state !== 'active' && this.state !== 'calibrating' && this.state !== 'lost') return;
    if (!this.landmarker || !this.camera.isVideoReady()) {
      this.scheduleFrame();
      return;
    }

    const msTimestamp = Math.floor(timestamp);
    if (msTimestamp <= this.lastFrameTimestamp) {
      this.scheduleFrame();
      return;
    }
    this.lastFrameTimestamp = msTimestamp;

    try {
      if (!this.inferenceCanvas || !this.inferenceContext) {
        throw new Error('Hand-tracking canvas is unavailable.');
      }
      this.inferenceContext.drawImage(this.camera.video, 0, 0, 320, 240);
      const inferenceStart = performance.now();
      const result = this.landmarker.detectForVideo(this.inferenceCanvas, msTimestamp);
      this.lastInferenceMs = performance.now() - inferenceStart;
      this.processedFrames++;
      this.lastResultHandCount = result.landmarks?.length ?? 0;
      if (this.lastResultHandCount > 0) this.resultFrames++;
      this.logDiagnostic('inference', 'Hand inference result.', {
        hands: this.lastResultHandCount,
        inferenceMs: Math.round(this.lastInferenceMs),
      });
      this.handleResult(result, msTimestamp);
      for (const listener of this.rawListeners) listener(result);
    } catch (err) {
      this.errorMessage = `Hand-tracking inference failed: ${String(err)}`; console.error('INFERENCE FAILED: ', err);
      this.setState('error');
      console.error('HandTracker processing error:', err);
      return;
    }

    // Yield between inference calls. This guarantees React and canvas paints
    // are committed continuously instead of appearing only after a button tap.
    setTimeout(() => this.scheduleFrame(), 16);
  };

  private handleResult(result: HandLandmarkerResult, timestamp: number): void {
    const detectedHands: DetectedHand[] = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      const handedness = result.handedness[i]?.[0]?.categoryName ?? '';
      const landmarks = result.landmarks[i] as NormalizedLandmark[];
      // The task's presence/tracking thresholds above already decide whether a
      // hand belongs in `result.landmarks`. Do not reject it a second time on a
      // classification score: doing so caused real, edge-of-frame hands to be
      // displayed as "active" but never drive the cursor.
      if (landmarks.length === 21) {
        detectedHands.push({ landmarks, handedness });
      }
    }

    // ── Calibration path ──
    if (this.state === 'calibrating') {
      this.lastPointingPose = false;
      const firstHand = detectedHands[0] ?? null;
      this.calibration.processFrame(
        firstHand?.handedness ?? null,
        firstHand?.landmarks ?? null
      );
      return; // Don't emit pointer events during calibration
    }

    // ── Active path ──
    const selectedLandmarks = this.selector.select(detectedHands);
    const selectorState = this.selector.getState();

    if (!selectedLandmarks || selectorState !== 'active') {
      this.lastPointingPose = false;
      this.logDiagnostic('selection', 'Waiting for a stable control hand.', {
        detectedHands: detectedHands.length,
        selection: selectorState,
      });
      this.gestures.process(null, timestamp);
      // Await a stable hand without stopping the camera loop. Previously this
      // transitioned the global tracker to `lost`, but the loop intentionally
      // only runs while active/calibrating—so it processed exactly one frame.
      return;
    }

    // An open palm must never drive the cursor.  Only a deliberate pointing
    // pose (index extended while the other fingers are folded) may emit a
    // pointer position.  The gesture processor still receives every frame so
    // thumb–index pinches continue to work after the cursor is positioned.
    const isPointing = this.isIndexPointingPose(selectedLandmarks);
    this.lastPointingPose = isPointing;
    if (isPointing) {
      const tip: NormalizedLandmark = selectedLandmarks[LANDMARK.INDEX_TIP];
      const confidence = detectedHands[0]
        ? (result.handedness[0]?.[0]?.score ?? 1)
        : 1;

      // Smooth the raw coordinates
      const smoothed = this.filter.filter(tip.x, tip.y, timestamp);

      // Map to normalised screen space
      const position = this.mapper.map(smoothed.x, smoothed.y, confidence, timestamp);
      position.timestamp = Date.now(); // Override so it works across contexts
      this.lastPointer = position;
      this.lastPointerAt = position.timestamp;
      this.logDiagnostic('pointer', 'Emitting normalized pointer position.', {
        x: Number(position.x.toFixed(3)),
        y: Number(position.y.toFixed(3)),
        confidence: Number(position.confidence.toFixed(3)),
      });

      // Emit pointer event
      for (const listener of this.pointerListeners) {
        listener(position);
      }
    } else {
      this.logDiagnostic('pose', 'Hand detected, but pointing-pose gate is closed.', {
        detectedHands: detectedHands.length,
      });
    }

    // Process gestures
    this.gestures.process(selectedLandmarks, timestamp);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private setState(state: TrackingState): void {
    this.state = state;
    if (state !== 'error') {
      this.errorMessage = undefined;
    }
  }

  /** Diagnostic telemetry is deliberately sparse and contains no image or landmark data. */
  private logDiagnostic(key: string, message: string, data?: Record<string, number | string>): void {
    const now = Date.now();
    const last = this.diagnosticTimes.get(key) ?? 0;
    if (now - last < 1_000) return;
    this.diagnosticTimes.set(key, now);
    logger.info('HandTracker', message, data);
  }

  /**
   * Cursor activation intentionally needs more than a recognised hand.  It
   * requires the index finger to be extended and the other non-thumb fingers
   * to be folded, which prevents an ordinary open palm from moving the page.
   */
  private isIndexPointingPose(landmarks: NormalizedLandmark[]): boolean {
    const isExtended = (tip: number, mcp: number): boolean => {
      const wrist = landmarks[LANDMARK.WRIST];
      const tipPoint = landmarks[tip];
      const mcpPoint = landmarks[mcp];
      const tipDistance = Math.hypot(tipPoint.x - wrist.x, tipPoint.y - wrist.y);
      const mcpDistance = Math.hypot(mcpPoint.x - wrist.x, mcpPoint.y - wrist.y);
      return tipDistance > mcpDistance * 1.15;
    };

    return isExtended(LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP)
      && !isExtended(LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP)
      && !isExtended(LANDMARK.RING_TIP, LANDMARK.RING_MCP)
      && !isExtended(LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP);
  }

  private initializeInferenceCanvas(): void {
    if (this.inferenceCanvas && this.inferenceContext) return;
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Could not create the hand-tracking canvas.');
    this.inferenceCanvas = canvas;
    this.inferenceContext = context;
  }

  private waitForVideo(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.camera.isVideoReady()) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (this.camera.isVideoReady()) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      // Do not report an active tracker if the camera never produced frames.
      setTimeout(() => {
        clearInterval(check);
        if (this.camera.isVideoReady()) {
          resolve();
        } else {
          reject(new Error('Camera started but did not provide video frames. Please try again.'));
        }
      }, 5000);
    });
  }

  private async importMediaPipe(): Promise<Record<string, unknown>> {
    try {
      return await import('@mediapipe/tasks-vision' as any) as Record<string, unknown>;
    } catch {
      throw new Error('Could not load @mediapipe/tasks-vision.');
    }
  }

}
