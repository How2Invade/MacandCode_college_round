/**
 * Wake Word Listener ("Hey Mac")
 * Enables hands-free voice assistant activation via background speech recognition.
 */

import { logger } from '../shared/utils';

export interface WakeWordEvent {
  wakePhrase: string;
  command: string; // Any command spoken immediately after the wake word
  timestamp: number;
}

export type WakeWordCallback = (event: WakeWordEvent) => void;

/**
 * Phonetically tolerant pattern for "Hey Mac":
 * Handles: "Hey Mac", "Hi Mac", "Hey Mack", "Hey Mak", "Hey Mark", "OK Mac", "Mac"
 */
export const WAKE_WORD_PATTERN = /^(?:hey|hi|ok|okay)?\s*(?:mac|mack|mak|mark)\b[\s,:]*/i;

/**
 * Synthesizes a futuristic, clean dual-tone chime (D5 -> A5)
 * confirming the wake word has been heard without needing external audio files.
 */
export function playWakeChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;

    const audioCtx = new AudioCtxClass();
    const now = audioCtx.currentTime;

    // First tone: 587.33 Hz (D5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Second tone: 880 Hz (A5)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.09);
    gain2.gain.setValueAtTime(0.18, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.28);
  } catch (err) {
    // Ignore audio playback errors if audioContext cannot be initialized
  }
}

/**
 * Inspects a transcript to see if it matches the "Hey Mac" wake phrase.
 * Returns the matched wake phrase and the trailing user command (if any).
 */
export function parseWakeWord(transcript: string): { matched: boolean; wakePhrase: string; command: string } {
  const trimmed = transcript.trim();
  const match = trimmed.match(WAKE_WORD_PATTERN);
  if (!match) {
    return { matched: false, wakePhrase: '', command: '' };
  }

  const wakePhrase = match[0].trim();
  const command = trimmed.slice(match[0].length).trim();
  return { matched: true, wakePhrase, command };
}

export class WakeWordListener {
  private recognition: any = null;
  private isListening = false;
  private isPaused = false;
  private restartTimeout: any = null;
  private lastTriggerTimestamp = 0;
  private cooldownMs = 1500;
  private listeners: WakeWordCallback[] = [];

  constructor(cooldownMs = 1500) {
    this.cooldownMs = cooldownMs;
  }

  public onWake(callback: WakeWordCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  public start(): boolean {
    if (this.isListening) return true;
    if (typeof window === 'undefined') return false;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      logger.warn('WakeWordListener', 'SpeechRecognition is not supported in this browser.');
      return false;
    }

    try {
      this.isListening = true;
      this.isPaused = false;
      this.initRecognition(SpeechRecognition);
      return true;
    } catch (err) {
      logger.error('WakeWordListener', 'Failed to initialize wake word recognition', err);
      this.isListening = false;
      return false;
    }
  }

  public stop(): void {
    this.isListening = false;
    this.isPaused = false;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
    if (this.isListening && !this.recognition) {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.initRecognition(SpeechRecognition);
      }
    }
  }

  public isActive(): boolean {
    return this.isListening && !this.isPaused;
  }

  private initRecognition(SpeechRecognition: any): void {
    if (!this.isListening) return;

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event: any) => {
        if (!this.isListening || this.isPaused) return;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript || '';
          const { matched, wakePhrase, command } = parseWakeWord(transcript);

          if (matched) {
            const now = Date.now();
            if (now - this.lastTriggerTimestamp >= this.cooldownMs) {
              this.lastTriggerTimestamp = now;
              logger.info('WakeWordListener', `Wake word triggered: "${wakePhrase}", Command: "${command}"`);
              playWakeChime();

              const wakeEvent: WakeWordEvent = {
                wakePhrase,
                command,
                timestamp: now,
              };

              for (const listener of this.listeners) {
                try {
                  listener(wakeEvent);
                } catch (err) {
                  logger.error('WakeWordListener', 'Error in wake listener callback', err);
                }
              }
            }
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          return; // Expected during silence
        }
        logger.warn('WakeWordListener', `Recognition error: ${event.error}`);
      };

      this.recognition.onend = () => {
        this.recognition = null;
        if (this.isListening && !this.isPaused) {
          // Restart gracefully after small delay
          if (this.restartTimeout) clearTimeout(this.restartTimeout);
          this.restartTimeout = setTimeout(() => {
            if (this.isListening && !this.isPaused) {
              this.initRecognition(SpeechRecognition);
            }
          }, 300);
        }
      };

      this.recognition.start();
    } catch (err) {
      logger.warn('WakeWordListener', 'Error starting recognition instance:', err);
    }
  }
}
