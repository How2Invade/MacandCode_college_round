/**
 * Gesture Detector
 *
 * Detects pinch-to-click, pinch-release, pinch-hold (drag), and scroll gestures
 * from MediaPipe hand landmarks.
 *
 * Design principles:
 * - Gesture transitions are detected, not held states.
 * - Debouncing prevents single-frame spurious recognition.
 * - A cooldown timer prevents repeated click events while the pinch is held.
 * - No DOM access or browser actions are triggered here — only events are emitted.
 */

import { NormalizedLandmark, LANDMARK, GestureEvent, HandTrackingConfig } from '../types';

export type GestureEventListener = (event: GestureEvent) => void;

type GestureState = 'none' | 'pinching' | 'holding';
type Candidate = 'pinch' | 'air_click' | 'none' | 'scroll' | 'zoom_in' | 'zoom_out' | 'tab_next' | 'tab_previous' | 'scroll_up' | 'scroll_down' | 'undo' | 'redo' | 'thumbs_up' | 'thumbs_down' | 'shaka' | 'palm_open' | 'fist' | 'screenshot';

export class GestureDetector {
  private state: GestureState = 'none';
  /** Number of consecutive frames the current candidate gesture has been seen */
  private candidateFrames = 0;
  /** The gesture candidate we are accumulating debounce frames for */
  private candidate: Candidate = 'none';
  /** Timestamp of the last emitted gesture event (for cooldown) */
  private lastEventMs = -Infinity;
  /** Whether we have emitted the pinch_hold event for the current hold */
  private holdEmitted = false;
  private discreteEmitted = false;
  private swipeOrigin: { x: number; y: number } | null = null;
  /** Origin for the four-finger undo/redo swipe */
  private fourFingerSwipeOrigin: { x: number; y: number } | null = null;
  /** Origin for the three-finger scroll swipe */
  private threeFingerSwipeOrigin: { x: number; y: number } | null = null;

  private readonly listeners: GestureEventListener[] = [];

  constructor(private config: HandTrackingConfig) {}

  updateConfig(config: HandTrackingConfig): void {
    this.config = config;
  }

  onGestureEvent(listener: GestureEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Process one frame of landmarks.
   * Must be called once per frame even if no hand is detected (pass null).
   */
  process(landmarks: NormalizedLandmark[] | null, timestamp: number, allHands?: NormalizedLandmark[][]): void {
    if (!landmarks && (!allHands || allHands.length === 0)) {
      this.handleLandmarksLost(timestamp);
      return;
    }

    // 1. Two-hand camera frame easter egg check takes highest precedence
    const isCameraFrame = Boolean(allHands && allHands.length >= 2 && this.isCameraFrameGesture(allHands));
    if (isCameraFrame) {
      this.handleCommandCandidate('screenshot', timestamp);
      return;
    }

    if (!landmarks) {
      this.handleLandmarksLost(timestamp);
      return;
    }

    const pinchDist = this.pinchDistance(landmarks);
    const isPinching = pinchDist < this.config.pinchThreshold;
    const isScroll = this.config.enableScrollGesture && this.isScrollGesture(landmarks);
    const isAirClick = this.isAirClickGesture(landmarks);
    const command = this.browserCommand(landmarks);

    // The click is a deliberately distinct index + pinky pose. It takes
    // precedence over commands, and the old pinch path is retained only as a
    // non-action event for backwards-compatible tracking consumers.
    if (isAirClick) {
      this.handleAirClickCandidate(timestamp);
    } else if (isPinching) {
      this.handlePinchCandidate(timestamp, pinchDist);
    } else if (command) {
      this.handleCommandCandidate(command, timestamp);
    } else if (isScroll) {
      this.handleScrollCandidate(timestamp, pinchDist);
    } else {
      this.handleNoneCandidate(timestamp);
    }
  }

  reset(): void {
    this.state = 'none';
    this.candidateFrames = 0;
    this.candidate = 'none';
    this.lastEventMs = -Infinity;
    this.holdEmitted = false;
    this.discreteEmitted = false;
    this.swipeOrigin = null;
    this.fourFingerSwipeOrigin = null;
    this.threeFingerSwipeOrigin = null;
  }

  // ─── Private Gesture Logic ──────────────────────────────────────────────────

  private pinchDistance(landmarks: NormalizedLandmark[]): number {
    const thumbTip = landmarks[LANDMARK.THUMB_TIP];
    const indexTip = landmarks[LANDMARK.INDEX_TIP];
    // Normalise by palm width so distance is size-invariant
    const palmWidth = this.estimatePalmWidth(landmarks);
    if (palmWidth <= 0) return 1;
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    return Math.sqrt(dx * dx + dy * dy) / palmWidth;
  }

  /**
   * Scroll gesture: index finger points up (extended), ring, middle and pinky
   * fingers are curled. This creates a natural "trigger curl" for scrolling.
   */
  private isScrollGesture(landmarks: NormalizedLandmark[]): boolean {
    const indexExtended = this.isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP);
    const middleCurled = !this.isFingerExtended(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP);
    const ringCurled = !this.isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP);
    const pinkyCurled = !this.isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP);
    return indexExtended && middleCurled && ringCurled && pinkyCurled;
  }

  /** Index and pinky extended, with the middle and ring fingers folded. */
  private isAirClickGesture(landmarks: NormalizedLandmark[]): boolean {
    return this.isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP)
      && this.isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP)
      && !this.isFingerExtended(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP)
      && !this.isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP);
  }

  /**
   * Intentional browser commands, kept distinct from the pointing hand used
   * for cursor control. A thumb-up/down is a one-shot zoom command. Holding index + middle fingers out and swiping horizontally changes tabs.
   */
  private browserCommand(landmarks: NormalizedLandmark[]):
    'zoom_in' | 'zoom_out' | 'tab_next' | 'tab_previous' | 'scroll_up' | 'scroll_down' | 'undo' | 'redo' | 'thumbs_up' | 'thumbs_down' | 'shaka' | 'palm_open' | 'fist' | null {
    const palmWidth = this.estimatePalmWidth(landmarks);
    const wrist = landmarks[LANDMARK.WRIST];
    const thumb = landmarks[LANDMARK.THUMB_TIP];

    
    const isThumbExt = this.isFingerExtended(landmarks, LANDMARK.THUMB_TIP, LANDMARK.THUMB_MCP) ||
      this.dist2D(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.INDEX_MCP]) > palmWidth * 0.75;
    const isIndexExt = this.isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP);
    const isMiddleExt = this.isFingerExtended(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP);
    const isRingExt = this.isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP);
    const isPinkyExt = this.isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP);

    const fingersCurled = !isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt;

    if (fingersCurled) {
      if (!isThumbExt) return 'fist';
      if (thumb.y < wrist.y - palmWidth * 0.7) return 'thumbs_up';
      if (thumb.y > wrist.y + palmWidth * 0.7) return 'thumbs_down';
    }

    if (isThumbExt && !isIndexExt && !isMiddleExt && !isRingExt && isPinkyExt) {
      return 'shaka';
    }

    if (isThumbExt && isIndexExt && isMiddleExt && isRingExt && isPinkyExt) {
      return 'palm_open';
    }


    // ── Four‑finger swipe: Undo (left) / Redo (right) ────────────────────────
    //    Index + Middle + Ring + Pinky extended, thumb NOT extended.
    const fourFingerPose =
      this.isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP) &&
      this.isFingerExtended(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP) &&
      this.isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP) &&
      this.isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP) &&
      !this.isFingerExtended(landmarks, LANDMARK.THUMB_TIP, LANDMARK.THUMB_MCP);

    if (fourFingerPose) {
      // Use the midpoint of index+pinky as the anchor point
      const handCenter = {
        x: (landmarks[LANDMARK.INDEX_TIP].x + landmarks[LANDMARK.PINKY_TIP].x) / 2,
        y: (landmarks[LANDMARK.INDEX_TIP].y + landmarks[LANDMARK.PINKY_TIP].y) / 2,
      };
      if (this.fourFingerSwipeOrigin === null) {
        this.fourFingerSwipeOrigin = handCenter;
        this.threeFingerSwipeOrigin = null;
        this.swipeOrigin = null;
        return null;
      }
      const dx = handCenter.x - this.fourFingerSwipeOrigin.x;
      const dy = handCenter.y - this.fourFingerSwipeOrigin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.13) return null;
      // Must be a predominantly horizontal swipe
      if (Math.abs(dx) >= Math.abs(dy)) {
        return dx < 0 ? 'undo' : 'redo';
      }
      return null;
    }
    this.fourFingerSwipeOrigin = null;

    // ── Three‑finger swipe: Scroll Up (up) / Scroll Down (down) ──────────────
    //    Index + Middle + Ring extended, Pinky NOT extended.
    const threeFingerPose =
      this.isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP) &&
      this.isFingerExtended(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP) &&
      this.isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP) &&
      !this.isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP);

    if (threeFingerPose) {
      const handCenter = {
        x: (landmarks[LANDMARK.INDEX_TIP].x + landmarks[LANDMARK.RING_TIP].x) / 2,
        y: (landmarks[LANDMARK.INDEX_TIP].y + landmarks[LANDMARK.RING_TIP].y) / 2,
      };
      if (this.threeFingerSwipeOrigin === null) {
        this.threeFingerSwipeOrigin = handCenter;
        this.swipeOrigin = null;
        return null;
      }
      const dx = handCenter.x - this.threeFingerSwipeOrigin.x;
      const dy = handCenter.y - this.threeFingerSwipeOrigin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.07) return null;
      // Must be a predominantly vertical swipe
      if (Math.abs(dy) >= Math.abs(dx)) {
        return dy < 0 ? 'scroll_up' : 'scroll_down';
      }
      return null;
    }
    this.threeFingerSwipeOrigin = null;

    // ── Two‑finger swipe: Tab change (horizontal) / Scroll (vertical) ─────────
    const twoFingerPose =
      this.isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP) &&
      this.isFingerExtended(landmarks, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP) &&
      !this.isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP) &&
      !this.isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP);
    if (!twoFingerPose) {
      this.swipeOrigin = null;
      return null;
    }

    const center = {
      x: (landmarks[LANDMARK.INDEX_TIP].x + landmarks[LANDMARK.MIDDLE_TIP].x) / 2,
      y: (landmarks[LANDMARK.INDEX_TIP].y + landmarks[LANDMARK.MIDDLE_TIP].y) / 2,
    };
    if (this.swipeOrigin === null) {
      this.swipeOrigin = center;
      return null;
    }
    const movementX = center.x - this.swipeOrigin.x;
    const movementY = center.y - this.swipeOrigin.y;
    
    // Predominantly horizontal swipe: tab switch
    if (Math.abs(movementX) > Math.abs(movementY)) {
      if (Math.abs(movementX) < 0.12) return null;
      return movementX > 0 ? 'tab_next' : 'tab_previous';
    }
    
    // Predominantly vertical swipe: scroll up / scroll down
    if (Math.abs(movementY) < 0.07) return null;
    return movementY > 0 ? 'scroll_down' : 'scroll_up';
  }

  /**
   * A finger is "extended" when its tip is further from the wrist than its MCP joint.
   * This works consistently regardless of hand orientation.
   */
  private isFingerExtended(
    landmarks: NormalizedLandmark[],
    tipIdx: number,
    mcpIdx: number
  ): boolean {
    const wrist = landmarks[LANDMARK.WRIST];
    const tip = landmarks[tipIdx];
    const mcp = landmarks[mcpIdx];
    const distTipWrist = this.dist2D(tip, wrist);
    const distMcpWrist = this.dist2D(mcp, wrist);
    return distTipWrist > distMcpWrist * 1.15; // 15% tolerance
  }

  private estimatePalmWidth(landmarks: NormalizedLandmark[]): number {
    const indexMcp = landmarks[LANDMARK.INDEX_MCP];
    const pinkyMcp = landmarks[LANDMARK.PINKY_MCP];
    return this.dist2D(indexMcp, pinkyMcp) || 0.15; // fallback to 15% of frame
  }

  private dist2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ─── State Machine ──────────────────────────────────────────────────────────

  private handlePinchCandidate(timestamp: number, metric: number): void {
    if (this.candidate !== 'pinch') {
      this.candidate = 'pinch';
      this.candidateFrames = 0;
    }
    this.candidateFrames++;

    if (this.candidateFrames >= this.config.gestureDebounceFrames) {
      if (this.state === 'none') {
        // Transition: none → pinching
        const cooldownOk = timestamp - this.lastEventMs >= this.config.gestureCooldownMs;
        if (cooldownOk) {
          this.state = 'pinching';
          this.holdEmitted = false;
          this.emit({ type: 'pinch_start', gesture: 'pinch', confidence: 1, timestamp, metric });
          this.lastEventMs = timestamp;
        }
      } else if (this.state === 'pinching') {
        // Long hold — emit hold event once
        if (this.config.enableDrag && !this.holdEmitted) {
          const holdMs = timestamp - this.lastEventMs;
          if (holdMs > 500) {
            this.state = 'holding';
            this.holdEmitted = true;
            this.emit({ type: 'pinch_hold', gesture: 'pinch', confidence: 1, timestamp, metric });
          }
        }
      }
    }
  }

  private handleAirClickCandidate(timestamp: number): void {
    if (this.candidate !== 'air_click') {
      this.candidate = 'air_click';
      this.candidateFrames = 0;
      this.discreteEmitted = false;
    }
    this.candidateFrames++;
    if (
      this.candidateFrames >= this.config.gestureDebounceFrames
      && !this.discreteEmitted
      && timestamp - this.lastEventMs >= this.config.gestureCooldownMs
    ) {
      this.emit({ type: 'air_click', gesture: 'air_click', confidence: 0.98, timestamp, metric: 1 });
      this.lastEventMs = timestamp;
      this.discreteEmitted = true;
    }
  }

  private handleScrollCandidate(timestamp: number, metric: number): void {
    if (this.candidate !== 'scroll') {
      this.candidate = 'scroll';
      this.candidateFrames = 0;
    }
    this.candidateFrames++;

    if (this.candidateFrames >= this.config.gestureDebounceFrames) {
      if (this.state === 'none') {
        const cooldownOk = timestamp - this.lastEventMs >= this.config.gestureCooldownMs;
        if (cooldownOk) {
          this.emit({ type: 'scroll_start', gesture: 'point', confidence: 0.9, timestamp, metric });
          this.lastEventMs = timestamp;
        }
      }
    }
  }

  private handleNoneCandidate(timestamp: number): void {
    if (this.candidate !== 'none') {
      this.candidate = 'none';
      this.candidateFrames = 0;
      this.discreteEmitted = false;
    }
    this.candidateFrames++;

    if (this.candidateFrames >= this.config.gestureDebounceFrames) {
      if (this.state === 'pinching' || this.state === 'holding') {
        // Transition: pinching/holding → none
        this.emit({ type: 'pinch_end', gesture: 'none', confidence: 1, timestamp, metric: 1 });
        this.lastEventMs = timestamp;
        this.state = 'none';
        this.holdEmitted = false;
      }
    }
  }

  /**
   * Two-hand "Camera Frame" Easter Egg gesture:
   * Both hands form an "L" framing pose (index and thumb extended, other 3 fingers curled).
   * Forms a framing rectangle (like a camera viewfinder).
   */
  public isCameraFrameGesture(hands: NormalizedLandmark[][]): boolean {
    if (hands.length < 2) return false;
    const [h1, h2] = hands;

    const isFramingHand = (h: NormalizedLandmark[]) => {
      const palmWidth = this.estimatePalmWidth(h);
      const indexExt = this.isFingerExtended(h, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP);
      const thumbExt = this.isFingerExtended(h, LANDMARK.THUMB_TIP, LANDMARK.THUMB_MCP) ||
        this.dist2D(h[LANDMARK.THUMB_TIP], h[LANDMARK.INDEX_MCP]) > palmWidth * 0.60;
      const midCurled = !this.isFingerExtended(h, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_MCP);
      const ringCurled = !this.isFingerExtended(h, LANDMARK.RING_TIP, LANDMARK.RING_MCP);
      const pinkyCurled = !this.isFingerExtended(h, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP);
      const curledCount = (midCurled ? 1 : 0) + (ringCurled ? 1 : 0) + (pinkyCurled ? 1 : 0);
      return indexExt && thumbExt && curledCount >= 2;
    };

    if (!isFramingHand(h1) || !isFramingHand(h2)) return false;

    // Both hands must be spaced apart in camera view to form a frame
    const wristDist = this.dist2D(h1[LANDMARK.WRIST], h2[LANDMARK.WRIST]);
    return wristDist > 0.08;
  }

  private handleCommandCandidate(
    command: 'zoom_in' | 'zoom_out' | 'tab_next' | 'tab_previous' | 'scroll_up' | 'scroll_down' | 'undo' | 'redo' | 'thumbs_up' | 'thumbs_down' | 'shaka' | 'palm_open' | 'fist' | 'screenshot',
    timestamp: number
  ): void {
    if (this.candidate !== command) {
      this.candidate = command;
      this.candidateFrames = 0;
      this.discreteEmitted = false;
    }
    this.candidateFrames++;

    const isScrollCommand = command === 'scroll_up' || command === 'scroll_down';
    const isScreenshot = command === 'screenshot';
    const cooldownMs = isScreenshot ? 2500 : isScrollCommand ? 180 : this.config.gestureCooldownMs;
    const canEmit = isScrollCommand
      ? (timestamp - this.lastEventMs >= cooldownMs)
      : (!this.discreteEmitted && timestamp - this.lastEventMs >= cooldownMs);

    if (
      this.candidateFrames >= this.config.gestureDebounceFrames &&
      canEmit
    ) {
      const gesture = command as GestureEvent['gesture'];
      this.emit({ type: command, gesture, confidence: 0.98, timestamp, metric: 1 });
      this.lastEventMs = timestamp;
      this.discreteEmitted = true;
      if (isScrollCommand) {
        this.swipeOrigin = null;
        this.threeFingerSwipeOrigin = null;
      } else if (command === 'tab_next' || command === 'tab_previous') {
        this.swipeOrigin = null;
      }
    }
  }

  private handleLandmarksLost(timestamp: number): void {
    if (this.state !== 'none') {
      this.emit({ type: 'pinch_end', gesture: 'none', confidence: 0, timestamp, metric: 1 });
      this.state = 'none';
    }
    this.candidate = 'none';
    this.candidateFrames = 0;
    this.holdEmitted = false;
    this.discreteEmitted = false;
    this.swipeOrigin = null;
  }

  private emit(event: GestureEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
