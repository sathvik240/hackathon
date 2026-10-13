// Bystander server: serves the phone app and the dispatcher console, keeps
// each incident's live state, and runs the caller agent that phones the
// dispatcher (through Twilio) or rings the web dispatcher console.
//
//   node server.js                                  web dispatcher console only
//   ANTHROPIC_API_KEY=... node server.js            Claude answers the dispatcher
//   TWILIO_* + PUBLIC_URL + BYSTANDER_DISPATCH_NUMBER   real phone calls (see README)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { briefing, locationLine, updateLine } from './public/js/core/incident.js';
import { createCaller } from './lib/caller.js';
import { SessionStore, newId, safeEqual, summary } from './lib/sessions.js';
import { gatherTwiml, hangUp, hangupTwiml, placeCall, relayTwiml, twilioConfig, validSignature } from './lib/twilio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const MEDIAPIPE_DIR = path.join(here, 'node_modules', '@mediapipe', 'tasks-vision');
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com https://overpass-api.de",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=(self)',
};

export function aiEnabled(env = process.env) {
  if (env.BYSTANDER_AI === '0') return false;
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.BYSTANDER_AI === '1');
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

const sendXml = (res, xml) => send(res, 200, xml, { 'content-type': 'text/xml; charset=utf-8' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw Object.assign(new Error('Could not read the request.'), { status: 400 });
  }
}

// Sliding-window limiter keyed by address (or any string).
function limiter(limit, windowMs = 60_000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, t] of hits) if (!t.some((x) => now - x < windowMs)) hits.delete(k);
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    const ok = recent.length < limit;
    if (ok) recent.push(now);
    hits.set(key, recent);
    return ok;
  };
}

const CALL_STATUS = {
  queued: 'dialing',
  initiated: 'dialing',
  ringing: 'ringing',
  answered: 'connected',
  'in-progress': 'connected',
  completed: 'ended',
  busy: 'failed',
  'no-answer': 'failed',
  failed: 'failed',
  canceled: 'ended',
};
const LIVE = new Set(['dialing', 'ringing', 'connected']);

export function createApp(env = process.env, { caller, fetchImpl = fetch, store = new SessionStore(), log = console } = {}) {
  const demo = env.BYSTANDER_DEMO !== '0';
  const ai = aiEnabled(env);
  const twilio = twilioConfig(env);
  const dispatchKey = env.BYSTANDER_DISPATCH_KEY || newId(9);
  caller ??= createCaller({
    model: env.BYSTANDER_MODEL || 'claude-opus-5-5',
    effort: env.BYSTANDER_EFFORT || 'low',
    demo,
    ai,
    log,
  });
  const allowSession = limiter(Number(env.BYSTANDER_SESSION_LIMIT) || 20);
  const allowAsk = limiter(30);
  const allowPhoneCall = limiter(Number(env.BYSTANDER_CALLS_PER_HOUR) || 12, 60 * 60 * 1000);
  const config = { demo, ai, twilio, dispatchKey, model: caller.model, effort: caller.effort };

  // ---- the call -----------------------------------------------------------

  // A spoken update to the dispatcher. On the web console the transcript line
  // itself is read aloud; on a phone call it waits for the agent to finish
  // its current answer, or for the next turn in gather mode.
  function speak(session, text) {
    if (!text) return;
    store.addLine(session, 'agent', text);
    if (session.call.transport === 'web') return;
    session.pendingUpdates.push(text);
    flushUpdates(session);
  }

  function flushUpdates(session) {
    if (session.call.mode === 'gather' || session.turn || !session.voice) return;
    for (const text of session.pendingUpdates.splice(0)) session.voice(text);
  }

  function relay(session, message) {
    store.addLine(session, 'relay', message);
    store.emit(session, 'relay', { text: message });
  }

  // Everything already reported is in the briefing; only later reports are news.
  function markReportsSeen(session) {
    for (const r of session.incident.reports) session.seenReports.add(r.id);
  }

  const hasLocation = (inc) => Boolean(inc.location.address || inc.location.lat !== null);

  function connect(session, voice) {
    session.voice = voice;
    session.locationSaid = hasLocation(session.incident);
    if (session.call.status !== 'connected') store.setCall(session, { status: 'connected', connectedAt: Date.now() });
    markReportsSeen(session);
    const text = briefing(session.incident, { demo });
    store.addLine(session, 'agent', text);
    return text;
  }

  async function dispatcherTurn(session, question, sink = {}) {
    session.turn?.abort();
    const turn = new AbortController();
    session.turn = turn;
    const history = session.transcript.slice();
    store.addLine(session, 'dispatcher', question);
    const lineId = newId(6);
    const result = await caller.answer({
      incident: session.incident,
      transcript: history,
      question,
      signal: turn.signal,
      onText: (delta) => {
        sink.delta?.(delta);
        store.emit(session, 'agent-delta', { lineId, delta });
      },
      onRelay: (message) => relay(session, message),
    });
    if (session.turn === turn) session.turn = null;
    if (result.text.trim()) store.addLine(session, 'agent', result.text.trim(), lineId);
    sink.done?.(result);
    flushUpdates(session);
    return result;
  }

  async function startCall(session) {
    if (session.incident.mode !== 'emergency') return { status: 400, body: { error: 'Training sessions do not place calls.' } };
    if (LIVE.has(session.call.status)) return { status: 200, body: { call: summary(session).call } };
    session.pendingUpdates = [];
    if (!twilio) {
      store.setCall(session, { status: 'ringing', transport: 'web', startedAt: Date.now(), error: null });
      return { status: 200, body: { call: summary(session).call } };
    }
    if (!twilio.to) {
      store.setCall(session, { status: 'failed', transport: 'twilio', error: twilio.toError });
      return { status: 400, body: { error: twilio.toError } };
    }
    if (!allowPhoneCall('calls')) {
      store.setCall(session, { status: 'failed', transport: 'twilio', error: 'Call limit reached for this hour.' });
      return { status: 429, body: { error: 'Call limit reached for this hour.' } };
    }
    store.setCall(session, {
      status: 'dialing',
      transport: 'twilio',
      mode: twilio.voiceMode,
      to: twilio.toMasked,
      key: newId(18),
      sid: null,
      startedAt: Date.now(),
      error: null,
    });
    try {
      const { sid } = await placeCall(twilio, { sessionId: session.id, callKey: session.call.key }, fetchImpl);
      store.setCall(session, { sid });
    } catch (err) {
      log.error('[bystander] could not place the call:', err.message);
      store.setCall(session, { status: 'failed', error: `Could not place the call: ${err.message}` });
      return { status: 502, body: { error: session.call.error } };
    }
    return { status: 200, body: { call: summary(session).call } };
  }

  async function endCall(session, reason = 'ended') {
    session.turn?.abort();
    if (session.call.transport === 'twilio' && session.call.sid && LIVE.has(session.call.status)) {
      try {
        await hangUp(twilio, session.call.sid, fetchImpl);
      } catch (err) {
        log.error('[bystander] hang-up failed:', err.message);
      }
    }
    session.voice = null;
    if (session.call.status !== 'idle') store.setCall(session, { status: reason, endedAt: Date.now() });
  }

  // New reports, and a location that arrives after the briefing, become
  // spoken updates while the call is live.
  function announceChanges(session) {
    if (session.call.status !== 'connected') return;
    if (!session.locationSaid && hasLocation(session.incident)) {
      session.locationSaid = true;
      speak(session, `Update from the scene: ${locationLine(session.incident)}`);
    }
    for (const r of session.incident.reports) {
      if (session.seenReports.has(r.id)) continue;
      session.seenReports.add(r.id);
      speak(session, updateLine(r));
    }
  }

  // ---- HTTP API -----------------------------------------------------------

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const ip = req.socket.remoteAddress || 'unknown';

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        ai,
        model: ai ? caller.model : null,
        demo,
        caller: twilio ? 'phone' : 'web',
        voiceMode: twilio ? twilio.voiceMode : null,
        dispatchTo: twilio ? twilio.toMasked : null,
        dispatchError: twilio?.toError || null,
        localModel: existsSync(path.join(PUBLIC_DIR, 'models', 'pose_landmarker_lite.task')),
        localMediapipe: existsSync(path.join(MEDIAPIPE_DIR, 'vision_bundle.mjs')),
      });
    }

    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      if (!allowSession(ip)) return send(res, 429, { error: 'Too many sessions. Wait a minute.' });
      const body = await readJson(req);
      const session = store.create(body.incident);
      return send(res, 201, { id: session.id, token: session.token });
    }

    if (parts[1] === 'sessions' && parts[2]) {
      const token = req.headers['x-session-token'] || url.searchParams.get('token');
      const session = store.authorize(parts[2], token);
      if (!session) return send(res, 404, { error: 'Unknown session.' });
      const action = parts[3];
      if (action === 'events' && req.method === 'GET') return store.listen(session, res);
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' }, { allow: 'POST' });
      if (action === 'state') {
        const body = await readJson(req);
        store.update(session, body.incident);
        announceChanges(session);
        return send(res, 200, { ok: true });
      }
      if (action === 'call') {
        const { status, body } = await startCall(session);
        return send(res, status, body);
      }
      if (action === 'hangup') {
        await endCall(session);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found.' });
    }

    if (parts[1] === 'dispatch') {
      const key = req.headers['x-dispatch-key'] || url.searchParams.get('key');
      if (!safeEqual(key, dispatchKey)) return send(res, 403, { error: 'Wrong or missing dispatcher key.' });
      if (parts[2] === 'events' && req.method === 'GET') return store.listenAll(res);
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' }, { allow: 'POST' });
      const body = await readJson(req);
      const session = store.get(body.sessionId);
      if (!session) return send(res, 404, { error: 'Unknown session.' });
      if (parts[2] === 'answer') {
        if (session.call.transport !== 'web' || !LIVE.has(session.call.status)) {
          return send(res, 409, { error: 'There is no web call to answer.' });
        }
        const text = connect(session, null);
        return send(res, 200, { ok: true, briefing: text });
      }
      if (parts[2] === 'ask') {
        if (session.call.transport !== 'web' || session.call.status !== 'connected') {
          return send(res, 409, { error: 'Answer the call first.' });
        }
        if (!allowAsk(ip)) return send(res, 429, { error: 'Slow down a little.' });
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
        if (!text) return send(res, 400, { error: 'Say or type a question.' });
        const result = await dispatcherTurn(session, text);
        return send(res, 200, { text: result.text, relays: result.relays, source: result.source });
      }
      if (parts[2] === 'hangup') {
        if (session.call.transport === 'web') await endCall(session);
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Not found.' });
  }

  // ---- Twilio webhooks ----------------------------------------------------

  async function twilioHook(req, res, url) {
    if (!twilio) return send(res, 404, 'Not found');
    const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (twilio.checkSignatures) {
      const signed = `${twilio.publicUrl}${req.url}`;
      if (!validSignature(twilio.token, signed, params, req.headers['x-twilio-signature'])) {
        log.warn(`[bystander] rejected a Twilio webhook with a bad signature. Is PUBLIC_URL exactly ${twilio.publicUrl}?`);
        return send(res, 403, 'Bad signature');
      }
    }
    const session = store.get(url.searchParams.get('s'));
    if (!session || !session.call.key || !safeEqual(session.call.key, url.searchParams.get('k'))) {
      return send(res, 403, 'Unknown call');
    }
    const q = `s=${encodeURIComponent(session.id)}&k=${encodeURIComponent(session.call.key)}`;
    const gatherUrl = `${twilio.publicUrl}/twilio/gather?${q}`;

    if (url.pathname === '/twilio/status') {
      const status = CALL_STATUS[params.CallStatus];
      if (status && session.call.status !== 'ended') {
        const patch = { status, sid: session.call.sid || params.CallSid };
        if (status === 'failed') patch.error = `The dispatcher’s phone was ${String(params.CallStatus).replace('-', ' ')}.`;
        if (status === 'ended' || status === 'failed') {
          patch.endedAt = Date.now();
          session.voice = null;
        }
        // "connected" comes from the voice webhook, which also briefs the dispatcher.
        if (status !== 'connected' || session.call.status === 'connected') store.setCall(session, patch);
      }
      return send(res, 204, '');
    }

    if (url.pathname === '/twilio/voice') {
      if (session.call.mode === 'gather') {
        const text = connect(session, null);
        return sendXml(res, gatherTwiml({ say: text, actionUrl: gatherUrl, voice: twilio.sayVoice }));
      }
      const text = connect(session, null); // the WebSocket supplies the voice once it opens
      const wsUrl = `${twilio.publicUrl.replace(/^http/, 'ws')}/twilio/relay?${q}`;
      return sendXml(res, relayTwiml({ wsUrl, greeting: text, ttsProvider: twilio.ttsProvider, voice: twilio.ttsVoice }));
    }

    if (url.pathname === '/twilio/gather') {
      if (session.call.status === 'ended') return sendXml(res, hangupTwiml('Goodbye.', twilio.sayVoice));
      const speech = String(params.SpeechResult || '').trim();
      let say = '';
      if (speech) {
        const result = await dispatcherTurn(session, speech);
        say = result.text;
      }
      const updates = session.pendingUpdates.splice(0);
      return sendXml(res, gatherTwiml({ say: [say, ...updates].filter(Boolean).join(' '), actionUrl: gatherUrl, voice: twilio.sayVoice }));
    }
    return send(res, 404, 'Not found');
  }

  // ConversationRelay: Twilio sends the dispatcher's words as text and speaks
  // the text we stream back.
  function onRelaySocket(session, ws) {
    const sendJson = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    session.voice = (text) => sendJson({ type: 'text', token: text, last: true });
    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'setup') {
        store.setCall(session, { status: 'connected', sid: session.call.sid || msg.callSid || null });
        flushUpdates(session);
      } else if (msg.type === 'prompt') {
        if (msg.last === false) return;
        const question = String(msg.voicePrompt || '').trim().slice(0, 1000);
        if (!question) return;
        await dispatcherTurn(session, question, {
          delta: (token) => sendJson({ type: 'text', token, last: false }),
          done: () => sendJson({ type: 'text', token: '', last: true }),
        });
      } else if (msg.type === 'interrupt') {
        session.turn?.abort();
      } else if (msg.type === 'error') {
        log.error('[bystander] ConversationRelay error:', msg.description);
      }
    });
    ws.on('close', () => {
      if (session.voice) session.voice = null;
      session.turn?.abort();
      if (LIVE.has(session.call.status)) store.setCall(session, { status: 'ended', endedAt: Date.now() });
    });
  }

  // ---- static files -------------------------------------------------------

  async function serveStatic(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    let root = PUBLIC_DIR;
    if (rel.startsWith('/vendor/mediapipe/')) {
      root = MEDIAPIPE_DIR;
      rel = rel.slice('/vendor/mediapipe'.length);
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
    try {
      const info = await stat(file);
      if (!info.isFile()) return send(res, 404, 'Not found');
      const body = await readFile(file);
      const immutable = root === MEDIAPIPE_DIR || rel.startsWith('/models/');
      return send(res, 200, body, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=86400' : 'no-cache',
      });
    } catch {
      return send(res, 404, 'Not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/twilio/')) {
        if (req.method !== 'POST') return send(res, 405, 'Use POST', { allow: 'POST' });
        return await twilioHook(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
      return await serveStatic(req, res, url);
    } catch (err) {
      if (err.status) return send(res, err.status, { error: err.message });
      log.error('[bystander] unexpected error:', err);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server.' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const session = url.pathname === '/twilio/relay' ? store.get(url.searchParams.get('s')) : null;
    if (!session || !session.call.key || !safeEqual(session.call.key, url.searchParams.get('k'))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onRelaySocket(session, ws));
  });
  const sweeper = setInterval(() => store.sweep(), 10 * 60 * 1000);
  sweeper.unref();
  server.on('close', () => {
    clearInterval(sweeper);
    wss.close();
  });

  return { server, config, store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const { server, config } = createApp();
  server.listen(port, () => {
    const base = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');
    console.log(`Bystander is running at ${base}`);
    console.log(`Dispatcher console: ${base}/dispatch.html#key=${config.dispatchKey}`);
    console.log(config.ai ? `Caller brain: Claude (${config.model}, effort ${config.effort})` : 'Caller brain: rules only. Set ANTHROPIC_API_KEY for Claude.');
    if (config.twilio) {
      console.log(config.twilio.to
        ? `Caller: phone calls to ${config.twilio.toMasked} (${config.twilio.voiceMode} mode)`
        : `Caller: phone calls are OFF: ${config.twilio.toError}`);
    } else {
      console.log('Caller: rings the web dispatcher console. Set TWILIO_* and PUBLIC_URL for phone calls.');
    }
    if (config.demo) console.log('Demo mode: every call says it is a training demo.');
    if (!existsSync(path.join(PUBLIC_DIR, 'models', 'pose_landmarker_lite.task'))) {
      console.log('Tip: run `npm run fetch-model` so pose tracking works without venue Wi-Fi.');
    }
  });
}

