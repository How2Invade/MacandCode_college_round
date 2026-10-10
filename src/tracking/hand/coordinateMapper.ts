/**
 * Coordinate Mapper
 *
 * Converts raw MediaPipe landmark coordinates into the shared
 * PointerPosition contract used by the rest of the Handsfree system.
 *
 * Responsibilities:
 * - Mirror the X-axis so rightward movement maps to rightward cursor movement.
 * - Remap coordinates from the user's calibrated bounds into a 0–1 normalised range.
 * - Clamp the output so it never escapes 0–1.
 * - Apply a configurable sensitivity multiplier (relative to centre).
 */

import { PointerPosition } from '../../shared/types/tracking';
import { CalibrationBounds, HandTrackingConfig } from './types';

const DEFAULT_BOUNDS: CalibrationBounds = {
  minX: 0,
  maxX: 1,
  minY: 0,
  maxY: 1,
};

export class CoordinateMapper {
  constructor(
    private config: HandTrackingConfig,
    private bounds: CalibrationBounds = DEFAULT_BOUNDS
  ) {}

  updateBounds(bounds: CalibrationBounds): void {
    this.bounds = bounds;
  }

  updateConfig(config: HandTrackingConfig): void {
    this.config = config;
  }

  /**
   * Map a raw MediaPipe x,y pair (0–1) to a normalised PointerPosition.
   */
  map(rawX: number, rawY: number, confidence: number, timestamp: number): PointerPosition {
    // 1. Mirror X if requested (selfie-view convention)
    const x = this.config.mirrorX ? 1 - rawX : rawX;
    const y = rawY;

    // 2. Remap from calibrated bounds → 0–1
    const rangeX = this.bounds.maxX - this.bounds.minX;
    const rangeY = this.bounds.maxY - this.bounds.minY;

    const normX = rangeX > 0 ? (x - this.bounds.minX) / rangeX : 0.5;
    const normY = rangeY > 0 ? (y - this.bounds.minY) / rangeY : 0.5;

    // 3. Apply sensitivity (relative to centre: scale around 0.5)
    const s = this.config.sensitivity;
    const sX = 0.5 + (normX - 0.5) * s;
    const sY = 0.5 + (normY - 0.5) * s;

    // 4. Clamp to [0, 1]
    return {
      x: clamp(sX, 0, 1),
      y: clamp(sY, 0, 1),
      confidence: clamp(confidence, 0, 1),
      timestamp,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
