import { describe, expect, it } from 'vitest';
import { actionForHandGesture } from '../../../../src/tracking/hand/gestureActions';
import { validateBrowserAction } from '../../../../src/shared/safety/action-policy';
import { defaultActionPolicy } from '../../../../src/shared/safety/action-policy';

describe('approval-safe hand gesture actions', () => {
  it('maps only existing validated scroll and tab actions', () => {
    for (const gesture of ['scroll_up', 'scroll_down', 'tab_next', 'tab_previous'] as const) {
      const action = actionForHandGesture(gesture);
      expect(action).not.toBeNull();
      expect(validateBrowserAction(action).isValid).toBe(true);
      expect(defaultActionPolicy.evaluate(action!, 'ask').riskLevel).toBe('low');
    }
  });

  it('maps zooming, clicking, and history to proper BrowserActions instead of null', () => {
    expect(actionForHandGesture('air_click')).toEqual({ type: 'click_element', targetId: 'cursor' });
    expect(actionForHandGesture('pinch')).toEqual({ type: 'click_element', targetId: 'cursor' });
    expect(actionForHandGesture('thumbs_up')).toEqual({ type: 'zoom_page', direction: 'in' });
    expect(actionForHandGesture('zoom_in')).toEqual({ type: 'zoom_page', direction: 'in' });
    expect(actionForHandGesture('thumbs_down')).toEqual({ type: 'zoom_page', direction: 'out' });
    expect(actionForHandGesture('zoom_out')).toEqual({ type: 'zoom_page', direction: 'out' });
    expect(actionForHandGesture('fist')).toEqual({ type: 'history_action', command: 'undo' });
    expect(actionForHandGesture('undo')).toEqual({ type: 'history_action', command: 'undo' });
    expect(actionForHandGesture('palm_open')).toEqual({ type: 'history_action', command: 'redo' });
    expect(actionForHandGesture('redo')).toEqual({ type: 'history_action', command: 'redo' });
  });
});
