import http from 'http';
import { AiCompletionRequestSchema } from './types';
import { RateLimiter } from './rateLimiter';
import { processPlanRequest, processChatRequest } from './providers';
import { createLivekitToken, isLivekitConfigured } from './livekit/tokenService';
import { defaultLivekitVoiceAgent } from './livekit/livekitAgent';
import { LivekitTokenRequestSchema, LivekitAgentChatRequestSchema } from './livekit/types';
import { synthesizeSpeech } from './ttsProviders';

// Load backend/.env if available
if (typeof (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile === 'function') {
  try {
    (process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile('backend/.env');
  } catch {
    // Already loaded via node --env-file or file does not exist
  }
}

const PORT = parseInt(process.env.BACKEND_PORT || '4000', 10);
const HOST = process.env.BACKEND_HOST || 'localhost';
const MAX_PAYLOAD_SIZE = 500 * 1024; // 500 KB limit

export const rateLimiter = new RateLimiter(60, 60_000); // 60 requests per minute

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    // 1. CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 2. Rate limiting check across all requests
    let clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    if (clientIp.includes('::1') || clientIp.includes('127.0.0.1')) {
      clientIp = '127.0.0.1';
    }
    const rateCheck = rateLimiter.isAllowed(clientIp);
    if (!rateCheck.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil(rateCheck.resetMs / 1000).toString(),
      });
      res.end(
        JSON.stringify({
          error: 'Rate limit exceeded. Too many requests from this IP.',
          code: 'RATE_LIMIT_EXCEEDED',
          status: 429,
        })
      );
      return;
    }

    // 3. Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'handsfree-secure-backend',
          version: '1.0.0',
          timestamp: Date.now(),
        })
      );
      return;
    }

    // 3b. LiveKit configuration status check
    if (req.method === 'GET' && req.url === '/api/livekit/status') {
      const configured = isLivekitConfigured();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          configured,
          serverUrl: configured ? process.env.LIVEKIT_URL : null,
          timestamp: Date.now(),
        })
      );
      return;
    }

    // 4. API endpoints with payload reading and size check
    const isPostEndpoint =
      req.method === 'POST' &&
      (req.url === '/api/plan' ||
        req.url === '/api/chat' ||
        req.url === '/api/tts' ||
        req.url === '/api/livekit/token' ||
        req.url === '/api/livekit/agent-chat');

    if (isPostEndpoint) {
      let body = '';
      let bodySize = 0;

      req.on('data', (chunk) => {
        bodySize += chunk.length;
        if (bodySize > MAX_PAYLOAD_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Payload Too Large (500KB maximum)',
              code: 'PAYLOAD_TOO_LARGE',
              status: 413,
            })
          );
          req.destroy();
          return;
        }
        body += chunk;
      });

      req.on('end', async () => {
        let raw: unknown;
        try {
          raw = JSON.parse(body || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Malformed JSON payload',
              code: 'VALIDATION_ERROR',
              status: 400,
            })
          );
          return;
        }

        try {
          if (req.url === '/api/tts') {
            const payload = raw as { text?: unknown; language?: unknown };
            const language = payload.language === 'hi' || payload.language === 'mr' || payload.language === 'en'
              ? payload.language
              : null;
            if (typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 2500 || !language) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Provide non-empty text (up to 2500 characters) and language en, hi, or mr.' }));
              return;
            }
            const speech = await synthesizeSpeech(payload.text, language);
            console.info(`[TTS] sarvam synthesis succeeded (${language}).`);
            res.writeHead(200, {
              'Content-Type': speech.contentType,
              'Cache-Control': 'no-store',
              'X-TTS-Provider': 'sarvam',
            });
            res.end(speech.audio);
            return;
          }

          // Route: LiveKit Token Generation
          if (req.url === '/api/livekit/token') {
            const parseResult = LivekitTokenRequestSchema.safeParse(raw);
            if (!parseResult.success) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: 'Invalid LiveKit token request',
                  details: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
                  code: 'VALIDATION_ERROR',
                  status: 400,
                })
              );
              return;
            }
            const tokenResponse = await createLivekitToken(parseResult.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tokenResponse));
            return;
          }

          // Route: LiveKit Real-time Voice Agent Chat
          if (req.url === '/api/livekit/agent-chat') {
            const parseResult = LivekitAgentChatRequestSchema.safeParse(raw);
            if (!parseResult.success) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: 'Invalid LiveKit agent chat request',
                  details: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
                  code: 'VALIDATION_ERROR',
                  status: 400,
                })
              );
              return;
            }
            const agentResponse = await defaultLivekitVoiceAgent.handleSpeechInput(parseResult.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(agentResponse));
            return;
          }

          // Standard Plan / Chat routes
          const parseResult = AiCompletionRequestSchema.safeParse(raw);
          if (!parseResult.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Invalid request payload',
                details: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
                code: 'VALIDATION_ERROR',
                status: 400,
              })
            );
            return;
          }

          const validatedRequest = parseResult.data;

          if (req.url === '/api/plan') {
            const planResponse = await processPlanRequest(validatedRequest);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(planResponse));
          } else {
            const chatResponse = await processChatRequest(validatedRequest);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(chatResponse));
          }
        } catch (err) {
          const rawMessage = (err as Error).message || 'Internal server error';
          const sanitizedMessage = rawMessage.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
          const isProviderError =
            sanitizedMessage.includes('Gemini') ||
            sanitizedMessage.includes('Sarvam') ||
            sanitizedMessage.includes('LiveKit') ||
            sanitizedMessage.includes('credentials') ||
            sanitizedMessage.includes('OpenAI');
          const statusCode = isProviderError ? 502 : 500;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: sanitizedMessage,
              code: isProviderError ? 'AI_PROVIDER_ERROR' : 'INTERNAL_ERROR',
              status: statusCode,
            })
          );
        }
      });
      return;
    }

    // 5. 404 Not Found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        status: 404,
      })
    );
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && process.env.AUTO_START !== 'false') {
  const isMainModule =
    process.argv[1] &&
    (process.argv[1].endsWith('backend/src/index.ts') || process.argv[1].endsWith('backend/src/index.js'));
  if (isMainModule) {
    const server = createServer();
    server.listen(PORT, HOST, () => {
      console.log(`[Handsfree Backend] Secure AI gateway listening on http://${HOST}:${PORT}`);
    });
  }
}
