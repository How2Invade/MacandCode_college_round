import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createServer, rateLimiter } from '../../backend/src';

describe('Secure AI Backend Service (Part D)', () => {
  let server: http.Server;
  const PORT = 4099;
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(async () => {
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

  it('should respond to GET /health with service status', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('handsfree-secure-backend');
  });

  it('should accept valid POST /api/plan and return structured browser actions', async () => {
    const res = await fetch(`${BASE_URL}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Open Google Docs and write essay',
        language: 'en',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.actions)).toBe(true);
    expect(data.actions.length).toBeGreaterThan(0);
    expect(data.actions[0].type).toBe('open_url');
    expect(data.costEstimate).toBeDefined();
  });

  it('should respond in Hindi for POST /api/chat when language is "hi"', async () => {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'नमस्ते',
        language: 'hi',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toContain('हैंड्सफ्री');
  });

  it('should turn a direct research question into validated search-box actions without calling an LLM', async () => {
    rateLimiter.reset();
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Who is the best footballer in the world?', language: 'en' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.actions).toEqual([
      { type: 'open_url', url: 'https://www.google.com' },
      { type: 'type_text', text: 'Who is the best footballer in the world', targetId: 'search' },
    ]);
    expect(data.costEstimate.model).toBe('local-search-intent');
  });

  it('uses a newer search query in place of the previous search task', async () => {
    rateLimiter.reset();
    const first = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Search YouTube for Mr Bean', language: 'en' }),
    });
    await first.json();

    rateLimiter.reset();
    const second = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Search YouTube for Shaun the Sheep', language: 'en', pageContext: { url: 'https://www.youtube.com/results?search_query=Mr+Bean' } }),
    });
    expect(second.status).toBe(200);
    const data = await second.json();
    expect(data.actions).toEqual([{ type: 'type_text', text: 'Shaun the Sheep', targetId: 'search' }]);
    expect(JSON.stringify(data.actions)).not.toContain('Mr Bean');
  });

  it('should reject malformed JSON with 400 status code', async () => {
    const res = await fetch(`${BASE_URL}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not valid json',
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 for unknown endpoints', async () => {
    const res = await fetch(`${BASE_URL}/api/unknown-endpoint`);
    expect(res.status).toBe(404);
  });

  it('should enforce rate limits and respond with 429 when threshold exceeded', async () => {
    rateLimiter.reset();

    // Fire 65 quick requests from test client
    let hit429 = false;
    for (let i = 0; i < 65; i++) {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.status === 429) {
        hit429 = true;
        break;
      }
    }

    expect(hit429).toBe(true);
    rateLimiter.reset(); // Reset for clean state
  });
});
