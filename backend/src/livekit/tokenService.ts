/**
 * LiveKit Secure Token Service
 * Generates signed JWT access tokens for connecting to LiveKit Cloud / self-hosted servers.
 * Keeps API secrets strictly isolated on the backend.
 */

import { AccessToken } from 'livekit-server-sdk';
import { LivekitTokenRequest, LivekitTokenResponse } from './types';

export function getLivekitConfig(): { url: string; apiKey: string; apiSecret: string } {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!url || !apiKey || !apiSecret) {
    const missing: string[] = [];
    if (!url) missing.push('LIVEKIT_URL');
    if (!apiKey) missing.push('LIVEKIT_API_KEY');
    if (!apiSecret) missing.push('LIVEKIT_API_SECRET');

    throw new Error(
      `LiveKit credentials missing: [${missing.join(', ')}] not set in backend/.env. Please configure them to connect real-time voice.`
    );
  }

  return { url, apiKey, apiSecret };
}

export function isLivekitConfigured(): boolean {
  try {
    getLivekitConfig();
    return true;
  } catch {
    return false;
  }
}

export async function createLivekitToken(
  request: LivekitTokenRequest
): Promise<LivekitTokenResponse> {
  const { url, apiKey, apiSecret } = getLivekitConfig();

  const identity = request.identity || `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const roomName = request.roomName || 'handsfree-voice-room';
  const name = request.name || 'Handsfree User';

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: '2h',
    metadata: JSON.stringify({
      language: request.language || 'en',
      client: 'handsfree-chrome-extension',
      timestamp: Date.now(),
    }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return {
    token,
    serverUrl: url,
    roomName,
    identity,
  };
}
