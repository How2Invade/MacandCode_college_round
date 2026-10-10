/**
 * Hand Tracking Module — Public API
 *
 * This is the single import point for the hand tracking subsystem.
 * Other modules should import from here, not from internal files.
 */

export { HandTracker } from './HandTracker';
export { CameraManager } from './cameraManager';
export { HandSelectionManager } from './handSelectionManager';
export { CoordinateMapper } from './coordinateMapper';
export { GestureDetector } from './gestures/gestureDetector';
export { HAND_CONNECTIONS } from './landmarkConnections';
export { actionForHandGesture } from './gestureActions';
export { CalibrationEngine } from './calibration/calibrationEngine';
export { OneEuroFilter, OneEuroFilter2D } from './smoothing/oneEuroFilter';

export type { HandTrackingConfig, CalibrationResult, GestureEvent } from './types';
export { DEFAULT_HAND_TRACKING_CONFIG, LANDMARK } from './types';
export type { CalibrationState, CalibrationPhase } from './calibration/calibrationEngine';
export type { CameraError, CameraErrorCode } from './cameraManager';
export type { DetectedHand, HandSelectionState } from './handSelectionManager';
export type { GestureEventListener } from './gestures/gestureDetector';
