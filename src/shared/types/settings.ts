/**
 * Extension Settings Interfaces
 * Shared contract for user preferences and configuration.
 */

import { TrackingMode } from './tracking';
import { ApprovalMode } from './actions';
import { SupportedLanguage } from './assistant';

export interface UserSettings {
  approvalMode: ApprovalMode;
  defaultLanguage: SupportedLanguage;
  defaultTrackingMode: TrackingMode;
  pointerSensitivity: number; // 0.1 to 2.0
  dwellClickDurationMs: number; // e.g. 800ms
  smoothingFactor: number; // 0 to 1
  voiceEnabled: boolean;
  highlightActionTargets: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  approvalMode: 'ask',
  defaultLanguage: 'en',
  defaultTrackingMode: 'hand',
  pointerSensitivity: 1.0,
  dwellClickDurationMs: 800,
  smoothingFactor: 0.5,
  voiceEnabled: true,
  highlightActionTargets: true,
};
