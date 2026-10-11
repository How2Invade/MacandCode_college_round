/**
 * GestureStateMachine
 *
 * The single authoritative controller that decides which gesture action is
 * active at any moment. It accepts raw face measurements (jawOpen score,
 * relativeYaw, confidence) and a controllable clock, and emits a
 * GestureOutput on every call to update().
 *
 * Priority order (highest wins):
 *  1. PAUSED / STOPPED — no actions.
 *  2. DOUBLE_BLINK state machine.
 *  3. TAB_NAV state machine.
 *  4. Normal cursor movement.
 *
 * No DOM, Chrome API, or rAF dependencies — purely synchronous logic driven
 * by the caller's detection loop. This makes it fully testable with synthetic
 * inputs and a fake clock.
 */

// ─── Double-Blink states ───────────────────────────────────────────────────

export type BlinkState =
  | 'IDLE'
  | 'BLINK_1_PENDING'   // blink crossed candidate threshold; cursor frozen
  | 'WAITING_FOR_BLINK_2' // blink 1 ended, waiting for blink 2
  | 'BLINK_2_PENDING'   // blink 2 started, confirming
  | 'CLICKED'           // double blink confirmed, click dispatched
  | 'CLOSE_REQUIRED'    // waiting for eyes to open after click
  | 'COOLDOWN';         // post-click lockout

// ─── Tab-navigation states ─────────────────────────────────────────────────

export type TabNavState =
  | 'NEUTRAL'
  | 'TURN_LEFT_PENDING'
  | 'TURN_RIGHT_PENDING'
  | 'SWITCHED'        // switch dispatched this frame
  | 'RETURN_REQUIRED' // waiting for yaw to return toward neutral
  | 'NAV_COOLDOWN';

// ─── Tilt-navigation (Undo/Redo) states ────────────────────────────────────

export type TiltState =
  | 'NEUTRAL'
  | 'TILT_LEFT_PENDING'
  | 'TILT_RIGHT_PENDING'
  | 'SWITCHED'
  | 'RETURN_REQUIRED'
  | 'TILT_COOLDOWN';

// ─── Output produced by update() ──────────────────────────────────────────

export type GestureAction =
  | 'NONE'
  | 'DOUBLE_BLINK'
  | 'TAB_LEFT'
  | 'TAB_RIGHT'
  | 'UNDO'
  | 'REDO';

export interface GestureOutput {
  /** What action should the caller execute this frame (exactly once). */
  action: GestureAction;
  /** Whether cursor position updates must be suppressed this frame. */
  freezeCursor: boolean;
  /** Blink state for UI diagnostics. */
  blinkState: BlinkState;
  /** Tab-navigation state for UI diagnostics. */
  tabNavState: TabNavState;
  /** Tilt state for UI diagnostics. */
  tiltState: TiltState;
  /** Live blink score (0–1). */
  blinkScore: number;
  /** How far through the click progress (0–1). */
  clickProgress: number;
  /** Current gesture label for the live preview. */
  gestureLabel: string;
  /** Reason the last action was cancelled/failed, or empty string. */
  cancelReason: string;
}

// ─── Configuration (all tuneable without recompiling) ─────────────────────

export interface GestureConfig {
  /** Eye blink score that starts BLINK_PENDING. Lower = more sensitive. */
  blinkCandidateThreshold: number;
  /** Eye blink score required at end of confirmation window to fire click. */
  blinkClickThreshold: number;
  /** Eye blink score below which eyes are considered open (hysteresis). */
  blinkResetThreshold: number;
  /** How many consecutive valid frames must stay above candidate threshold. */
  blinkConfirmFrames: number;
  /** Max time to wait for the second blink. */
  doubleBlinkWindowMs: number;
  /** Post-click cooldown in ms before re-arming. */
  clickCooldownMs: number;

  /** Yaw (degrees, signed) beyond which a tab-switch candidate begins. */
  tabTurnThresholdDeg: number;
  /** Yaw must exceed this for tabTurnConfirmMs to count. */
  tabTurnHoldThresholdDeg: number;
  /** How many ms yaw must stay beyond threshold before switching. */
  tabTurnConfirmMs: number;
  /** Yaw must return within this many degrees of neutral to re-arm. */
  tabNeutralBand: number;
  /** Post-switch cooldown in ms before re-arming. */
  tabCooldownMs: number;

  /** Roll (degrees, signed) beyond which a tilt candidate begins. */
  tiltThresholdDeg: number;
  tiltHoldThresholdDeg: number;
  tiltConfirmMs: number;
  tiltNeutralBand: number;
  tiltCooldownMs: number;

  /** Master enable flags. */
  blinkClickEnabled: boolean;
  tabNavEnabled: boolean;
  tiltNavEnabled: boolean;
  /** Diagnostic preview: recognise gestures but don't fire actions. */
  previewOnly: boolean;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  blinkCandidateThreshold: 0.25, // start freezing cursor
  blinkClickThreshold: 0.30,     // must reach here within confirm window
  blinkResetThreshold: 0.15,     // must open eyes this far to reset
  blinkConfirmFrames: 1,         // ~1 frame for quick blinks (blinks are very fast)
  doubleBlinkWindowMs: 800,      // wait up to 800ms for second blink
  clickCooldownMs: 500,

  tabTurnThresholdDeg: 25,       // degrees from neutral to start pending
  tabTurnHoldThresholdDeg: 22,   // must stay above this during confirm
  tabTurnConfirmMs: 300,         // ms to hold turn before switching
  tabNeutralBand: 12,            // degrees from neutral = "returned"
  tabCooldownMs: 600,

  tiltThresholdDeg: 20,          // degrees from neutral to start pending
  tiltHoldThresholdDeg: 18,
  tiltConfirmMs: 300,
  tiltNeutralBand: 10,
  tiltCooldownMs: 600,

  blinkClickEnabled: true,
  tabNavEnabled: true,
  tiltNavEnabled: true,
  previewOnly: false,
};

// ─── Inputs passed to update() ─────────────────────────────────────────────

export interface GestureInput {
  /** Combined blink blendshape score from MediaPipe (0–1). NaN = invalid frame. */
  blinkScore: number;
  /** Yaw relative to calibrated neutral, in degrees. + = right, − = left. */
  relativeYawDeg: number;
  /** Roll relative to calibrated neutral, in degrees. + = right, − = left. */
  relativeRollDeg: number;
  /** Whether face tracking is currently valid. */
  trackingValid: boolean;
  /** Monotonic timestamp in ms (e.g. performance.now() or Date.now()). */
  nowMs: number;
}

// ─── State machine ─────────────────────────────────────────────────────────

export class GestureStateMachine {
  private cfg: GestureConfig;

  // ── Blink state ──
  private blinkState: BlinkState = 'IDLE';
  private blinkConfirmCount = 0;
  private peakBlinkScore = 0;
  private blinkCooldownUntil = 0;
  private doubleBlinkTimeoutUntil = 0;
  private lastBlinkScore = 0;

  // ── Tab-nav state ──
  private tabNavState: TabNavState = 'NEUTRAL';
  private turnStartMs = 0;
  private turnDirection: 'left' | 'right' | null = null;
  private tabCooldownUntil = 0;

  // ── Tilt state ──
  private tiltState: TiltState = 'NEUTRAL';
  private tiltStartMs = 0;
  private tiltDirection: 'left' | 'right' | null = null;
  private tiltCooldownUntil = 0;

  // ── Diagnostic output ──
  private lastOutput: GestureOutput = {
    action: 'NONE',
    freezeCursor: false,
    blinkState: 'IDLE',
    tabNavState: 'NEUTRAL',
    tiltState: 'NEUTRAL',
    blinkScore: 0,
    clickProgress: 0,
    gestureLabel: 'None',
    cancelReason: '',
  };

  private paused = false;

  constructor(config: Partial<GestureConfig> = {}) {
    this.cfg = { ...DEFAULT_GESTURE_CONFIG, ...config };
  }

  /** Reconfigure without resetting state (for live tuning). */
  public configure(overrides: Partial<GestureConfig>): void {
    this.cfg = { ...this.cfg, ...overrides };
  }

  public getConfig(): Readonly<GestureConfig> {
    return this.cfg;
  }

  /** Pause — freezes all actions and resets pending states. */
  public pause(): void {
    this.paused = true;
    this.cancelBlink('Paused');
    this.cancelTabNav('Paused');
    this.cancelTilt('Paused');
  }

  /** Resume — clears pause flag but does not replay missed frames. */
  public resume(): void {
    this.paused = false;
  }

  /** Hard stop — same as pause but also resets cooldowns. */
  public stop(): void {
    this.paused = true;
    this.resetAll();
  }

  /**
   * Process one frame of measurements.
   * Returns the authoritative GestureOutput for this frame.
   * The caller must execute output.action exactly once.
   */
  public update(input: GestureInput): GestureOutput {
    const { nowMs, trackingValid, blinkScore, relativeYawDeg } = input;

    this.lastBlinkScore = blinkScore;

    // ── 1. Safety: paused or invalid tracking ────────────────────────────
    if (this.paused) {
      return this.emit('NONE', false, 0, '', nowMs);
    }

    if (!trackingValid) {
      // Cancel anything pending
      if (this.blinkState !== 'IDLE' && this.blinkState !== 'COOLDOWN') {
        this.cancelBlink('Tracking lost');
      }
      if (
        this.tabNavState !== 'NEUTRAL' &&
        this.tabNavState !== 'NAV_COOLDOWN'
      ) {
        this.cancelTabNav('Tracking lost');
      }
      if (
        this.tiltState !== 'NEUTRAL' &&
        this.tiltState !== 'TILT_COOLDOWN'
      ) {
        this.cancelTilt('Tracking lost');
      }
      return this.emit('NONE', false, 0, '', nowMs);
    }

    const validBlink = Number.isFinite(blinkScore) && blinkScore >= 0;

    // ── 2. Double-blink state machine ────────────────────────────────────
    let blinkAction: GestureAction = 'NONE';
    let freezeForBlink = false;
    let blinkProgress = 0;

    if (this.cfg.blinkClickEnabled) {
      const result = this.stepBlink(validBlink ? blinkScore : 0, nowMs);
      blinkAction = result.action;
      freezeForBlink = result.freeze;
      blinkProgress = result.progress;
    }

    // ── 3. Tab-nav state machine (only runs if blink is not active) ──────
    let tabAction: GestureAction = 'NONE';
    let freezeForTab = false;

    if (this.cfg.tabNavEnabled && blinkAction === 'NONE' && !freezeForBlink) {
      const result = this.stepTabNav(relativeYawDeg, nowMs);
      tabAction = result.action;
      freezeForTab = result.freeze;
    } else if (freezeForBlink) {
      // Blink is pending — also suppress tab detection to avoid interference
      this.cancelTabNav('Blink gesture active');
    }

    // ── 3.5. Tilt state machine (runs if blink and tab are not active) ──
    let tiltAction: GestureAction = 'NONE';
    let freezeForTilt = false;

    if (this.cfg.tiltNavEnabled && blinkAction === 'NONE' && !freezeForBlink && tabAction === 'NONE' && !freezeForTab) {
      const result = this.stepTilt(input.relativeRollDeg, nowMs);
      tiltAction = result.action;
      freezeForTilt = result.freeze;
    } else if (freezeForBlink || freezeForTab) {
      this.cancelTilt('Higher priority gesture active');
    }

    // ── 4. Arbitration: exactly one action ───────────────────────────────
    let finalAction: GestureAction = 'NONE';
    if (blinkAction !== 'NONE') finalAction = blinkAction;
    else if (tabAction !== 'NONE') finalAction = tabAction;
    else if (tiltAction !== 'NONE') finalAction = tiltAction;

    const freezeCursor = freezeForBlink || freezeForTab || freezeForTilt;

    return this.emit(finalAction, freezeCursor, blinkProgress, '', nowMs);
  }

  // ─── Double Blink sub-machine ────────────────────────────────────────────

  private stepBlink(
    val: number,
    nowMs: number
  ): { action: GestureAction; freeze: boolean; progress: number } {
    const { blinkState } = this;

    switch (blinkState) {
      case 'IDLE': {
        if (val >= this.cfg.blinkCandidateThreshold) {
          this.blinkState = 'BLINK_1_PENDING';
          this.blinkConfirmCount = 1;
          this.peakBlinkScore = val;
        }
        return { action: 'NONE', freeze: false, progress: 0 };
      }

      case 'BLINK_1_PENDING': {
        if (val < this.cfg.blinkCandidateThreshold) {
          // Blink was too short or cancelled
          if (this.blinkConfirmCount >= this.cfg.blinkConfirmFrames && this.peakBlinkScore >= this.cfg.blinkClickThreshold) {
             // Valid blink 1 completed!
             this.blinkState = 'WAITING_FOR_BLINK_2';
             this.doubleBlinkTimeoutUntil = nowMs + this.cfg.doubleBlinkWindowMs;
             // DO NOT freeze during the wait, so natural single blinks don't freeze the cursor!
             return { action: 'NONE', freeze: false, progress: 0.5 };
          }
          this.cancelBlink('Blink 1 too short');
          return { action: 'NONE', freeze: false, progress: 0 };
        }

        this.blinkConfirmCount++;
        this.peakBlinkScore = Math.max(this.peakBlinkScore, val);

        return { action: 'NONE', freeze: true, progress: 0.25 };
      }

      case 'WAITING_FOR_BLINK_2': {
        if (nowMs > this.doubleBlinkTimeoutUntil) {
          this.cancelBlink('Timeout waiting for Blink 2');
          return { action: 'NONE', freeze: false, progress: 0 };
        }
        
        if (val >= this.cfg.blinkCandidateThreshold) {
          // Blink 2 started
          this.blinkState = 'BLINK_2_PENDING';
          this.blinkConfirmCount = 1;
          this.peakBlinkScore = val;
          return { action: 'NONE', freeze: true, progress: 0.75 };
        }

        return { action: 'NONE', freeze: false, progress: 0.5 };
      }
      
      case 'BLINK_2_PENDING': {
        if (val < this.cfg.blinkCandidateThreshold) {
          if (this.blinkConfirmCount >= this.cfg.blinkConfirmFrames && this.peakBlinkScore >= this.cfg.blinkClickThreshold) {
             this.blinkState = 'CLICKED';
             return { action: 'NONE', freeze: true, progress: 1 };
          }
          this.cancelBlink('Blink 2 too short');
          return { action: 'NONE', freeze: false, progress: 0 };
        }

        this.blinkConfirmCount++;
        this.peakBlinkScore = Math.max(this.peakBlinkScore, val);

        if (this.blinkConfirmCount >= this.cfg.blinkConfirmFrames && this.peakBlinkScore >= this.cfg.blinkClickThreshold) {
             this.blinkState = 'CLICKED';
             return { action: 'NONE', freeze: true, progress: 1 };
        }
        
        return { action: 'NONE', freeze: true, progress: 0.75 };
      }

      case 'CLICKED': {
        this.blinkState = 'CLOSE_REQUIRED';
        this.blinkCooldownUntil = nowMs + this.cfg.clickCooldownMs;

        const action: GestureAction = this.cfg.previewOnly
          ? 'NONE'
          : 'DOUBLE_BLINK';
        return { action, freeze: true, progress: 1 };
      }

      case 'CLOSE_REQUIRED': {
        if (val <= this.cfg.blinkResetThreshold) {
          this.blinkState = 'COOLDOWN';
        }
        return { action: 'NONE', freeze: true, progress: 1 };
      }

      case 'COOLDOWN': {
        if (nowMs >= this.blinkCooldownUntil) {
          this.blinkState = 'IDLE';
          this.blinkConfirmCount = 0;
          this.peakBlinkScore = 0;
        }
        return { action: 'NONE', freeze: false, progress: 0 };
      }
    }
  }

  // ─── Tab-nav sub-machine ─────────────────────────────────────────────────

  private stepTabNav(
    yaw: number,
    nowMs: number
  ): { action: GestureAction; freeze: boolean } {
    const { tabNavState } = this;

    switch (tabNavState) {
      case 'NEUTRAL': {
        if (nowMs < this.tabCooldownUntil) {
          return { action: 'NONE', freeze: false };
        }

        if (yaw <= -this.cfg.tabTurnThresholdDeg) {
          // Left turn candidate
          this.tabNavState = 'TURN_LEFT_PENDING';
          this.turnStartMs = nowMs;
          this.turnDirection = 'left';
          return { action: 'NONE', freeze: true };
        }

        if (yaw >= this.cfg.tabTurnThresholdDeg) {
          // Right turn candidate
          this.tabNavState = 'TURN_RIGHT_PENDING';
          this.turnStartMs = nowMs;
          this.turnDirection = 'right';
          return { action: 'NONE', freeze: true };
        }

        return { action: 'NONE', freeze: false };
      }

      case 'TURN_LEFT_PENDING': {
        const held = yaw <= -this.cfg.tabTurnHoldThresholdDeg;
        if (!held) {
          this.cancelTabNav('Turn not held');
          return { action: 'NONE', freeze: false };
        }

        const elapsed = nowMs - this.turnStartMs;
        if (elapsed >= this.cfg.tabTurnConfirmMs) {
          this.tabNavState = 'SWITCHED';
          return { action: 'NONE', freeze: true };
        }

        return { action: 'NONE', freeze: true };
      }

      case 'TURN_RIGHT_PENDING': {
        const held = yaw >= this.cfg.tabTurnHoldThresholdDeg;
        if (!held) {
          this.cancelTabNav('Turn not held');
          return { action: 'NONE', freeze: false };
        }

        const elapsed = nowMs - this.turnStartMs;
        if (elapsed >= this.cfg.tabTurnConfirmMs) {
          this.tabNavState = 'SWITCHED';
          return { action: 'NONE', freeze: true };
        }

        return { action: 'NONE', freeze: true };
      }

      case 'SWITCHED': {
        // Fire action this frame, then require return to neutral
        this.tabNavState = 'RETURN_REQUIRED';
        this.tabCooldownUntil = nowMs + this.cfg.tabCooldownMs;

        if (this.cfg.previewOnly) {
          return { action: 'NONE', freeze: true };
        }

        const action: GestureAction =
          this.turnDirection === 'left' ? 'TAB_LEFT' : 'TAB_RIGHT';
        return { action, freeze: true };
      }

      case 'RETURN_REQUIRED': {
        const returned = Math.abs(yaw) <= this.cfg.tabNeutralBand;
        if (returned) {
          this.tabNavState = 'NAV_COOLDOWN';
        }
        return { action: 'NONE', freeze: true };
      }

      case 'NAV_COOLDOWN': {
        if (nowMs >= this.tabCooldownUntil) {
          this.tabNavState = 'NEUTRAL';
          this.turnDirection = null;
        }
        return { action: 'NONE', freeze: false };
      }
    }
  }

  // ─── Tilt sub-machine ────────────────────────────────────────────────────

  private stepTilt(
    roll: number,
    nowMs: number
  ): { action: GestureAction; freeze: boolean } {
    const { tiltState } = this;

    switch (tiltState) {
      case 'NEUTRAL': {
        if (nowMs < this.tiltCooldownUntil) {
          return { action: 'NONE', freeze: false };
        }

        if (roll <= -this.cfg.tiltThresholdDeg) {
          // Left tilt candidate
          this.tiltState = 'TILT_LEFT_PENDING';
          this.tiltStartMs = nowMs;
          this.tiltDirection = 'left';
          return { action: 'NONE', freeze: true };
        }

        if (roll >= this.cfg.tiltThresholdDeg) {
          // Right tilt candidate
          this.tiltState = 'TILT_RIGHT_PENDING';
          this.tiltStartMs = nowMs;
          this.tiltDirection = 'right';
          return { action: 'NONE', freeze: true };
        }

        return { action: 'NONE', freeze: false };
      }

      case 'TILT_LEFT_PENDING': {
        const held = roll <= -this.cfg.tiltHoldThresholdDeg;
        if (!held) {
          this.cancelTilt('Tilt not held');
          return { action: 'NONE', freeze: false };
        }

        const elapsed = nowMs - this.tiltStartMs;
        if (elapsed >= this.cfg.tiltConfirmMs) {
          this.tiltState = 'SWITCHED';
          return { action: 'NONE', freeze: true };
        }

        return { action: 'NONE', freeze: true };
      }

      case 'TILT_RIGHT_PENDING': {
        const held = roll >= this.cfg.tiltHoldThresholdDeg;
        if (!held) {
          this.cancelTilt('Tilt not held');
          return { action: 'NONE', freeze: false };
        }

        const elapsed = nowMs - this.tiltStartMs;
        if (elapsed >= this.cfg.tiltConfirmMs) {
          this.tiltState = 'SWITCHED';
          return { action: 'NONE', freeze: true };
        }

        return { action: 'NONE', freeze: true };
      }

      case 'SWITCHED': {
        // Fire action this frame, then require return to neutral
        this.tiltState = 'RETURN_REQUIRED';
        this.tiltCooldownUntil = nowMs + this.cfg.tiltCooldownMs;

        if (this.cfg.previewOnly) {
          return { action: 'NONE', freeze: true };
        }

        const action: GestureAction =
          this.tiltDirection === 'left' ? 'UNDO' : 'REDO';
        return { action, freeze: true };
      }

      case 'RETURN_REQUIRED': {
        const returned = Math.abs(roll) <= this.cfg.tiltNeutralBand;
        if (returned) {
          this.tiltState = 'TILT_COOLDOWN';
        }
        return { action: 'NONE', freeze: true };
      }

      case 'TILT_COOLDOWN': {
        if (nowMs >= this.tiltCooldownUntil) {
          this.tiltState = 'NEUTRAL';
          this.tiltDirection = null;
        }
        return { action: 'NONE', freeze: false };
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private cancelBlink(reason: string): void {
    this.lastOutput = { ...this.lastOutput, cancelReason: reason };
    this.blinkState = 'IDLE';
    this.blinkConfirmCount = 0;
    this.peakBlinkScore = 0;
  }

  private cancelTabNav(reason: string): void {
    if (
      this.tabNavState === 'TURN_LEFT_PENDING' ||
      this.tabNavState === 'TURN_RIGHT_PENDING' ||
      this.tabNavState === 'RETURN_REQUIRED'
    ) {
      this.lastOutput = { ...this.lastOutput, cancelReason: reason };
      this.tabNavState = 'NEUTRAL';
      this.turnDirection = null;
    }
  }

  private cancelTilt(reason: string): void {
    if (
      this.tiltState === 'TILT_LEFT_PENDING' ||
      this.tiltState === 'TILT_RIGHT_PENDING' ||
      this.tiltState === 'RETURN_REQUIRED'
    ) {
      this.lastOutput = { ...this.lastOutput, cancelReason: reason };
      this.tiltState = 'NEUTRAL';
      this.tiltDirection = null;
    }
  }

  private resetAll(): void {
    this.blinkState = 'IDLE';
    this.blinkConfirmCount = 0;
    this.peakBlinkScore = 0;
    this.blinkCooldownUntil = 0;
    
    this.tabNavState = 'NEUTRAL';
    this.turnStartMs = 0;
    this.turnDirection = null;
    this.tabCooldownUntil = 0;

    this.tiltState = 'NEUTRAL';
    this.tiltStartMs = 0;
    this.tiltDirection = null;
    this.tiltCooldownUntil = 0;
  }

  private gestureLabel(_action: GestureAction, freeze: boolean): string {
    if (this.blinkState === 'BLINK_1_PENDING') return 'Blink Pending…';
    if (this.blinkState === 'WAITING_FOR_BLINK_2') return 'Waiting for Blink 2…';
    if (this.blinkState === 'BLINK_2_PENDING') return 'Blink 2 Pending…';
    if (this.blinkState === 'CLICKED' || this.blinkState === 'CLOSE_REQUIRED')
      return '✓ Double Blink Click';
    if (this.blinkState === 'COOLDOWN') return 'Cooldown';
    
    if (this.tabNavState === 'TURN_LEFT_PENDING') return 'Turn Left Pending…';
    if (this.tabNavState === 'TURN_RIGHT_PENDING') return 'Turn Right Pending…';
    if (this.tabNavState === 'SWITCHED' || this.tabNavState === 'RETURN_REQUIRED')
      return '✓ Tab Switch';
    if (this.tabNavState === 'NAV_COOLDOWN') return 'Nav Cooldown';
    
    if (this.tiltState === 'TILT_LEFT_PENDING') return 'Tilt Left Pending…';
    if (this.tiltState === 'TILT_RIGHT_PENDING') return 'Tilt Right Pending…';
    if (this.tiltState === 'SWITCHED' || this.tiltState === 'RETURN_REQUIRED')
      return '✓ Undo / Redo';
    if (this.tiltState === 'TILT_COOLDOWN') return 'Tilt Cooldown';

    if (freeze) return 'Frozen';
    return 'None';
  }

  private emit(
    action: GestureAction,
    freezeCursor: boolean,
    mouthProgress: number,
    cancelReason: string,
    _nowMs: number
  ): GestureOutput {
    const out: GestureOutput = {
      action,
      freezeCursor,
      blinkState: this.blinkState,
      tabNavState: this.tabNavState,
      tiltState: this.tiltState,
      blinkScore: this.lastBlinkScore,
      clickProgress: mouthProgress,
      gestureLabel: this.gestureLabel(action, freezeCursor),
      cancelReason: cancelReason || this.lastOutput.cancelReason,
    };
    this.lastOutput = out;
    return out;
  }

  /** Read the last emitted output without stepping. */
  public getLastOutput(): GestureOutput {
    return this.lastOutput;
  }
}
