/**
 * LiveKit Real-Time Conversational Voice Client
 * Runs in the Chrome extension sidepanel to provide low-latency WebRTC voice communication,
 * microphone streaming, audio playback, speech interruption, and browser-action orchestration.
 */

import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant } from 'livekit-client';
import { SupportedLanguage } from '../shared/types/assistant';
import { BrowserAction } from '../shared/types/actions';
import { ConversationMessage } from '../shared/types/assistant';
import { PageContext } from '../ai/types';
import { logger } from '../shared/utils';
import { BackendTTSPlayer } from './providers/backendTTSPlayer';

export type LiveKitVoiceState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export interface LiveKitVoiceOptions {
  backendUrl?: string;
  roomName?: string;
  language?: SupportedLanguage;
}

export interface LiveKitTranscriptEvent {
  text: string;
  isUser: boolean;
  isFinal: boolean;
  timestamp: number;
}

export class LiveKitVoiceClient {
  private room: Room | null = null;
  private backendUrl: string;
  private currentLanguage: SupportedLanguage = 'en';
  private state: LiveKitVoiceState = 'idle';
  private audioElements: HTMLAudioElement[] = [];
  private speechRecognition: any = null;
  private isListeningForSpeech = false;
  private silenceTimer: any = null;
  private pendingUtterance = '';
  private lastVoiceSubmission = { text: '', timestamp: 0 };
  private requestSequence = 0;
  private conversationContextProvider?: () => Promise<{ history: ConversationMessage[]; pageContext?: PageContext }>;
  private ttsPlayer = new BackendTTSPlayer();

  private stateListeners: ((state: LiveKitVoiceState) => void)[] = [];
  private transcriptListeners: ((event: LiveKitTranscriptEvent) => void)[] = [];
  private actionListeners: ((actions: BrowserAction[], reply: string, prompt?: string) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];

  constructor(options: LiveKitVoiceOptions = {}) {
    this.backendUrl = options.backendUrl || 'http://localhost:4000';
    this.currentLanguage = options.language || 'en';
  }

  public getState(): LiveKitVoiceState {
    return this.state;
  }

  public getLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  public setLanguage(language: SupportedLanguage): void {
    this.currentLanguage = language;
    if (this.speechRecognition) {
      const locales: Record<SupportedLanguage, string> = {
        en: 'en-US',
        hi: 'hi-IN',
        mr: 'mr-IN',
      };
      this.speechRecognition.lang = locales[language] || 'en-US';
    }
  }

  public setConversationContextProvider(
    provider: () => Promise<{ history: ConversationMessage[]; pageContext?: PageContext }>
  ): void {
    this.conversationContextProvider = provider;
  }

  /**
   * Prompts for and ensures Chrome microphone permissions are active.
   * If running inside a Sidepanel iframe where prompt is blocked, opens permission tab.
   */
  public async ensureMicrophonePermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone media devices not supported in this environment.');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.message?.includes('denied') || err.message?.includes('dismissed')) {
        if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
          chrome.tabs.create({
            url: chrome.runtime.getURL('src/sidepanel/index.html?mic=request'),
          });
          throw new Error(
            'Microphone access is required. A tab was opened—please click "Allow" on the Chrome prompt, then return here and click Connect Voice.'
          );
        }
      }
      throw err;
    }
  }

  /**
   * Connect to LiveKit Room via WebRTC with secure backend-generated token
   */
  public async connect(language?: SupportedLanguage): Promise<void> {
    if (language) {
      this.setLanguage(language);
    }

    if (this.room && this.room.state === 'connected') {
      logger.info('LiveKitVoiceClient', 'Already connected to LiveKit room.');
      return;
    }

    this.setState('connecting');

    try {
      // 0. Ensure Chrome microphone permission is granted
      await this.ensureMicrophonePermission();

      // 1. Fetch access token from secure backend
      const tokenRes = await fetch(`${this.backendUrl}/api/livekit/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: this.currentLanguage,
          roomName: 'handsfree-voice-room',
        }),
      });

      if (!tokenRes.ok) {
        const errData = await tokenRes.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to fetch LiveKit token (HTTP ${tokenRes.status})`
        );
      }

      const { token, serverUrl, roomName } = await tokenRes.json();

      // 2. Initialize LiveKit WebRTC Room
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      this.setupRoomListeners(this.room);

      // 3. Connect to WebRTC room
      await this.room.connect(serverUrl, token);
      logger.info('LiveKitVoiceClient', `Connected to LiveKit room: ${roomName}`);

      // 4. Enable local microphone track
      try {
        await this.room.localParticipant.setMicrophoneEnabled(true);
        logger.info('LiveKitVoiceClient', 'Microphone track published successfully.');
      } catch (micErr) {
        logger.warn('LiveKitVoiceClient', 'Microphone access denied or unavailable', micErr);
      }

      this.setState('connected');

      // 5. Start Speech Listener for real-time natural conversational flow
      this.startSpeechCapture();
    } catch (err) {
      const msg = (err as Error).message;
      this.setState('error');
      this.emitError(msg);
      throw err;
    }
  }

  /**
   * Disconnect from LiveKit room and clean up media resources
   */
  public async disconnect(): Promise<void> {
    this.stopSpeechCapture();
    this.stopAudioPlayback();
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.pendingUtterance = '';

    if (this.room) {
      try {
        await this.room.localParticipant?.setMicrophoneEnabled(false);
        await this.room.disconnect();
      } catch (err) {
        logger.warn('LiveKitVoiceClient', 'Error during disconnect', err);
      }
      this.room = null;
    }

    this.setState('idle');
  }

  /**
   * Immediately interrupts the agent when the user starts speaking
   */
  public interrupt(): void {
    this.requestSequence += 1;
    logger.info('LiveKitVoiceClient', 'User interrupted agent speech.');
    this.stopAudioPlayback();

    // Broadcast interrupt message over LiveKit data channel if connected
    if (this.room && this.room.state === 'connected') {
      try {
        const payload = new TextEncoder().encode(JSON.stringify({ type: 'interrupt' }));
        this.room.localParticipant.publishData(payload, { reliable: true });
      } catch (err) {
        logger.warn('LiveKitVoiceClient', 'Could not send interrupt data packet', err);
      }
    }

    this.setState('interrupted');
    setTimeout(() => {
      if (this.state === 'interrupted') {
        this.setState('listening');
      }
    }, 400);
  }

  /**
   * Send speech text / prompt to the LiveKit conversational agent
   */
  public async sendAgentMessage(
    prompt: string,
    history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Promise<void> {
    if (!prompt.trim()) return;
    const requestSequence = ++this.requestSequence;

    this.emitTranscript({
      text: prompt,
      isUser: true,
      isFinal: true,
      timestamp: Date.now(),
    });

    this.setState('thinking');

    try {
      const context = await this.conversationContextProvider?.();
      const contextHistory = context?.history
        .filter((message) => message.id !== 'init_msg')
        .slice(-12)
        .filter((message, index, items) => !(index === items.length - 1 && message.role === 'user' && message.content.trim() === prompt.trim()));
      const requestHistory = contextHistory || history;
      const response = await fetch(`${this.backendUrl}/api/livekit/agent-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          language: this.currentLanguage,
          roomName: this.room?.name || 'handsfree-voice-room',
          history: requestHistory?.slice(-12).map(({ role, content }) => ({ role, content: content.slice(-2000) })),
          pageContext: context?.pageContext,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Agent error (HTTP ${response.status})`);
      }

      const data = await response.json();
      if (requestSequence !== this.requestSequence) return;
      const replyText = data.reply || '';
      const actions: BrowserAction[] = Array.isArray(data.actions) ? data.actions : [];

      this.emitTranscript({
        text: replyText,
        isUser: false,
        isFinal: true,
        timestamp: Date.now(),
      });

      // Emit actions to approval & execution pipeline
      if (actions.length > 0) {
        this.emitActions(actions, replyText, prompt);
      }

      // Play audio response through TTS
      await this.speakReply(replyText);

      if (requestSequence === this.requestSequence) this.setState('listening');
    } catch (err) {
      const msg = (err as Error).message;
      this.setState('error');
      this.emitError(msg);
    }
  }

  private setupRoomListeners(room: Room): void {
    // Never play LiveKit's remote voice track: assistant speech must go through
    // BackendTTSPlayer so the configured Sarvam voice is authoritative.
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        logger.info('LiveKitVoiceClient', 'Ignoring remote audio track; speech uses the configured backend TTS provider.');
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach();
      this.audioElements = this.audioElements.filter((el) => !el.srcObject);
    });

    // Listen for data channel messages from Agent
    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);

        if (data.type === 'agent_response' && data.reply) {
          this.emitTranscript({
            text: data.reply,
            isUser: false,
            isFinal: true,
            timestamp: Date.now(),
          });
          if (Array.isArray(data.actions) && data.actions.length > 0) {
            this.emitActions(data.actions, data.reply, data.prompt);
          }
        } else if (data.type === 'interrupt') {
          this.interrupt();
        }
      } catch (err) {
        logger.warn('LiveKitVoiceClient', 'Malformed data packet received', err);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      logger.info('LiveKitVoiceClient', 'LiveKit room disconnected.');
      this.setState('idle');
    });
  }

  private startSpeechCapture(): void {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      logger.warn('LiveKitVoiceClient', 'Web Speech API not available for local STT bridging.');
      this.setState('listening');
      return;
    }

    try {
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;

      const locales: Record<SupportedLanguage, string> = {
        en: 'en-US',
        hi: 'hi-IN',
        mr: 'mr-IN',
      };
      this.speechRecognition.lang = locales[this.currentLanguage] || 'en-US';

      this.speechRecognition.onstart = () => {
        this.isListeningForSpeech = true;
        this.setState('listening');
      };

      this.speechRecognition.onresult = (event: any) => {
        // If agent is speaking, user speech acts as interruption
        if (this.state === 'speaking') {
          this.interrupt();
        }

        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        const text = (final || interim).trim();
        if (text) {
          this.pendingUtterance = text;
          this.emitTranscript({
            text,
            isUser: true,
            isFinal: Boolean(final),
            timestamp: Date.now(),
          });
        }

        if (final.trim()) {
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          const toSend = final.trim();
          this.pendingUtterance = '';
          this.sendVoiceUtterance(toSend);
        } else if (interim.trim()) {
          // Send on 1.4s silence pause even if engine hasn't marked isFinal yet
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          this.silenceTimer = setTimeout(() => {
            if (this.pendingUtterance && this.state !== 'speaking' && this.state !== 'thinking') {
              const toSend = this.pendingUtterance;
              this.pendingUtterance = '';
              this.sendVoiceUtterance(toSend);
            }
          }, 1400);
        }
      };

      this.speechRecognition.onerror = (e: any) => {
        if (e.error === 'not-allowed') {
          const errMsg = 'Microphone permission denied by Chrome. Click "Grant Mic" to allow access.';
          this.setState('error');
          this.emitError(errMsg);
          this.ensureMicrophonePermission().catch(() => {});
        } else if (e.error !== 'no-speech') {
          logger.warn('LiveKitVoiceClient', `Speech recognition error: ${e.error}`);
        }
      };

      this.speechRecognition.onend = () => {
        if (this.isListeningForSpeech && this.room && this.room.state === 'connected') {
          try {
            this.speechRecognition.start();
          } catch {
            // Ignore if already starting
          }
        }
      };

      this.speechRecognition.start();
    } catch (err) {
      logger.warn('LiveKitVoiceClient', 'Could not initialize SpeechRecognition', err);
      this.setState('listening');
    }
  }

  private sendVoiceUtterance(text: string): void {
    const normalized = text.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();
    if (this.lastVoiceSubmission.text === normalized && now - this.lastVoiceSubmission.timestamp < 2500) return;
    this.lastVoiceSubmission = { text: normalized, timestamp: now };
    void this.sendAgentMessage(text);
  }

  private stopSpeechCapture(): void {
    this.isListeningForSpeech = false;
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {
        // Ignore
      }
      this.speechRecognition = null;
    }
  }

  private stopAudioPlayback(): void {
    for (const el of this.audioElements) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        // Ignore
      }
    }
    void this.ttsPlayer.stop();
  }

  private async speakReply(text: string): Promise<void> {
    if (!text || typeof window === 'undefined') return;

    this.stopAudioPlayback();
    this.setState('speaking');
    try {
      await this.ttsPlayer.speak(text, this.currentLanguage);
    } finally {
      this.setState('listening');
    }
  }

  private setState(state: LiveKitVoiceState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (err) {
        logger.error('LiveKitVoiceClient', 'Error in state listener', err);
      }
    }
  }

  private emitTranscript(event: LiveKitTranscriptEvent): void {
    for (const listener of this.transcriptListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('LiveKitVoiceClient', 'Error in transcript listener', err);
      }
    }
  }

  private emitActions(actions: BrowserAction[], reply: string, prompt?: string): void {
    for (const listener of this.actionListeners) {
      try {
        listener(actions, reply, prompt);
      } catch (err) {
        logger.error('LiveKitVoiceClient', 'Error in action listener', err);
      }
    }
  }

  private emitError(error: string): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (err) {
        logger.error('LiveKitVoiceClient', 'Error in error listener', err);
      }
    }
  }

  public onStateChange(listener: (state: LiveKitVoiceState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  public onTranscript(listener: (event: LiveKitTranscriptEvent) => void): () => void {
    this.transcriptListeners.push(listener);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter((l) => l !== listener);
    };
  }

  public onActions(listener: (actions: BrowserAction[], reply: string, prompt?: string) => void): () => void {
    this.actionListeners.push(listener);
    return () => {
      this.actionListeners = this.actionListeners.filter((l) => l !== listener);
    };
  }

  public onError(listener: (error: string) => void): () => void {
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    };
  }
}

export const defaultLiveKitVoiceClient = new LiveKitVoiceClient();
