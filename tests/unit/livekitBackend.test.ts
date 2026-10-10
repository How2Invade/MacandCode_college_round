// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createServer, rateLimiter } from '../../backend/src';
import { createLivekitToken, isLivekitConfigured } from '../../backend/src/livekit/tokenService';

describe('LiveKit Conversational AI Integration', () => {
  let server: http.Server;
  const PORT = 4098;
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(async () => {
    // Provide test credentials if not present in test environment
    process.env.LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://demo-test.livekit.cloud';
    process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'API_test_key_12345';
    process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret_test_key_12345678901234567890';

    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(PORT, 'localhost', resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should verify LiveKit configuration via isLivekitConfigured', () => {
    expect(isLivekitConfigured()).toBe(true);
  });

  it('should generate a valid JWT token via createLivekitToken', async () => {
    const res = await createLivekitToken({
      identity: 'test_user_unit',
      roomName: 'test-room',
      language: 'en',
    });

    expect(res).toBeDefined();
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(50);
    expect(res.serverUrl).toBe(process.env.LIVEKIT_URL);
    expect(res.roomName).toBe('test-room');
    expect(res.identity).toBe('test_user_unit');
  });

  it('should respond to GET /api/livekit/status with configuration details', async () => {
    rateLimiter.reset();
    const res = await fetch(`${BASE_URL}/api/livekit/status`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.configured).toBe(true);
    expect(data.serverUrl).toBeDefined();
  });

  it('should respond to POST /api/livekit/token with a signed access token', async () => {
    rateLimiter.reset();
    const res = await fetch(`${BASE_URL}/api/livekit/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: 'client_user_1',
        roomName: 'voice-room-1',
        language: 'hi',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe('string');
    expect(data.roomName).toBe('voice-room-1');
  });

  it('should reject invalid POST /api/livekit/token payload with 400', async () => {
    rateLimiter.reset();
    const res = await fetch(`${BASE_URL}/api/livekit/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'invalid_lang_code',
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('should process speech prompt in POST /api/livekit/agent-chat and return conversational reply', async () => {
    rateLimiter.reset();
    const res = await fetch(`${BASE_URL}/api/livekit/agent-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'plan my trip to Tokyo',
        language: 'en',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBeDefined();
    expect(Array.isArray(data.actions)).toBe(true);
    expect(data.language).toBe('en');
  });
});
