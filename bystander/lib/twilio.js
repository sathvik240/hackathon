// Twilio, without the SDK: place and end calls over the REST API, check
// webhook signatures, and build the TwiML that connects a call to the agent.
//
// Two voice modes:
//   relay   Twilio ConversationRelay streams the dispatcher's speech to us as
//           text over a WebSocket and speaks our streamed text back. Low
//           latency, and the dispatcher can interrupt.
//   gather  Classic <Say> + <Gather input="speech"> turns. Slower, but works
//           on any Twilio account without extra setup.

import crypto from 'node:crypto';
import { checkDialable, maskNumber } from './phone.js';

export function twilioConfig(env = process.env) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  const publicUrl = (env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!sid || !token || !from || !publicUrl) return null;
  const to = checkDialable(env.BYSTANDER_DISPATCH_NUMBER);
  return {
    sid,
    token,
    from,
    to: to.ok ? to.number : null,
    toError: to.ok ? null : to.reason,
    toMasked: maskNumber(env.BYSTANDER_DISPATCH_NUMBER),
    publicUrl,
    voiceMode: env.BYSTANDER_VOICE_MODE === 'gather' ? 'gather' : 'relay',
    ttsProvider: env.TWILIO_TTS_PROVIDER || '',
    ttsVoice: env.TWILIO_TTS_VOICE || '',
    sayVoice: env.TWILIO_SAY_VOICE || 'Polly.Joanna-Neural',
    checkSignatures: env.TWILIO_SKIP_SIGNATURE !== '1',
  };
}

const API = 'https://api.twilio.com/2010-04-01';

function authHeader(cfg) {
  return `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64')}`;
}

export async function placeCall(cfg, { sessionId, callKey }, fetchImpl = fetch) {
  if (!cfg.to) throw Object.assign(new Error(cfg.toError || 'No dispatcher number'), { code: 'bad_number' });
  const q = `s=${encodeURIComponent(sessionId)}&k=${encodeURIComponent(callKey)}`;
  const form = new URLSearchParams({
    To: cfg.to,
    From: cfg.from,
    Url: `${cfg.publicUrl}/twilio/voice?${q}`,
    Method: 'POST',
    StatusCallback: `${cfg.publicUrl}/twilio/status?${q}`,
    StatusCallbackMethod: 'POST',
    Timeout: '30',
  });
  for (const event of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', event);
  const res = await fetchImpl(`${API}/Accounts/${cfg.sid}/Calls.json`, {
    method: 'POST',
    headers: { authorization: authHeader(cfg), 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.message || `Twilio returned ${res.status}`), { code: 'twilio_error', status: res.status });
  }
  return { sid: body.sid };
}

export async function hangUp(cfg, callSid, fetchImpl = fetch) {
  if (!callSid) return;
  await fetchImpl(`${API}/Accounts/${cfg.sid}/Calls/${encodeURIComponent(callSid)}.json`, {
    method: 'POST',
    headers: { authorization: authHeader(cfg), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'Status=completed',
  });
}

// Twilio signs each webhook: HMAC-SHA1 over the full URL followed by every
// POST parameter (sorted by name) as name+value, keyed with the auth token.
export function signatureFor(authToken, url, params = {}) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validSignature(authToken, url, params, signature) {
  if (!signature) return false;
  const expected = Buffer.from(signatureFor(authToken, url, params));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const attrs = (obj) => Object.entries(obj)
  .filter(([, v]) => v !== '' && v !== null && v !== undefined)
  .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
  .join('');

export function relayTwiml({ wsUrl, greeting, ttsProvider = '', voice = '', language = 'en-US' }) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay${attrs({
    url: wsUrl,
    welcomeGreeting: greeting,
    language,
    ttsProvider,
    voice,
  })}/></Connect></Response>`;
}

export function gatherTwiml({ say, actionUrl, voice, prompt = '' }) {
  const sayXml = (text) => (text ? `<Say${attrs({ voice })}>${escapeXml(text)}</Say>` : '');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayXml(say)}<Gather${attrs({
    input: 'speech',
    action: actionUrl,
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-US',
    actionOnEmptyResult: 'true',
  })}>${sayXml(prompt)}</Gather></Response>`;
}

export function hangupTwiml(say, voice) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say${attrs({ voice })}>${escapeXml(say)}</Say><Hangup/></Response>`;
}
