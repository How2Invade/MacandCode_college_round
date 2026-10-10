/**
 * Hand Selection Manager
 *
 * Maintains stable selection of the "control hand" across frames.
 *
 * Problems solved:
 * - MediaPipe detection order can swap between frames when two hands are present.
 * - A second hand entering the view should not hijack the cursor.
 * - When the control hand disappears we enter "lost" state and stop cursor movement.
 * - We resume only after the chosen hand has been consistently detected
 *   for `stabilityFrames` consecutive frames.
 *
 * We identify hands by their reported handedness label ("Left"/"Right") rather
 * than by array index, which is unstable across frames.
 */

import { NormalizedLandmark, PreferredHand } from './types';

export interface DetectedHand {
  landmarks: NormalizedLandmark[];
  handedness: string; // "Left" or "Right" (MediaPipe camera-view label)
}

export type HandSelectionState = 'active' | 'lost' | 'recovering';

export class HandSelectionManager {
  /** The MediaPipe handedness label we have committed to ("Left" | "Right") */
  private lockedLabel: string | null = null;
  private state: HandSelectionState = 'lost';
  private recoveryFrames = 0;

  constructor(
    private preferredHand: PreferredHand = 'any',
    private readonly stabilityFrames = 3
  ) {}

  /**
   * Given the hands detected in the current frame, select and return the
   * control hand's landmarks (or null if no suitable hand is visible).
   */
  select(detectedHands: DetectedHand[]): NormalizedLandmark[] | null {
    if (detectedHands.length === 0) {
      this.handleNoHands();
      return null;
    }

    // Attempt to find the previously locked hand by label
    const locked = this.lockedLabel
      ? detectedHands.find((h) => h.handedness === this.lockedLabel)
      : null;

    if (locked) {
      this.state = 'active';
      this.recoveryFrames = 0;
      return locked.landmarks;
    }

    // Locked hand not visible — try to recover
    if (this.lockedLabel !== null) {
      return this.handleRecovery(detectedHands);
    }

    // No lock yet — pick the best candidate
    return this.acquireLock(detectedHands);
  }

  /** Force-select a specific hand label (called when user nominates a hand) */
  setPreferredHand(preferred: PreferredHand): void {
    this.preferredHand = preferred;
    // Clear lock so the manager re-acquires on the next frame
    this.lockedLabel = null;
    this.state = 'lost';
    this.recoveryFrames = 0;
  }

  getState(): HandSelectionState {
    return this.state;
  }

  getLockedLabel(): string | null {
    return this.lockedLabel;
  }

  reset(): void {
    this.lockedLabel = null;
    this.state = 'lost';
    this.recoveryFrames = 0;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private handleNoHands(): void {
    if (this.state === 'active') {
      this.state = 'lost';
      this.recoveryFrames = 0;
    }
  }

  private handleRecovery(detectedHands: DetectedHand[]): NormalizedLandmark[] | null {
    // The preferred hand has briefly disappeared. Check if it's back.
    const candidate = this.pickCandidate(detectedHands);
    if (!candidate) {
      this.state = 'lost';
      this.recoveryFrames = 0;
      return null;
    }

    this.recoveryFrames++;
    this.state = 'recovering';

    if (this.recoveryFrames >= this.stabilityFrames) {
      // Commit to this hand (may be same label, may be the only available hand)
      this.lockedLabel = candidate.handedness;
      this.state = 'active';
      this.recoveryFrames = 0;
      return candidate.landmarks;
    }

    return null; // suppress cursor movement during recovery
  }

  private acquireLock(detectedHands: DetectedHand[]): NormalizedLandmark[] | null {
    const candidate = this.pickCandidate(detectedHands);
    if (!candidate) return null;

    this.recoveryFrames++;
    if (this.recoveryFrames >= this.stabilityFrames) {
      this.lockedLabel = candidate.handedness;
      this.state = 'active';
      this.recoveryFrames = 0;
      return candidate.landmarks;
    }
    return null;
  }

  private pickCandidate(detectedHands: DetectedHand[]): DetectedHand | null {
    if (this.preferredHand === 'any') {
      return detectedHands[0] || null;
    }

    // Map natural language → MediaPipe label (MediaPipe labels are camera-view,
    // so "Right" from MediaPipe is the user's left hand when mirrored)
    const targetLabel =
      this.preferredHand === 'right' ? 'Left' : 'Right';

    return (
      detectedHands.find((h) => h.handedness === targetLabel) ||
      detectedHands[0] || // fall back to any hand
      null
    );
  }
}
