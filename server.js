// SecondLook server: serves the app and, when an Anthropic API key is set,
// gives a Claude-powered second opinion at POST /api/analyze.
// The API key stays on the server; the browser never sees it.
//
//   node server.js                         on-device checks only
//   ANTHROPIC_API_KEY=sk-... node server.js   adds the AI second opinion

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, normalizeAiResult } from './public/js/ai/prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const MODEL = process.env.SECONDLOOK_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.SECONDLOOK_EFFORT || 'medium';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function aiEnabled(env = process.env) {
  if (env.SECONDLOOK_AI === '0') return false;
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.SECONDLOOK_AI === '1');
}

let clientPromise = null;
async function getClient() {
  clientPromise ??= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => ({ Anthropic, client: new Anthropic() }));
  return clientPromise;
}

// A few requests per minute per address keeps a public demo from running up a bill.
const buckets = new Map();
function allow(ip, limit, windowMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [key, times] of buckets) if (!times.some((t) => now - t < windowMs)) buckets.delete(key);
  }
  const recent = (buckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  buckets.set(ip, recent);
  return true;
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isJson ? 'application/json; charset=utf-8' : headers['content-type'] || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Message too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function askClaude({ text, language, localSummary, image }) {
  const { Anthropic, client } = await getClient();
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text: buildUserPrompt({ text, language, localSummary, hasImage: Boolean(image) }) });

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: AI_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      return { status: 422, body: { code: 'refused', error: 'Claude could not check this message. The on-device verdict still applies.' } };
    }
    const block = response.content.find((b) => b.type === 'text');
    if (!block) return { status: 502, body: { code: 'upstream_error', error: 'The AI returned an empty answer. Try again.' } };
    let parsed;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return { status: 502, body: { code: 'invalid_json', error: 'The answer came back garbled. Try again.' } };
    }
    return { status: 200, body: { result: normalizeAiResult(parsed), model: response.model } };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { status: 503, body: { code: 'not_configured', error: 'The server’s Anthropic API key was rejected. Check ANTHROPIC_API_KEY.' } };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, body: { code: 'rate_limited', error: 'The AI is busy right now. Wait a minute, then try again.' } };
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error('[secondlook] bad request to Claude:', err.message);
      return { status: 400, body: { code: 'invalid_request', error: 'Claude could not read that input. Try pasting just the text.' } };
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[secondlook] Claude API error:', err.status, err.message);
      return { status: 502, body: { code: 'upstream_error', error: 'The AI service had a problem. Try again in a moment.' } };
    }
    console.error('[secondlook] could not reach Claude:', err);
    return { status: 502, body: { code: 'upstream_error', error: 'Could not reach the AI service. Check the server’s internet connection.' } };
  }
}

async function handleAnalyze(req, res, env, ask) {
  if (!aiEnabled(env)) {
    return send(res, 503, { code: 'not_configured', error: 'The AI second opinion is off. Start the server with ANTHROPIC_API_KEY to turn it on.' });
  }
  if (!allow(req.socket.remoteAddress || 'unknown', Number(env.SECONDLOOK_RATE_LIMIT) || 8)) {
    return send(res, 429, { code: 'rate_limited', error: 'Too many checks from this device. Wait a minute, then try again.' });
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return send(res, err.status || 400, { code: 'invalid_request', error: err.status === 413 ? 'That is too large. Try a smaller screenshot.' : 'Could not read the request.' });
  }
  const text = typeof payload.text === 'string' ? payload.text.slice(0, 12000) : '';
  const language = typeof payload.language === 'string' ? payload.language.slice(0, 40) : 'English';
  const localSummary = typeof payload.localSummary === 'string' ? payload.localSummary.slice(0, 2000) : '';
  let image = null;
  if (payload.image) {
    const { mediaType, data } = payload.image;
    if (!IMAGE_TYPES.has(mediaType) || typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      return send(res, 400, { code: 'image_rejected', error: 'That image could not be read. Try a PNG or JPG screenshot.' });
    }
    image = { mediaType, data };
  }
  if (!text.trim() && !image) return send(res, 400, { code: 'invalid_request', error: 'Paste a message or add a screenshot first.' });

  const { status, body } = await ask({ text, language, localSummary, image });
  return send(res, status, body);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (!info.isFile()) return send(res, 404, 'Not found');
    const body = await readFile(file);
    return send(res, 200, body, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
  } catch {
    return send(res, 404, 'Not found');
  }
}

// `ask` can be swapped out in tests so they never call the real API.
export function createServer(env = process.env, { ask = askClaude } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, ai: aiEnabled(env), model: aiEnabled(env) ? MODEL : null });
      }
      if (pathname === '/api/analyze') {
        if (req.method !== 'POST') return send(res, 405, { code: 'invalid_request', error: 'Use POST.' }, { allow: 'POST' });
        return await handleAnalyze(req, res, env, ask);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
      return await serveStatic(req, res);
    } catch (err) {
      console.error('[secondlook] unexpected error:', err);
      if (!res.headersSent) send(res, 500, { code: 'upstream_error', error: 'Something went wrong on the server.' });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`SecondLook is running at http://localhost:${port}`);
    console.log(aiEnabled()
      ? `AI second opinion: on (${MODEL}, effort ${EFFORT})`
      : 'AI second opinion: off. Set ANTHROPIC_API_KEY to turn it on.');
  });
}
