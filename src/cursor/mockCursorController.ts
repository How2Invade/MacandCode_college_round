/**
 * MOCK IMPLEMENTATION: MockCursorController
 *
 * NOTE: Placeholder for simulated handsfree cursor overlay in content script.
 * Uses shared PointerPosition contract.
 */

import { PointerPosition } from '../shared/types/tracking';
import { logger } from '../shared/utils';

export interface ICursorController {
  moveTo(pos: PointerPosition): void;
  triggerClickVisual(type?: 'left' | 'right'): void;
  showDwellProgress(progressPercent: number): void;
  hide(): void;
  show(): void;
}

export class MockCursorController implements ICursorController {
  public readonly isMock = true;
  private isVisible = false;
  private currentPos: PointerPosition = { x: 0.5, y: 0.5, confidence: 1.0, timestamp: Date.now() };

  public moveTo(pos: PointerPosition): void {
    this.currentPos = { ...pos };
    logger.debug('MockCursorController', `Moved cursor to (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)})`);
  }

  public triggerClickVisual(type: 'left' | 'right' = 'left'): void {
    logger.info('MockCursorController', `Trigger visual click animation: ${type}`);
  }

  public showDwellProgress(progressPercent: number): void {
    logger.debug('MockCursorController', `Dwell progress: ${progressPercent}%`);
  }

  public hide(): void {
    this.isVisible = false;
    logger.info('MockCursorController', 'Cursor overlay hidden');
  }

  public show(): void {
    this.isVisible = true;
    logger.info('MockCursorController', 'Cursor overlay visible');
  }

  public getPosition(): PointerPosition {
    return { ...this.currentPos };
  }

  public getVisibility(): boolean {
    return this.isVisible;
  }
}
