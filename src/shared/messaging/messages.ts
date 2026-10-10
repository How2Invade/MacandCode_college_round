/**
 * Chrome Extension Cross-Context Messaging Definitions
 * Agreed message/event formats between the sidebar, service worker, and webpage.
 */

import { TrackingMode, TrackingStatus, PointerPosition } from '../types/tracking';
import { BrowserAction, ActionResult, ApprovalMode, AssistantState } from '../types/actions';
import { SupportedLanguage, ConversationMessage } from '../types/assistant';
import { TaskRecord } from '../types/memory';
import { UserSettings } from '../types/settings';

export type MessageSource = 'sidepanel' | 'background' | 'content' | 'popup';

export type MessageType =
  // Tracking controls
  | 'TRACKING_START'
  | 'TRACKING_STOP'
  | 'TRACKING_PAUSE'
  | 'TRACKING_SET_MODE'
  | 'TRACKING_STATUS_CHANGED'
  | 'POINTER_POSITION_UPDATE'

  // Assistant & Languages
  | 'SET_LANGUAGE'
  | 'SET_APPROVAL_MODE'
  | 'ASSISTANT_STATE_CHANGED'
  | 'SEND_USER_MESSAGE'
  | 'NEW_CONVERSATION_MESSAGE'

  // Action execution & human approval
  | 'EXECUTE_BROWSER_ACTION'
  | 'ACTION_APPROVAL_REQUESTED'
  | 'APPROVE_ACTION'
  | 'REJECT_ACTION'
  | 'ACTION_EXECUTION_COMPLETED'

  // Tasks & Settings
  | 'GET_INITIAL_STATE'
  | 'TASK_LIST_UPDATED'
  | 'SETTINGS_UPDATED';

export interface BaseMessage<T extends MessageType, P = unknown> {
  type: T;
  source: MessageSource;
  payload: P;
  timestamp: number;
  correlationId?: string;
}

// Payload definitions
export interface TrackingStartPayload {
  mode: TrackingMode;
}

export interface TrackingSetModePayload {
  mode: TrackingMode;
}

export interface SetLanguagePayload {
  language: SupportedLanguage;
}

export interface SetApprovalModePayload {
  mode: ApprovalMode;
}

export interface SendUserMessagePayload {
  content: string;
  language: SupportedLanguage;
}

export interface ApproveActionPayload {
  action: BrowserAction;
}

export interface RejectActionPayload {
  action: BrowserAction;
  reason?: string;
}

export interface ExecuteBrowserActionPayload {
  action: BrowserAction;
  /** Optional explicit webpage tab to act on. Validated by the background before use. */
  tabId?: number;
}

export interface ActionCompletedPayload {
  action: BrowserAction;
  result: ActionResult;
}

export interface InitialStateResponsePayload {
  tracking: TrackingStatus;
  assistantState: AssistantState;
  settings: UserSettings;
  recentTasks: TaskRecord[];
  messages: ConversationMessage[];
}

export type HandsfreeMessage =
  | BaseMessage<'TRACKING_START', TrackingStartPayload>
  | BaseMessage<'TRACKING_STOP', Record<string, never>>
  | BaseMessage<'TRACKING_PAUSE', Record<string, never>>
  | BaseMessage<'TRACKING_SET_MODE', TrackingSetModePayload>
  | BaseMessage<'TRACKING_STATUS_CHANGED', TrackingStatus>
  | BaseMessage<'POINTER_POSITION_UPDATE', PointerPosition>
  | BaseMessage<'SET_LANGUAGE', SetLanguagePayload>
  | BaseMessage<'SET_APPROVAL_MODE', SetApprovalModePayload>
  | BaseMessage<'ASSISTANT_STATE_CHANGED', { state: AssistantState }>
  | BaseMessage<'SEND_USER_MESSAGE', SendUserMessagePayload>
  | BaseMessage<'NEW_CONVERSATION_MESSAGE', ConversationMessage>
  | BaseMessage<'EXECUTE_BROWSER_ACTION', ExecuteBrowserActionPayload>
  | BaseMessage<'ACTION_APPROVAL_REQUESTED', { action: BrowserAction; reason: string }>
  | BaseMessage<'APPROVE_ACTION', ApproveActionPayload>
  | BaseMessage<'REJECT_ACTION', RejectActionPayload>
  | BaseMessage<'ACTION_EXECUTION_COMPLETED', ActionCompletedPayload>
  | BaseMessage<'GET_INITIAL_STATE', Record<string, never>>
  | BaseMessage<'TASK_LIST_UPDATED', TaskRecord[]>
  | BaseMessage<'SETTINGS_UPDATED', Partial<UserSettings>>;

export function createMessage<T extends MessageType, P>(
  type: T,
  source: MessageSource,
  payload: P,
  correlationId?: string
): BaseMessage<T, P> {
  return {
    type,
    source,
    payload,
    timestamp: Date.now(),
    correlationId: correlationId || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  };
}
