import http from 'http';
import { AiCompletionRequest, AiCompletionResponse } from './types';

const PORT = parseInt(process.env.BACKEND_PORT || '4000', 10);
const HOST = process.env.BACKEND_HOST || 'localhost';

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    // Enable CORS for local extension testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'handsfree-secure-backend', timestamp: Date.now() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/plan') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        try {
          const payload: AiCompletionRequest = JSON.parse(body || '{}');
          const response: AiCompletionResponse = {
            reply: `Secure backend received goal in [${payload.language}]: "${payload.prompt}"`,
            actions: [
              {
                type: 'scroll',
                params: { direction: 'down', amount: 300 },
                description: 'Scroll viewport downwards',
                riskLevel: 'low',
              },
            ],
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && process.env.AUTO_START !== 'false') {
  const isMainModule = process.argv[1] && (process.argv[1].endsWith('backend/src/index.ts') || process.argv[1].endsWith('backend/src/index.js'));
  if (isMainModule) {
    const server = createServer();
    server.listen(PORT, HOST, () => {
      console.log(`[Handsfree Backend] Secure AI gateway listening on http://${HOST}:${PORT}`);
    });
  }
}
