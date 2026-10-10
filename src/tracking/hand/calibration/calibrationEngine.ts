/**
 * Hand Calibration Engine
 *
 * Guides the user through a ~15–30 second calibration sequence:
 *  1. Detects which hand is present and asks the user to nominate it.
 *  2. Asks the user to sweep the index finger across the full comfortable
 *     working range — top-left, top-right, bottom-left, bottom-right.
 *  3. Records the extremes and stores them as normalisation bounds.
 *
 * The resulting bounds are used to re-map raw MediaPipe coordinates into
 * a normalised 0–1 space that matches the user's natural working area.
 */

import {
  CalibrationBounds,
  CalibrationResult,
  NormalizedLandmark,
  PreferredHand,
} from '../types';
import { LANDMARK } from '../types';

export type CalibrationPhase =
  | 'idle'
  | 'waiting_for_hand'
  | 'selecting_hand'
  | 'sweeping'
  | 'complete'
  | 'failed';

export interface CalibrationState {
  phase: CalibrationPhase;
  progress: number;      // 0 to 1
  instruction: string;
  elapsedMs: number;
  remainingMs: number;
}

const SWEEP_DURATION_MS = 15_000;   // 15 s to sweep the working area
const STABILITY_FRAMES = 6;

export class CalibrationEngine {
  private phase: CalibrationPhase = 'idle';
  private startMs = 0;
  private rawFrames: Array<{ x: number; y: number }> = [];
  private stabilityCount = 0;
  private preferredHand: PreferredHand = 'any';
  private dominantHandLabel = '';
  private result: CalibrationResult | null = null;

  /**
   * Begin a new calibration session.
   */
  start(): void {
    this.phase = 'waiting_for_hand';
    this.startMs = Date.now();
    this.rawFrames = [];
    this.stabilityCount = 0;
    this.dominantHandLabel = '';
    this.result = null;
  }

  /**
   * Feed one frame of detection results.
   * @param handedness  'Left' or 'Right' as reported by MediaPipe (pre-mirroring)
   * @param landmarks   landmarks of the detected hand, or null if no hand found
   */
  processFrame(
    handedness: string | null,
    landmarks: NormalizedLandmark[] | null
  ): void {
    switch (this.phase) {
      case 'waiting_for_hand':
        if (landmarks && handedness) {
          this.stabilityCount++;
          if (this.stabilityCount >= STABILITY_FRAMES) {
            this.dominantHandLabel = handedness;
            // MediaPipe labels are from the camera perspective. Flip for natural language.
            this.preferredHand = handedness === 'Left' ? 'right' : 'left';
            this.phase = 'sweeping';
            this.startMs = Date.now();
            this.rawFrames = [];
          }
        } else {
          this.stabilityCount = 0;
        }
        break;

      case 'sweeping':
        if (landmarks) {
          const tip = landmarks[LANDMARK.INDEX_TIP];
          this.rawFrames.push({ x: tip.x, y: tip.y });
        }
        if (Date.now() - this.startMs >= SWEEP_DURATION_MS) {
          this.finalize();
        }
        break;

      default:
        break;
    }
  }

  getState(): CalibrationState {
    const now = Date.now();
    const elapsedMs = now - this.startMs;
    const remainingMs = Math.max(0, SWEEP_DURATION_MS - elapsedMs);
    const progress = this.phase === 'sweeping'
      ? Math.min(1, elapsedMs / SWEEP_DURATION_MS)
      : this.phase === 'complete' ? 1 : 0;

    const instructions: Record<CalibrationPhase, string> = {
      idle: 'Calibration not started.',
      waiting_for_hand: 'Show your hand to the camera and hold it steady...',
      selecting_hand: 'Detected your hand. Selecting preferred hand...',
      sweeping: 'Move your index fingertip to all corners of your comfortable working area.',
      complete: 'Calibration complete! Your cursor range has been set.',
      failed: 'Calibration failed. Please try again in good lighting.',
    };

    return {
      phase: this.phase,
      progress,
      instruction: instructions[this.phase],
      elapsedMs,
      remainingMs: this.phase === 'sweeping' ? remainingMs : 0,
    };
  }

  isComplete(): boolean {
    return this.phase === 'complete';
  }

  getResult(): CalibrationResult | null {
    return this.result;
  }

  /**
   * Cancel or skip calibration — falls back to default full-frame bounds.
   */
  cancel(): CalibrationResult {
    this.phase = 'failed';
    return this.buildDefaultResult();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private finalize(): void {
    if (this.rawFrames.length < 10) {
      this.phase = 'failed';
      this.result = this.buildDefaultResult();
      return;
    }

    const xs = this.rawFrames.map((f) => f.x);
    const ys = this.rawFrames.map((f) => f.y);

    // Add a small margin so the cursor can reach the edges
    const margin = 0.05;
    const bounds: CalibrationBounds = {
      minX: Math.max(0, Math.min(...xs) - margin),
      maxX: Math.min(1, Math.max(...xs) + margin),
      minY: Math.max(0, Math.min(...ys) - margin),
      maxY: Math.min(1, Math.max(...ys) + margin),
    };

    this.result = {
      preferredHand: this.preferredHand,
      bounds,
      dominantHandLabel: this.dominantHandLabel,
      completedAt: Date.now(),
      durationMs: Date.now() - this.startMs,
    };
    this.phase = 'complete';
  }

  private buildDefaultResult(): CalibrationResult {
    return {
      preferredHand: 'any',
      bounds: { minX: 0.05, maxX: 0.95, minY: 0.05, maxY: 0.95 },
      dominantHandLabel: '',
      completedAt: Date.now(),
      durationMs: 0,
    };
  }
}
