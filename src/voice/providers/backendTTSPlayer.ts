import { SupportedLanguage } from '../../shared/types/assistant';

const BACKEND_URL = 'http://localhost:4000';

export class BackendTTSPlayer {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private finishPending: (() => void) | null = null;

  public async speak(text: string, language: SupportedLanguage): Promise<void> {
    await this.stop();
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const response = await fetch(`${BACKEND_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || `Speech synthesis failed (HTTP ${response.status})`);
      }

      this.objectUrl = URL.createObjectURL(await response.blob());
      this.audio = new Audio(this.objectUrl);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          this.cleanup();
          error ? reject(error) : resolve();
        };
        this.finishPending = () => finish();
        this.audio!.onended = () => finish();
        this.audio!.onerror = () => finish(new Error('Unable to play synthesized speech.'));
        this.audio!.play().catch(finish);
      });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  public async stop(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    if (this.finishPending) this.finishPending();
    else this.cleanup();
  }

  private cleanup(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.audio = null;
    this.objectUrl = null;
    this.finishPending = null;
  }
}
