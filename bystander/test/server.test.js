import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { createApp } from '../server.js';
import { createCaller } from '../lib/caller.js';
import { signatureFor } from '../lib/twilio.js';

const quiet = { log() {}, warn() {}, error() {} };

function start(env, options = {}) {
  const app = createApp(env, { caller: createCaller({ ai: false, log: quiet }), log: quiet, ...options });
  return new Promise((resolve) => app.server.listen(0, '127.0.0.1', () => resolve(app)));
}

const base = (app) => `http://127.0.0.1:${app.server.address().port}`;

const incident = (extra = {}) => ({
  mode: 'emergency',
  scenario: 'cardiac_arrest',
  elapsedS: 30,
  location: { address: '475 Via Ortega, Stanford', lat: 37.4275, lon: -122.1697, accuracyM: 10 },
  cpr: { active: true, measuring: true, startedAtS: 5, compressions: 44, rate: 110, sinceLastS: 0.3 },
  reports: [{ id: 'r1', atS: 0, code: 'not_breathing', text: '' }],
  ...extra,
});

async function json(res) {
  return { status: res.status, body: await res.json() };
}

function post(app, path, body, headers = {}) {
  return fetch(`${base(app)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// Minimal Server-Sent Events reader for tests.
function listen(url) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  const check = () => {
    for (const w of [...waiters]) {
      const hit = events.find((e) => e.type === w.type && w.pred(e.data));
      if (hit) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(hit.data);
      }
    }
  };
  const ready = fetch(url, { signal: controller.signal }).then(async (res) => {
    if (!res.ok) return res.status;
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (type && data) events.push({ type, data: JSON.parse(data) });
          }
          check();
        }
      } catch {
        // Aborted.
      }
    })();
    return res.status;
  });
  return {
    ready,
    events,
    next(type, pred = () => true) {
      return new Promise((resolve, reject) => {
        waiters.push({ type, pred, resolve });
        check();
        setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000).unref();
      });
    },
    close: () => controller.abort(),
  };
}

describe('server basics', () => {
  let app;
  before(async () => { app = await start({ BYSTANDER_DISPATCH_KEY: 'k' }); });
  after(() => app.server.close());

  it('serves the app with camera allowed and a strict policy', async () => {
    const res = await fetch(`${base(app)}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Bystander<\/title>/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /'wasm-unsafe-eval'/);
    assert.match(res.headers.get('permissions-policy'), /camera=\(self\)/);
  });

  it('serves MediaPipe from node_modules so it works offline', async () => {
    const js = await fetch(`${base(app)}/vendor/mediapipe/vision_bundle.mjs`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    const wasm = await fetch(`${base(app)}/vendor/mediapipe/wasm/vision_wasm_internal.wasm`, { method: 'HEAD' });
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  });

  it('refuses paths outside the served folders', async () => {
    for (const p of ['/..%2fserver.js', '/vendor/mediapipe/..%2f..%2f..%2fserver.js']) {
      const res = await fetch(`${base(app)}${p}`);
      assert.ok([403, 404].includes(res.status), p);
    }
  });

  it('reports the caller set-up', async () => {
    const { body } = await json(await fetch(`${base(app)}/api/health`));
    assert.equal(body.caller, 'web');
    assert.equal(body.ai, false);
    assert.equal(body.localMediapipe, true);
  });

  it('protects sessions with a token', async () => {
    const { status, body } = await json(await post(app, '/api/sessions', { incident: incident() }));
    assert.equal(status, 201);
    assert.ok(body.id && body.token);
    const bad = await post(app, `/api/sessions/${body.id}/state`, { incident: incident() }, { 'x-session-token': 'nope' });
    assert.equal(bad.status, 404);
    const ok = await post(app, `/api/sessions/${body.id}/state`, { incident: incident() }, { 'x-session-token': body.token });
    assert.equal(ok.status, 200);
  });

  it('never places a call from a training session', async () => {
    const { body } = await json(await post(app, '/api/sessions', { incident: incident({ mode: 'train' }) }));
    const res = await post(app, `/api/sessions/${body.id}/call`, {}, { 'x-session-token': body.token });
    assert.equal(res.status, 400);
  });

  it('requires the dispatcher key', async () => {
    const res = await fetch(`${base(app)}/api/dispatch/events?key=wrong`);
    assert.equal(res.status, 403);
  });
});

describe('a call through the web dispatcher console', () => {
  let app;
  before(async () => { app = await start({ BYSTANDER_DISPATCH_KEY: 'console-key' }); });
  after(() => app.server.close());

  it('rings, briefs, answers questions, relays, and announces updates', async () => {
    const dispatch = listen(`${base(app)}/api/dispatch/events?key=console-key`);
    assert.equal(await dispatch.ready, 200);
    const { body: s } = await json(await post(app, '/api/sessions', { incident: incident() }));
    const auth = { 'x-session-token': s.token };
    const phone = listen(`${base(app)}/api/sessions/${s.id}/events?token=${s.token}`);
    assert.equal(await phone.ready, 200);

    const { body: started } = await json(await post(app, `/api/sessions/${s.id}/call`, {}, auth));
    assert.deepEqual([started.call.status, started.call.transport], ['ringing', 'web']);
    await dispatch.next('call', (d) => d.sessionId === s.id && d.call.status === 'ringing');

    const key = { 'x-dispatch-key': 'console-key' };
    const answered = await json(await post(app, '/api/dispatch/answer', { sessionId: s.id }, key));
    assert.equal(answered.status, 200);
    assert.match(answered.body.briefing, /475 Via Ortega/);
    await phone.next('call', (d) => d.call.status === 'connected');

    const reply = await json(await post(app, '/api/dispatch/ask', { sessionId: s.id, text: 'How many compressions so far?' }, key));
    assert.match(reply.body.text, /44 compressions/);
    await dispatch.next('agent-delta', (d) => /44 compressions/.test(d.delta));

    await post(app, '/api/dispatch/ask', { sessionId: s.id, text: 'Tell them help is two minutes away' }, key);
    const relay = await phone.next('relay');
    assert.equal(relay.text, 'Help is two minutes away.');

    const reports = [...incident().reports, { id: 'r2', atS: 40, code: 'aed_here', text: '' }];
    await post(app, `/api/sessions/${s.id}/state`, { incident: incident({ reports }) }, auth);
    const update = await dispatch.next('line', (d) => d.who === 'agent' && /AED has arrived/.test(d.text));
    assert.equal(update.text, 'Update from the scene: An AED has arrived.');

    await post(app, `/api/sessions/${s.id}/hangup`, {}, auth);
    await phone.next('call', (d) => d.call.status === 'ended');
    dispatch.close();
    phone.close();
  });
});

describe('a location that arrives after the briefing', () => {
  let app;
  before(async () => { app = await start({ BYSTANDER_DISPATCH_KEY: 'k2' }); });
  after(() => app.server.close());

  it('is announced to the dispatcher once', async () => {
    const dispatch = listen(`${base(app)}/api/dispatch/events?key=k2`);
    await dispatch.ready;
    const { body: s } = await json(await post(app, '/api/sessions', { incident: incident({ location: {} }) }));
    const auth = { 'x-session-token': s.token };
    await post(app, `/api/sessions/${s.id}/call`, {}, auth);
    const { body } = await json(await post(app, '/api/dispatch/answer', { sessionId: s.id }, { 'x-dispatch-key': 'k2' }));
    assert.match(body.briefing, /do not have the address/);
    await post(app, `/api/sessions/${s.id}/state`, { incident: incident() }, auth);
    await post(app, `/api/sessions/${s.id}/state`, { incident: incident() }, auth);
    const line = await dispatch.next('line', (d) => /Update from the scene: The location is 475 Via Ortega/.test(d.text));
    assert.match(line.text, /GPS 37\.42750 north/);
    assert.equal(dispatch.events.filter((e) => e.type === 'line' && /location is/.test(e.data.text)).length, 1);
    dispatch.close();
  });
});

describe('a call over the phone through Twilio', () => {
  const PUBLIC_URL = 'https://bystander.example.org';
  const env = {
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'twilio-secret',
    TWILIO_FROM_NUMBER: '+15005550006',
    BYSTANDER_DISPATCH_NUMBER: '+1 415 555 0123',
    PUBLIC_URL,
  };
  const twilioCalls = [];
  const fakeFetch = async (url, init) => {
    twilioCalls.push({ url, init });
    return new Response(JSON.stringify({ sid: 'CA42' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  let app;
  before(async () => { app = await start(env, { fetchImpl: fakeFetch }); });
  after(() => app.server.close());

  // Posts a webhook the way Twilio would, signed with the auth token.
  function webhook(pathAndQuery, params, { sign = true } = {}) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (sign) headers['x-twilio-signature'] = signatureFor(env.TWILIO_AUTH_TOKEN, `${PUBLIC_URL}${pathAndQuery}`, params);
    return fetch(`${base(app)}${pathAndQuery}`, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
  }

  it('dials only the configured number and briefs over ConversationRelay', async () => {
    const { body: s } = await json(await post(app, '/api/sessions', { incident: incident() }));
    const auth = { 'x-session-token': s.token };
    const { body: started } = await json(await post(app, `/api/sessions/${s.id}/call`, {}, auth));
    assert.equal(started.call.transport, 'twilio');
    assert.equal(started.call.key, undefined, 'the call key never leaves the server');

    const sent = new URLSearchParams(twilioCalls[0].init.body);
    assert.equal(twilioCalls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json');
    assert.equal(sent.get('To'), '+14155550123');
    assert.equal(sent.get('From'), '+15005550006');
    assert.match(twilioCalls[0].init.headers.authorization, /^Basic /);
    const voiceUrl = new URL(sent.get('Url'));
    const pathAndQuery = `${voiceUrl.pathname}${voiceUrl.search}`;

    const forged = await webhook(pathAndQuery, { CallSid: 'CA42' }, { sign: false });
    assert.equal(forged.status, 403);

    const res = await webhook(pathAndQuery, { CallSid: 'CA42', CallStatus: 'in-progress' });
    const twiml = await res.text();
    assert.match(res.headers.get('content-type'), /xml/);
    assert.match(twiml, /<Connect><ConversationRelay url="wss:\/\/bystander\.example\.org\/twilio\/relay\?s=[^"]+&amp;k=[^"]+"/);
    assert.match(twiml, /welcomeGreeting="This is a training demo call/);
    assert.match(twiml, /475 Via Ortega/);

    // Twilio connects to our WebSocket and streams the dispatcher's words as text.
    const wsUrl = twiml.match(/url="([^"]+)"/)[1].replace(/&amp;/g, '&').replace(PUBLIC_URL.replace('https', 'wss'), base(app).replace('http', 'ws'));
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    const received = [];
    const answered = new Promise((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        received.push(msg);
        if (msg.type === 'text' && msg.last) resolve();
      });
    });
    ws.send(JSON.stringify({ type: 'setup', callSid: 'CA42' }));
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'What is the address?', last: true }));
    await answered;
    const spoken = received.filter((m) => m.type === 'text').map((m) => m.token).join('');
    assert.match(spoken, /475 Via Ortega/);

    // A new report is spoken to the dispatcher without being asked.
    const reports = [...incident().reports, { id: 'r9', atS: 50, code: 'breathing', text: '' }];
    const update = new Promise((resolve) => ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (/breathing now/.test(msg.token || '')) resolve(msg);
    }));
    await post(app, `/api/sessions/${s.id}/state`, { incident: incident({ reports }) }, auth);
    assert.equal((await update).last, true);

    const done = await webhook(`/twilio/status${voiceUrl.search}`, { CallSid: 'CA42', CallStatus: 'completed' });
    assert.equal(done.status, 204);
    assert.equal(app.store.get(s.id).call.status, 'ended');
    ws.close();
  });

  it('refuses a WebSocket without the call key', async () => {
    const ws = new WebSocket(`${base(app).replace('http', 'ws')}/twilio/relay?s=nope&k=nope`);
    const code = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve('error'));
    });
    assert.equal(code, 403);
  });
});

describe('Twilio fallbacks and safety', () => {
  it('uses <Gather> turns in gather mode', async () => {
    const PUBLIC_URL = 'https://g.example.org';
    const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15005550006', BYSTANDER_DISPATCH_NUMBER: '+14155550123', PUBLIC_URL, BYSTANDER_VOICE_MODE: 'gather' };
    let placed;
    const app = await start(env, { fetchImpl: async (url, init) => { placed = new URLSearchParams(init.body); return Response.json({ sid: 'CA1' }); } });
    try {
      const { body: s } = await json(await post(app, '/api/sessions', { incident: incident() }));
      await post(app, `/api/sessions/${s.id}/call`, {}, { 'x-session-token': s.token });
      const voice = new URL(placed.get('Url'));
      const sign = (p, params) => signatureFor('t', `${PUBLIC_URL}${p}`, params);
      const first = await (await fetch(`${base(app)}${voice.pathname}${voice.search}`, {
        method: 'POST',
        headers: { 'x-twilio-signature': sign(`${voice.pathname}${voice.search}`, {}) },
      })).text();
      assert.match(first, /<Say voice="Polly\.Joanna-Neural">This is a training demo call/);
      assert.match(first, /<Gather input="speech" action="https:\/\/g\.example\.org\/twilio\/gather/);
      const gatherPath = `/twilio/gather${voice.search}`;
      const params = { SpeechResult: 'Is the patient breathing?' };
      const turn = await (await fetch(`${base(app)}${gatherPath}`, {
        method: 'POST',
        headers: { 'x-twilio-signature': sign(gatherPath, params), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      })).text();
      assert.match(turn, /not breathing normally/);
    } finally {
      app.server.close();
    }
  });

  it('refuses to call an emergency number even if configured', async () => {
    const app = await start({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15005550006', BYSTANDER_DISPATCH_NUMBER: '911', PUBLIC_URL: 'https://x.example' }, {
      fetchImpl: async () => { throw new Error('must not dial'); },
    });
    try {
      const { body: h } = await json(await fetch(`${base(app)}/api/health`));
      assert.match(h.dispatchError, /never calls emergency numbers/);
      const { body: s } = await json(await post(app, '/api/sessions', { incident: incident() }));
      const res = await post(app, `/api/sessions/${s.id}/call`, {}, { 'x-session-token': s.token });
      assert.equal(res.status, 400);
    } finally {
      app.server.close();
    }
  });
});
