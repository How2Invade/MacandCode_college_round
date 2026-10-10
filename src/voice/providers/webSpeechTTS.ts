/** Backend-backed speech output using Sarvam for English, Hindi, and Marathi. */

import { SupportedLanguage } from '../../shared/types/assistant';
import { logger } from '../../shared/utils';
import { IVoiceSynthesizer, VoiceOutputOptions, VoiceState } from '../types';
import { BackendTTSPlayer } from './backendTTSPlayer';

export class WebSpeechTTSProvider implements IVoiceSynthesizer {
  private state: VoiceState = 'idle';
  private speaking = false;
  private stateListeners: ((state: VoiceState) => void)[] = [];
  private player = new BackendTTSPlayer();

  public async speak(
    text: string,
    language: SupportedLanguage,
    _options?: VoiceOutputOptions
  ): Promise<void> {
    if (!text.trim()) return;

    await this.stop();
    this.speaking = true;
    this.setState('speaking');
    try {
      await this.player.speak(text, language);
    } catch (error) {
      logger.warn('TTSProvider', 'Backend speech synthesis failed', error);
      throw error;
    } finally {
      this.speaking = false;
      this.setState('idle');
    }
  }

  public async stop(): Promise<void> {
    await this.player.stop();
    this.speaking = false;
    this.setState('idle');
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  public getState(): VoiceState {
    return this.state;
  }

  public onStateChange(listener: (state: VoiceState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((candidate) => candidate !== listener);
    };
  }

  private setState(state: VoiceState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (error) {
        logger.error('TTSProvider', 'Error in state listener', error);
      }
    }
  }
}
