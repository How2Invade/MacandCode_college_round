/**
 * Hand-Tracking Module — Extended Type Definitions
 *
 * These types are internal to the hand-tracking module.
 * The shared ITracker, PointerPosition, TrackingStatus, and TrackingEvent
 * contracts remain untouched and are consumed from src/shared/types/tracking.ts.
 */

import { GestureType } from '../../shared/types/tracking';

// ─── MediaPipe Shim ──────────────────────────────────────────────────────────
// Minimal types that mirror what @mediapipe/tasks-vision exposes at runtime.
// We declare only what we actually use so the module compiles even when the
// MediaPipe package is not fully resolved in the test environment.

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface HandLandmarks {
  landmarks: NormalizedLandmark[];
  worldLandmarks: NormalizedLandmark[];
  handedness: string;   // "Left" | "Right"
  score: number;        // overall detection confidence
}

export interface HandLandmarkerResult {
  landmarks: NormalizedLandmark[][];
  worldLandmarks: NormalizedLandmark[][];
  handedness: Array<Array<{ categoryName: string; score: number }>>;
}

// Well-known MediaPipe hand landmark indices
export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

// ─── Preferred Hand ──────────────────────────────────────────────────────────
export type PreferredHand = 'left' | 'right' | 'any';

// ─── Calibration ─────────────────────────────────────────────────────────────
export interface CalibrationFrame {
  x: number;
  y: number;
  timestamp: number;
}

export interface CalibrationBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CalibrationResult {
  preferredHand: PreferredHand;
  bounds: CalibrationBounds;
  dominantHandLabel: string;
  completedAt: number;
  durationMs: number;
}

// ─── Gesture ─────────────────────────────────────────────────────────────────
export type GestureTransitionType =
  | 'pinch_start'
  | 'pinch_end'
  | 'pinch_hold'
  | 'air_click'
  | 'scroll_start'
  | 'scroll_end'
  | 'zoom_in'
  | 'zoom_out'
  | 'tab_next'
  | 'tab_previous'
  | 'scroll_up'
  | 'scroll_down'
  | 'undo'
  | 'redo'
  | 'thumbs_up'
  | 'thumbs_down'
  | 'shaka'
  | 'palm_open'
  | 'fist'
  | 'screenshot'
  | 'none';

export interface GestureEvent {
  type: GestureTransitionType;
  gesture: GestureType;
  confidence: number;
  timestamp: number;
  /** Distance ratio used to detect the gesture (0–1) */
  metric: number;
}

// ─── Hand Tracking Config ────────────────────────────────────────────────────
export interface HandTrackingConfig {
  /** Mirror the x-axis to match natural selfie-view movement */
  mirrorX: boolean;
  /** Pointer sensitivity multiplier applied after normalisation */
  sensitivity: number;
  /** One Euro Filter minimum cutoff frequency (Hz). Lower = smoother but laggier */
  filterMinCutoff: number;
  /** One Euro Filter speed coefficient. Higher = less lag on fast movement */
  filterBeta: number;
  /** Number of consecutive frames a hand must appear before it is considered stable */
  stabilityFrames: number;
  /** Pinch distance (0–1 ratio of palm size) threshold to trigger a gesture */
  pinchThreshold: number;
  /** Minimum ms between repeated gesture events */
  gestureCooldownMs: number;
  /** Number of frames a gesture must persist before being recognised */
  gestureDebounceFrames: number;
  /** Whether to enable pinch-and-hold drag signalling */
  enableDrag: boolean;
  /** Scroll gesture: close ring, middle and pinky fingers while pointing */
  enableScrollGesture: boolean;
}

export const DEFAULT_HAND_TRACKING_CONFIG: HandTrackingConfig = {
  mirrorX: true,
  sensitivity: 1.0,
  // Tuned for direct cursor control: suppress tiny resting jitter without
  // making a deliberate hand movement feel like it is dragging through syrup.
  filterMinCutoff: 2.5,
  filterBeta: 0.15,
  stabilityFrames: 2,
  // A real webcam pinch rarely makes the two landmark tips mathematically
  // overlap.  This palm-width ratio accepts a natural thumb-to-index touch
  // while remaining far below a resting open-hand separation.
  pinchThreshold: 0.28,
  gestureCooldownMs: 400,
  gestureDebounceFrames: 2,
  enableDrag: false,
  enableScrollGesture: true,
};

// ─── Performance Metrics ─────────────────────────────────────────────────────
export interface PerformanceMetrics {
  frameCount: number;
  averageFrameMs: number;
  /** Time from raw landmark to emitted pointer event (ms) */
  averageCursorLatencyMs: number;
  /** Percentage of frames where a hand was detected */
  detectionRate: number;
  droppedFrames: number;
}
