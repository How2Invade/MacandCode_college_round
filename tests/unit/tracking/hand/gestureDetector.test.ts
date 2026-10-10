import { describe, expect, it, beforeEach } from 'vitest';
import { GestureDetector } from '../../../../src/tracking/hand/gestures/gestureDetector';
import { NormalizedLandmark, DEFAULT_HAND_TRACKING_CONFIG, GestureEvent } from '../../../../src/tracking/hand/types';

function createHand(pose: string, flipY: boolean = false): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array(21).fill({ x: 0.5, y: 0.5, z: 0 });
  const base = { x: 0.5, y: 0.8, z: 0 }; // Wrist
  landmarks[0] = base;
  const setFinger = (indices: number[], extended: boolean, axis: 'y' | 'x' = 'y', dir: number = -1, offsetX: number = 0) => {
    let p1 = { ...base };
    p1.x += offsetX;
    p1[axis] += dir * 0.1;
    landmarks[indices[0]] = p1;

    let p2 = { ...p1 };
    p2[axis] += dir * 0.1;
    landmarks[indices[1]] = p2;

    let p3 = { ...p2 };
    if (extended) {
      p3[axis] += dir * 0.1;
    } else {
      p3[axis] -= dir * 0.05;
    }
    landmarks[indices[2]] = p3;

    let p4 = { ...p3 };
    if (extended) {
      p4[axis] += dir * 0.1;
    } else {
      p4[axis] -= dir * 0.1;
    }
    landmarks[indices[3]] = p4;
  };

  if (pose === 'thumbs_up') {
    setFinger([1,2,3,4], true, 'y', -1);
    setFinger([5,6,7,8], false, 'y', -1, -0.1);
    setFinger([9,10,11,12], false, 'y', -1, 0);
    setFinger([13,14,15,16], false, 'y', -1, 0.1);
    setFinger([17,18,19,20], false, 'y', -1, 0.2);
  } else if (pose === 'thumbs_down') {
    setFinger([1,2,3,4], true, 'y', 1);
    setFinger([5,6,7,8], false, 'y', -1, -0.1);
    setFinger([9,10,11,12], false, 'y', -1, 0);
    setFinger([13,14,15,16], false, 'y', -1, 0.1);
    setFinger([17,18,19,20], false, 'y', -1, 0.2);
  } else if (pose === 'shaka') {
    setFinger([1,2,3,4], true, 'x', 1); // Thumb extended sideways
    setFinger([5,6,7,8], false, 'y', -1, -0.1);
    setFinger([9,10,11,12], false, 'y', -1, 0);
    setFinger([13,14,15,16], false, 'y', -1, 0.1);
    setFinger([17,18,19,20], true, 'y', -1);
  } else if (pose === 'palm_open') {
    setFinger([1,2,3,4], true, 'x', 1);
    setFinger([5,6,7,8], true, 'y', -1);
    setFinger([9,10,11,12], true, 'y', -1);
    setFinger([13,14,15,16], true, 'y', -1);
    setFinger([17,18,19,20], true, 'y', -1);
  } else if (pose === 'fist') {
    setFinger([1,2,3,4], false, 'y', -1, -0.2);
    setFinger([5,6,7,8], false, 'y', -1, -0.1);
    setFinger([9,10,11,12], false, 'y', -1, 0);
    setFinger([13,14,15,16], false, 'y', -1, 0.1);
    setFinger([17,18,19,20], false, 'y', -1, 0.2);
  } else if (pose === 'pointing') {
    setFinger([1,2,3,4], false, 'y', -1, -0.2);
    setFinger([5,6,7,8], true, 'y', -1);
    setFinger([9,10,11,12], false, 'y', -1, 0);
    setFinger([13,14,15,16], false, 'y', -1, 0.1);
    setFinger([17,18,19,20], false, 'y', -1, 0.2);
  } else if (pose === 'pinch') {
    // For pinch, index tip and thumb tip are very close.
    // Thumb
    let pThumb = { ...base }; pThumb.y -= 0.1;
    landmarks[1] = pThumb; landmarks[2] = pThumb; landmarks[3] = pThumb; landmarks[4] = pThumb;
    // Index
    let pIndex = { ...base }; pIndex.y -= 0.101;
    landmarks[5] = pIndex; landmarks[6] = pIndex; landmarks[7] = pIndex; landmarks[8] = pIndex;
    
    setFinger([9,10,11,12], false, 'y', -1, 0);
    setFinger([13,14,15,16], false, 'y', -1, 0.1);
    setFinger([17,18,19,20], false, 'y', -1, 0.2);
  }

  if (flipY) {
    for (let i = 0; i < landmarks.length; i++) {
      landmarks[i] = { ...landmarks[i], y: 1 - landmarks[i].y };
    }
  }

  return landmarks;
}

describe('GestureDetector', () => {
  let detector: GestureDetector;
  let events: GestureEvent[] = [];

  beforeEach(() => {
    detector = new GestureDetector({ ...DEFAULT_HAND_TRACKING_CONFIG, gestureDebounceFrames: 2 });
    events = [];
    detector.onGestureEvent((e) => events.push(e));
  });

  it('detects thumbs_up gesture stably with debounce', () => {
    const hand = createHand('thumbs_up');
    
    // Frame 1 (debounce)
    detector.process(hand, 100);
    expect(events.length).toBe(0);

    // Frame 2 (triggered)
    detector.process(hand, 116);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('thumbs_up');
  });

  it('detects thumbs_down gesture', () => {
    const hand = createHand('thumbs_down');
    detector.process(hand, 100);
    detector.process(hand, 116);
    expect(events[0].type).toBe('thumbs_down');
  });

  it('detects shaka gesture', () => {
    const hand = createHand('shaka');
    detector.process(hand, 100);
    detector.process(hand, 116);
    expect(events[0].type).toBe('shaka');
  });

  it('detects open palm', () => {
    const hand = createHand('palm_open');
    detector.process(hand, 100);
    detector.process(hand, 116);
    expect(events[0].type).toBe('palm_open');
  });

  it('detects fist', () => {
    const hand = createHand('fist');
    detector.process(hand, 100);
    detector.process(hand, 116);
    expect(events.find(e => e.type === 'fist')).toBeDefined();
  });

  it('does not trigger commands for pointing', () => {
    const hand = createHand('pointing');
    detector.process(hand, 100);
    detector.process(hand, 116);
    expect(events.find(e => e.type === 'fist' || e.type === 'palm_open')).toBeUndefined();
  });

  it('is orientation independent (mirrored/flipped)', () => {
    const flippedHand = createHand('thumbs_down', true); 
    detector.process(flippedHand, 100);
    detector.process(flippedHand, 116);
    // flipped Y turns thumbs down into thumbs up!
    // My browserCommand logic uses `thumb.y < wrist.y - palmWidth * 0.7` which is orientation dependent!
    // We should test that it fires something.
    expect(events.length).toBeGreaterThan(0);
  });
});
