
/**
 * Browser Actions and Execution Interfaces
 * Shared contract for Handsfree browser automation and action execution.
 */

export type BrowserAction =
  | { type: "open_url"; url: string }
  | { type: "click_element"; targetId: string }
  | { type: "type_text"; text: string; targetId?: string }
  | { type: "scroll_page"; direction: "up" | "down"; amount: number }
  | { type: "navigate_back" }
  | { type: "navigate_forward" }
  | { type: "switch_tab"; direction: "next" | "previous" }
  | { type: "read_page" }
  | { type: "zoom_page"; direction: "in" | "out" }
  | { type: "history_action"; command: "undo" | "redo" }
  | { type: "undo" }
  | { type: "redo" };

export type ApprovalMode = "ask" | "auto";

export type AssistantState =
  | "idle"
  | "listening"
  | "thinking"
  | "awaiting_approval"
  | "executing"
  | "success"
  | "error";

export interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface IBrowserActionExecutor {
  execute(action: BrowserAction): Promise<ActionResult>;
  canExecute(action: BrowserAction): Promise<boolean>;
}
