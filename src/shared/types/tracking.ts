/**
 * Tracking Types and Interfaces
 * Shared contract for Handsfree motion tracking.
 */

export type TrackingMode = "hand" | "head";

export type TrackingState =
  | "idle"
  | "starting"
  | "calibrating"
  | "active"
  | "lost"
  | "paused"
  | "error";

export interface PointerPosition {
  x: number; // Normalised: 0 to 1
  y: number; // Normalised: 0 to 1
  confidence: number; // 0 to 1
  timestamp: number;
}

export interface TrackingStatus {
  mode: TrackingMode;
  state: TrackingState;
  confidence: number;
  message?: string;
}

export type GestureType =
  | "none"
  | "pinch"
  | "air_click"
  | "point"
  | "fist"
  | "thumbs_up"
  | "thumbs_down"
  | "shaka"
  | "palm_open"
  | "zoom_in"
  | "zoom_out"
  | "tab_next"
  | "tab_previous"
  | "scroll_up"
  | "scroll_down"
  | "undo"
  | "redo"
  | "nod"
  | "shake"
  | "tab_left"
  | "tab_right"
  | "undo"
  | "redo"
  | "double_blink"
  | "screenshot"
  | "dwell";

export interface TrackingEvent {
  timestamp: number;
  mode: TrackingMode;
  position: PointerPosition;
  gesture: GestureType;
  confidence: number;
}

/** Raw MediaPipe landmarks exposed only by trackers that support preview overlays. */
export interface HandLandmarkerResult {
  landmarks: { x: number; y: number; z: number; visibility?: number }[][];
  handedness: { categoryName: string; score: number }[][];
}

export interface ITracker {
  initialize(): Promise<void>;
  start(mode?: TrackingMode): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  calibrate(): Promise<void>;
  getStatus(): TrackingStatus;
  onPointerMove(listener: (pos: PointerPosition) => void): () => void;
  onTrackingEvent(listener: (event: TrackingEvent) => void): () => void;
  onRawResult?(listener: (result: HandLandmarkerResult) => void): () => void;
  destroy(): Promise<void>;
}
