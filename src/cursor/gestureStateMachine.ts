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
 *  2. MOUTH_CLICK state machine.
 *  3. TAB_NAV state machine.
 *  4. Normal cursor movement.
 *
 * No DOM, Chrome API, or rAF dependencies — purely synchronous logic driven
 * by the caller's detection loop. This makes it fully testable with synthetic
 * inputs and a fake clock.
 */

// ─── Mouth-click states ────────────────────────────────────────────────────

export type MouthState =
  | 'IDLE'
  | 'OPEN_PENDING'   // jaw crossed candidate threshold; cursor frozen; confirming
  | 'CLICKED'        // click dispatched this frame
  | 'CLOSE_REQUIRED' // waiting for jaw to drop below reset threshold
  | 'COOLDOWN';      // post-click lockout

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
  | 'MOUTH_CLICK'
  | 'TAB_LEFT'
  | 'TAB_RIGHT'
  | 'UNDO'
  | 'REDO';

export interface GestureOutput {
  /** What action should the caller execute this frame (exactly once). */
  action: GestureAction;
  /** Whether cursor position updates must be suppressed this frame. */
  freezeCursor: boolean;
  /** Mouth-click state for UI diagnostics. */
  mouthState: MouthState;
  /** Tab-navigation state for UI diagnostics. */
  tabNavState: TabNavState;
  /** Tilt state for UI diagnostics. */
  tiltState: TiltState;
  /** Live jaw-open score (0–1). */
  jawOpenScore: number;
  /** How far through the open-pending confirmation window (0–1). */
  mouthProgress: number;
  /** Current gesture label for the live preview. */
  gestureLabel: string;
  /** Reason the last action was cancelled/failed, or empty string. */
  cancelReason: string;
}

// ─── Configuration (all tuneable without recompiling) ─────────────────────

export interface GestureConfig {
  /** Jaw-open score that starts OPEN_PENDING. Lower = more sensitive. */
  mouthCandidateThreshold: number;
  /** Jaw-open score required at end of confirmation window to fire click. */
  mouthClickThreshold: number;
  /** Jaw-open score below which mouth is considered closed (hysteresis). */
  mouthResetThreshold: number;
  /** How many consecutive valid frames must stay above candidate threshold. */
  mouthConfirmFrames: number;
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
  mouthClickEnabled: boolean;
  tabNavEnabled: boolean;
  tiltNavEnabled: boolean;
  /** Diagnostic preview: recognise gestures but don't fire actions. */
  previewOnly: boolean;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  mouthCandidateThreshold: 0.50, // start freezing cursor
  mouthClickThreshold: 0.62,     // must reach here within confirm window
  mouthResetThreshold: 0.25,     // must close this far before re-arming
  mouthConfirmFrames: 4,         // ~4 frames @ 30fps ≈ 133ms
  clickCooldownMs: 1000,

  tabTurnThresholdDeg: 25,       // degrees from neutral to start pending
  tabTurnHoldThresholdDeg: 22,   // must stay above this during confirm
  tabTurnConfirmMs: 380,         // ms to hold turn before switching
  tabNeutralBand: 12,            // degrees from neutral = "returned"
  tabCooldownMs: 1200,

  tiltThresholdDeg: 20,          // degrees from neutral to start pending
  tiltHoldThresholdDeg: 18,
  tiltConfirmMs: 380,
  tiltNeutralBand: 10,
  tiltCooldownMs: 1200,

  mouthClickEnabled: true,
  tabNavEnabled: true,
  tiltNavEnabled: true,
  previewOnly: false,
};

// ─── Inputs passed to update() ─────────────────────────────────────────────

export interface GestureInput {
  /** Jaw-open blendshape score from MediaPipe (0–1). NaN = invalid frame. */
  jawOpenScore: number;
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

  // ── Mouth state ──
  private mouthState: MouthState = 'IDLE';
  private mouthConfirmCount = 0;
  private peakJawScore = 0;
  private mouthCooldownUntil = 0;
  private lastJawScore = 0;

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
    mouthState: 'IDLE',
    tabNavState: 'NEUTRAL',
    tiltState: 'NEUTRAL',
    jawOpenScore: 0,
    mouthProgress: 0,
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
    this.cancelMouth('Paused');
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
    const { nowMs, trackingValid, jawOpenScore, relativeYawDeg } = input;

    this.lastJawScore = jawOpenScore;

    // ── 1. Safety: paused or invalid tracking ────────────────────────────
    if (this.paused) {
      return this.emit('NONE', false, 0, '', nowMs);
    }

    if (!trackingValid) {
      // Cancel anything pending
      if (this.mouthState !== 'IDLE' && this.mouthState !== 'COOLDOWN') {
        this.cancelMouth('Tracking lost');
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

    const validJaw = Number.isFinite(jawOpenScore) && jawOpenScore >= 0;

    // ── 2. Mouth-click state machine ─────────────────────────────────────
    let mouthAction: GestureAction = 'NONE';
    let freezeForMouth = false;
    let mouthProgress = 0;

    if (this.cfg.mouthClickEnabled) {
      const result = this.stepMouth(validJaw ? jawOpenScore : 0, nowMs);
      mouthAction = result.action;
      freezeForMouth = result.freeze;
      mouthProgress = result.progress;
    }

    // ── 3. Tab-nav state machine (only runs if mouth is not active) ──────
    let tabAction: GestureAction = 'NONE';
    let freezeForTab = false;

    if (this.cfg.tabNavEnabled && mouthAction === 'NONE' && !freezeForMouth) {
      const result = this.stepTabNav(relativeYawDeg, nowMs);
      tabAction = result.action;
      freezeForTab = result.freeze;
    } else if (freezeForMouth) {
      // Mouth is pending — also suppress tab detection to avoid interference
      this.cancelTabNav('Mouth gesture active');
    }

    // ── 3.5. Tilt state machine (runs if mouth and tab are not active) ──
    let tiltAction: GestureAction = 'NONE';
    let freezeForTilt = false;

    if (this.cfg.tiltNavEnabled && mouthAction === 'NONE' && !freezeForMouth && tabAction === 'NONE' && !freezeForTab) {
      const result = this.stepTilt(input.relativeRollDeg, nowMs);
      tiltAction = result.action;
      freezeForTilt = result.freeze;
    } else if (freezeForMouth || freezeForTab) {
      this.cancelTilt('Higher priority gesture active');
    }

    // ── 4. Arbitration: exactly one action ───────────────────────────────
    let finalAction: GestureAction = 'NONE';
    if (mouthAction !== 'NONE') finalAction = mouthAction;
    else if (tabAction !== 'NONE') finalAction = tabAction;
    else if (tiltAction !== 'NONE') finalAction = tiltAction;

    const freezeCursor = freezeForMouth || freezeForTab || freezeForTilt;

    return this.emit(finalAction, freezeCursor, mouthProgress, '', nowMs);
  }

  // ─── Mouth sub-machine ───────────────────────────────────────────────────

  private stepMouth(
    jaw: number,
    nowMs: number
  ): { action: GestureAction; freeze: boolean; progress: number } {
    const { mouthState } = this;

    switch (mouthState) {
      case 'IDLE': {
        if (jaw >= this.cfg.mouthCandidateThreshold) {
          this.mouthState = 'OPEN_PENDING';
          this.mouthConfirmCount = 1;
          this.peakJawScore = jaw;
        }
        return { action: 'NONE', freeze: false, progress: 0 };
      }

      case 'OPEN_PENDING': {
        if (jaw < this.cfg.mouthCandidateThreshold) {
          // Dropped below candidate — cancelled
          this.cancelMouth('Mouth closed before confirmation');
          return { action: 'NONE', freeze: false, progress: 0 };
        }

        this.mouthConfirmCount++;
        this.peakJawScore = Math.max(this.peakJawScore, jaw);

        const progress = Math.min(
          1,
          this.mouthConfirmCount / this.cfg.mouthConfirmFrames
        );

        if (
          this.mouthConfirmCount >= this.cfg.mouthConfirmFrames &&
          this.peakJawScore >= this.cfg.mouthClickThreshold
        ) {
          // Confirmed — fire click
          this.mouthState = 'CLICKED';
          return { action: 'NONE', freeze: true, progress: 1 };
        }

        // Still accumulating
        return { action: 'NONE', freeze: true, progress };
      }

      case 'CLICKED': {
        // Emit the click action this frame, then move to CLOSE_REQUIRED
        this.mouthState = 'CLOSE_REQUIRED';
        this.mouthCooldownUntil = nowMs + this.cfg.clickCooldownMs;

        const action: GestureAction = this.cfg.previewOnly
          ? 'NONE'
          : 'MOUTH_CLICK';
        return { action, freeze: true, progress: 1 };
      }

      case 'CLOSE_REQUIRED': {
        if (jaw <= this.cfg.mouthResetThreshold) {
          this.mouthState = 'COOLDOWN';
        }
        // Keep cursor frozen until cooldown too
        return { action: 'NONE', freeze: true, progress: 1 };
      }

      case 'COOLDOWN': {
        if (nowMs >= this.mouthCooldownUntil) {
          this.mouthState = 'IDLE';
          this.mouthConfirmCount = 0;
          this.peakJawScore = 0;
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

  private cancelMouth(reason: string): void {
    this.lastOutput = { ...this.lastOutput, cancelReason: reason };
    this.mouthState = 'IDLE';
    this.mouthConfirmCount = 0;
    this.peakJawScore = 0;
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
    this.mouthState = 'IDLE';
    this.mouthConfirmCount = 0;
    this.peakJawScore = 0;
    this.mouthCooldownUntil = 0;
    
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
    if (this.mouthState === 'OPEN_PENDING') return 'Mouth Pending…';
    if (this.mouthState === 'CLICKED' || this.mouthState === 'CLOSE_REQUIRED')
      return '✓ Mouth Click';
    if (this.mouthState === 'COOLDOWN') return 'Cooldown';
    
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
      mouthState: this.mouthState,
      tabNavState: this.tabNavState,
      tiltState: this.tiltState,
      jawOpenScore: this.lastJawScore,
      mouthProgress,
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
