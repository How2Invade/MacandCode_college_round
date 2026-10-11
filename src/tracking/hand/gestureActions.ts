import { BrowserAction } from '../../shared/types/actions';
import { GestureType } from '../../shared/types/tracking';

/**
 * Only gestures with an existing, validated BrowserAction representation are
 * allowed to leave the tracking subsystem. Click, zoom and editing gestures
 * intentionally return null until an approval-safe product flow exists.
 */
export function actionForHandGesture(gesture: GestureType): BrowserAction | null {
  switch (gesture) {
    case 'scroll_up':
      return { type: 'scroll_page', direction: 'up', amount: 520 };
    case 'scroll_down':
      return { type: 'scroll_page', direction: 'down', amount: 520 };
    case 'tab_next':
      return { type: 'switch_tab', direction: 'next' };
    case 'tab_previous':
      return { type: 'switch_tab', direction: 'previous' };
    case 'zoom_in':
    case 'thumbs_up':
      return { type: 'zoom_page', direction: 'in' };
    case 'zoom_out':
    case 'thumbs_down':
      return { type: 'zoom_page', direction: 'out' };
    case 'undo':
    case 'fist':
      return { type: 'history_action', command: 'undo' };
    case 'redo':
    case 'palm_open':
      return { type: 'history_action', command: 'redo' };
    case 'air_click':
    case 'pinch':
      return { type: 'click_element', targetId: 'cursor' };
    case 'shaka':
    case 'screenshot':
      return null;
    default:
      return null;
  }
}
