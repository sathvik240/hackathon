// Dispatcher console: the "phone" that rings when Bystander calls for help
// without a phone line, and a live mirror of real phone calls. It speaks the
// AI caller's lines aloud and sends the dispatcher's questions back.

import { clock } from './core/incident.js';
import { REPORTS, scenarioOf } from './core/scenarios.js';
import { mapLink } from './core/places.js';
import { Voice } from './ui/voice.js';

const $ = (id) => document.getElementById(id);
const voice = new Voice();
voice.enabled = false; // until the dispatcher goes on duty

const QUICK = [
  'What’s the address?',
  'Is the patient breathing?',
  'How long has CPR been going?',
  'What’s the compression rate?',
  'Is there an AED?',
  'Tell them help is four minutes away. Keep pushing.',
  'Ask them if the patient is breathing now.',
];

let key = '';
let onDuty = false;
let source = null;
const sessions = new Map(); // id -> { incident, call, lines, localAt }
let focusId = null;
const streams = new Map(); // lineId -> { text, spoken }

// ---- key ------------------------------------------------------------------

function readKey() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const fromHash = hash.get('key');
  if (fromHash) {
    try {
      sessionStorage.setItem('bystander.dispatchKey', fromHash);
    } catch {
      // Keep it in memory only.
    }
    history.replaceState(null, '', location.pathname);
    return fromHash;
  }
  try {
    return sessionStorage.getItem('bystander.dispatchKey') || '';
  } catch {
    return '';
  }
}

function start() {
  key = readKey();
  if (!key) {
    $('key-form').hidden = false;
    return;
  }
  $('key-form').hidden = true;
  $('duty').hidden = false;
  $('console').hidden = false;
  connect();
}

$('key-save').addEventListener('click', () => {
  const value = $('key-input').value.trim();
  if (!value) return;
  location.hash = `key=${encodeURIComponent(value)}`;
  start();
});

// ---- events from the server ---------------------------------------------------

function connect() {
  source?.close();
  source = new EventSource(`/api/dispatch/events?key=${encodeURIComponent(key)}`);
  source.onopen = () => setConn('Live', 'ok');
  source.onerror = () => setConn('Reconnecting…', 'warn');
  const on = (type, fn) => source.addEventListener(type, (e) => fn(JSON.parse(e.data)));
  on('hello', ({ sessions: list }) => {
    for (const s of list) {
      sessions.set(s.sessionId, { incident: s.incident, call: s.call, lines: s.transcript, localAt: Date.now() });
    }
    const live = list.find((s) => ['ringing', 'dialing', 'connected'].includes(s.call.status));
    if (live) focus(live.sessionId);
    render();
  });
  on('call', ({ sessionId, call, incident }) => {
    const s = entry(sessionId);
    s.call = call;
    if (incident) {
      s.incident = incident;
      s.localAt = Date.now();
    }
    if (['ringing', 'dialing', 'connected'].includes(call.status)) focus(sessionId);
    render();
  });
  on('state', ({ sessionId, incident }) => {
    const s = entry(sessionId);
    s.incident = incident;
    s.localAt = Date.now();
    if (sessionId === focusId) renderIncident();
  });
  on('line', ({ sessionId, ...line }) => {
    const s = entry(sessionId);
    s.lines.push(line);
    if (sessionId !== focusId) return;
    renderTranscript();
    if (line.who === 'agent' && s.call.transport === 'web') speakLine(line);
  });
  on('agent-delta', ({ sessionId, lineId, delta }) => {
    if (sessionId !== focusId) return;
    const st = streams.get(lineId) || { text: '', spoken: 0 };
    st.text += delta;
    streams.set(lineId, st);
    renderLive(lineId, st.text);
    if (sessions.get(sessionId)?.call.transport === 'web') speakSentences(st, false);
  });
}

function entry(id) {
  if (!sessions.has(id)) sessions.set(id, { incident: null, call: { status: 'idle' }, lines: [], localAt: Date.now() });
  return sessions.get(id);
}

function focus(id) {
  if (focusId === id) return;
  focusId = id;
  streams.clear();
  renderTranscript();
}

function setConn(text, tone) {
  $('conn').textContent = text;
  $('conn').dataset.tone = tone;
}

// ---- speech -----------------------------------------------------------------------

// Speak finished sentences while the answer is still streaming.
function speakSentences(st, final) {
  const rest = st.text.slice(st.spoken);
  let cut = final ? rest.length : 0;
  if (!final) {
    const re = /[.!?]["”’)]*\s/g;
    let m;
    while ((m = re.exec(rest))) cut = m.index + m[0].length;
  }
  if (!cut) return;
  const chunk = rest.slice(0, cut).trim();
  st.spoken += cut;
  if (chunk && onDuty) voice.say(chunk, { interrupt: false, rate: 1.0 });
}

function speakLine(line) {
  const st = streams.get(line.id);
  if (st) {
    st.text = line.text.length >= st.text.length ? line.text : st.text;
    speakSentences(st, true);
    streams.delete(line.id);
  } else if (onDuty) {
    voice.say(line.text, { interrupt: false, rate: 1.0 });
  }
}

// A two-tone phone ring, synthesized.
const ringer = {
  ctx: null,
  timer: null,
  start() {
    if (this.timer || !onDuty) return;
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    const burst = () => {
      const t = this.ctx.currentTime;
      for (const offset of [0, 0.5]) {
        for (const freq of [440, 480]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t + offset);
          gain.gain.exponentialRampToValueAtTime(0.15, t + offset + 0.02);
          gain.gain.setValueAtTime(0.15, t + offset + 0.38);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.42);
          osc.connect(gain).connect(this.ctx.destination);
          osc.start(t + offset);
          osc.stop(t + offset + 0.45);
        }
      }
    };
    burst();
    this.timer = setInterval(burst, 2500);
  },
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  },
};

$('duty-btn').addEventListener('click', () => {
  onDuty = true;
  voice.enabled = true;
  voice.unlock();
  ringer.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  ringer.ctx.resume();
  $('duty').hidden = true;
  render();
});

// ---- actions ------------------------------------------------------------------------

async function post(path, body) {
  const res = await fetch(`/api/dispatch/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dispatch-key': key },
    body: JSON.stringify({ sessionId: focusId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

$('answer-btn').addEventListener('click', async () => {
  ringer.stop();
  try {
    await post('answer');
  } catch (err) {
    $('call-text').textContent = err.message;
  }
});

$('decline-btn').addEventListener('click', async () => {
  ringer.stop();
  await post('hangup').catch(() => {});
});

$('hangup-btn').addEventListener('click', async () => {
  voice.stop();
  await post('hangup').catch(() => {});
});

async function ask(text) {
  const q = text.trim();
  if (!q || !focusId) return;
  voice.stop();
  $('ask-input').value = '';
  $('ask-btn').disabled = true;
  try {
    await post('ask', { text: q });
  } catch (err) {
    $('call-text').textContent = err.message;
  } finally {
    $('ask-btn').disabled = false;
  }
}

$('ask-btn').addEventListener('click', () => ask($('ask-input').value));
$('ask-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ask($('ask-input').value);
});
for (const text of QUICK) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', () => ask(text));
  $('chips').append(b);
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) $('mic-btn').hidden = true;
$('mic-btn').addEventListener('click', () => {
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = false;
  voice.stop();
  $('mic-btn').classList.add('listening');
  rec.onresult = (e) => ask(e.results[0]?.[0]?.transcript || '');
  rec.onend = () => $('mic-btn').classList.remove('listening');
  rec.start();
});

// ---- rendering -------------------------------------------------------------------------

const CALL_TEXT = {
  idle: 'Waiting for a call…',
  dialing: 'The AI caller is dialing…',
  ringing: 'Ringing',
  connected: 'Connected to the Bystander AI caller',
  ended: 'Call ended',
  failed: 'Call failed',
};

function render() {
  const s = sessions.get(focusId);
  const call = s?.call || { status: 'idle' };
  const web = call.transport === 'web';
  const ringing = web && call.status === 'ringing';
  $('incoming').hidden = !ringing;
  if (ringing) ringer.start();
  else ringer.stop();
  $('console-dot').dataset.status = call.status;
  $('call-text').textContent = call.status === 'failed' && call.error ? `Call failed: ${call.error}` : CALL_TEXT[call.status] || call.status;
  $('monitor').hidden = !(call.transport === 'twilio' && call.status !== 'idle');
  $('hangup-btn').hidden = !(web && call.status === 'connected');
  const canAsk = web && call.status === 'connected';
  $('ask').classList.toggle('disabled', !canAsk);
  for (const el of $('ask').querySelectorAll('button, input')) el.disabled = !canAsk;
  renderIncident();
}

function renderTranscript() {
  const list = $('transcript');
  list.replaceChildren();
  const s = sessions.get(focusId);
  for (const line of s?.lines.slice(-60) || []) list.append(lineItem(line.who, line.text, line.id));
  list.scrollTop = list.scrollHeight;
}

function lineItem(who, text, id) {
  const li = document.createElement('li');
  li.className = `line ${who}`;
  if (id) li.dataset.id = id;
  const label = document.createElement('small');
  label.textContent = { agent: 'AI caller', dispatcher: 'You (dispatcher)', relay: 'Passed to the bystander' }[who] || who;
  const p = document.createElement('p');
  p.textContent = text;
  li.append(label, p);
  return li;
}

function renderLive(lineId, text) {
  const list = $('transcript');
  let li = list.querySelector(`[data-id="${CSS.escape(lineId)}"]`);
  if (!li) {
    li = lineItem('agent', '', lineId);
    li.classList.add('live');
    list.append(li);
  }
  li.querySelector('p').textContent = text;
  list.scrollTop = list.scrollHeight;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderIncident() {
  const box = $('incident');
  const s = sessions.get(focusId);
  if (!s?.incident) {
    box.replaceChildren(el('p', 'fine', 'No active incident.'));
    return;
  }
  const inc = s.incident;
  const drift = (Date.now() - s.localAt) / 1000;
  const scenario = scenarioOf(inc.scenario);
  const parts = [];

  const head = el('div', 'inc-head');
  head.append(el('span', 'pill danger', scenario.title), el('span', 'clock', clock(inc.elapsedS + drift)));
  parts.push(head, el('p', 'situation', scenario.situation));

  const cpr = inc.cpr;
  if (cpr.startedAtS !== null) {
    const gauge = el('div', 'cpr-live');
    const paused = cpr.sinceLastS !== null && cpr.sinceLastS + drift > 3;
    const rate = el('div', 'big-rate', paused || !cpr.rate ? '--' : String(cpr.rate));
    rate.dataset.zone = paused || !cpr.rate ? '' : cpr.rate < 100 ? 'slow' : cpr.rate > 120 ? 'fast' : 'good';
    const facts = el('div', 'cpr-facts');
    facts.append(
      el('span', '', `${cpr.compressions} compressions`),
      el('span', '', `CPR for ${clock(inc.elapsedS + drift - cpr.startedAtS)}`),
      el('span', '', !cpr.measuring ? 'Camera not measuring' : paused ? `Paused ${Math.round(cpr.sinceLastS + drift)} s` : 'Measured by camera'),
    );
    gauge.append(rate, el('small', '', 'per min'), facts);
    parts.push(el('h3', '', 'CPR, live'), gauge);
  }
  if (inc.step) parts.push(el('h3', '', 'Bystander is on'), el('p', '', inc.step));

  parts.push(el('h3', '', 'Location'));
  const { address, lat, lon, accuracyM } = inc.location;
  if (address) parts.push(el('p', '', address));
  if (lat !== null) {
    const a = el('a', '', `${lat.toFixed(5)}, ${lon.toFixed(5)}${accuracyM ? ` (±${Math.round(accuracyM)} m)` : ''}`);
    a.href = mapLink({ lat, lon });
    a.target = '_blank';
    a.rel = 'noopener';
    const line = el('p');
    line.append(a);
    parts.push(line);
  }
  if (!address && lat === null) parts.push(el('p', 'fine', 'Not shared yet.'));
  if (inc.nearestAed) parts.push(el('p', 'fine', `Nearest mapped AED: ${inc.nearestAed.distanceM} m ${inc.nearestAed.direction}, ${inc.nearestAed.name}`));

  parts.push(el('h3', '', 'Patient'), el('p', '', `Age group: ${inc.patient.age}`));
  if (inc.callback) parts.push(el('p', '', `Callback: ${inc.callback}`));

  parts.push(el('h3', '', 'Bystander reports'));
  const list = el('ol', 'reports');
  for (const r of [...inc.reports].reverse()) {
    const li = el('li');
    li.append(el('span', 'clock small', clock(r.atS)), el('span', '', r.code === 'note' ? `“${r.text}”` : REPORTS[r.code]?.label || r.code));
    list.append(li);
  }
  if (!inc.reports.length) list.append(el('li', 'fine', 'None yet.'));
  parts.push(list);
  box.replaceChildren(...parts);

  const c = s.call;
  $('console-clock').textContent = c.status === 'connected' && c.connectedAt ? clock((Date.now() - c.connectedAt) / 1000) : '';
}

setInterval(() => {
  if (focusId) renderIncident();
}, 1000);

start();
