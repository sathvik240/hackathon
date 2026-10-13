// Bystander phone app: the CPR coach (camera + pose tracking + voice), the
// step-by-step guides, and the live link to the AI caller on the server.

import { FRAMING_HINTS, analyzePose, formChecks } from './core/pose.js';
import { AHA, CompressionDetector } from './core/compressions.js';
import { CUES, Coach } from './core/coach.js';
import { scoreSession } from './core/scorecard.js';
import { REPORTS, SCENARIOS, scenarioOf } from './core/scenarios.js';
import { clock } from './core/incident.js';
import { findNearby, mapLink } from './core/places.js';
import { Metronome, Voice } from './ui/voice.js';
import { CameraSource, SimSource, loadLandmarker } from './ui/tracker.js';
import { drawPose } from './ui/draw.js';
import { Link, fetchHealth } from './ui/link.js';

const $ = (id) => document.getElementById(id);

// ---- settings (this device only) -------------------------------------------

const saved = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`bystander.${key}`);
      if (v === null) return fallback;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`bystander.${key}`, JSON.stringify(value));
    } catch {
      // Private mode: settings last for this visit only.
    }
  },
};

const params = new URLSearchParams(location.search);
const settings = {
  address: saved.get('address', ''),
  callback: saved.get('callback', ''),
  roundS: Number(saved.get('roundS', 120)),
  sim: params.has('sim') || saved.get('sim', false),
  facing: saved.get('facing', 'user'),
  beat: saved.get('beat', true),
  voice: saved.get('voice', true),
};

const voice = new Voice();
const beat = new Metronome(110);
voice.enabled = settings.voice;
beat.enabled = settings.beat;
let health = null;

// ---- screens ----------------------------------------------------------------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  document.body.dataset.screen = id;
  window.scrollTo(0, 0);
}

function confirmDialog(text, yesLabel = 'End') {
  const dialog = $('confirm');
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yesLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    const done = (value) => () => {
      dialog.close();
      $('confirm-yes').onclick = null;
      $('confirm-no').onclick = null;
      resolve(value);
    };
    $('confirm-yes').onclick = done(true);
    $('confirm-no').onclick = done(false);
  });
}

// ---- the incident (one per emergency) --------------------------------------

let incident = null;
let link = null;
let run = null; // the CPR coach while it runs
let guide = null; // the step guide while it runs
let ticker = 0;
let naloxoneTimer = 0;

function newIncident(scenario) {
  return {
    mode: 'emergency',
    scenario,
    startedAt: Date.now(),
    age: checkAge,
    location: { address: settings.address, lat: null, lon: null, accuracyM: null },
    reports: [],
    nearby: [],
    cprStartedAtS: null,
    call: { status: 'idle' },
  };
}

const elapsedS = () => (incident ? (Date.now() - incident.startedAt) / 1000 : 0);

// The record the server keeps and the caller reads from.
function incidentSnapshot() {
  const now = performance.now();
  const measuring = Boolean(run && (run.source?.kind === 'sim' || (run.tracking && now - run.lastVisibleAt < 2000)));
  return {
    mode: 'emergency',
    scenario: incident.scenario,
    elapsedS: elapsedS(),
    step: guide ? scenarioOf(incident.scenario).steps[guide.index]?.title || '' : '',
    location: incident.location,
    callback: settings.callback,
    patient: { age: incident.age },
    cpr: {
      active: Boolean(run),
      measuring,
      startedAtS: incident.cprStartedAtS,
      compressions: run ? run.detector.count : 0,
      rate: run ? run.detector.rate(now) : null,
      sinceLastS: run?.detector.lastAt ? (now - run.detector.lastAt) / 1000 : null,
    },
    reports: incident.reports,
    nearestAed: incident.nearby.find((p) => p.kind === 'aed') || null,
  };
}

function addReport(code, text = '') {
  if (!incident) return;
  incident.reports.push({ id: Math.random().toString(36).slice(2, 10), atS: elapsedS(), code, text });
  if (code === 'naloxone') startNaloxoneTimer();
  logLine({ who: 'you', text: code === 'note' ? text : REPORTS[code].label });
  link?.push();
}

// ---- the AI caller -------------------------------------------------------------

async function startCaller() {
  const panel = $('caller');
  panel.hidden = false;
  $('call-log').replaceChildren();
  $('relay').hidden = true;
  renderReports();
  setCallStatus({ status: 'idle' }, 'Connecting to the Bystander server…');
  if (!health) {
    setCallStatus({ status: 'failed' }, 'Server offline. Call 911 yourself.');
    return;
  }
  link = new Link({ onEvent: onCallEvent, getIncident: incidentSnapshot });
  try {
    await link.open();
    const call = await link.call();
    setCallStatus(call);
  } catch (err) {
    setCallStatus({ status: 'failed', error: err.message });
  }
}

function onCallEvent(type, data) {
  if (type === 'call') setCallStatus(data.call);
  else if (type === 'hello' && data.call) setCallStatus(data.call);
  else if (type === 'line') logLine(data);
  else if (type === 'relay') showRelay(data.text);
  else if (type === 'connection' && !data.ok && incident) $('call-sub').textContent = 'Reconnecting to the server…';
}

const STATUS_TEXT = {
  idle: 'Getting ready to call',
  dialing: 'Dialing the dispatcher…',
  ringing: 'Ringing the dispatcher…',
  connected: 'On the line with the dispatcher',
  ended: 'Call ended',
  failed: 'Call failed',
};

function setCallStatus(call, override) {
  if (!incident) return;
  incident.call = call;
  const status = call.status || 'idle';
  $('call-dot').dataset.status = status;
  let text = override || STATUS_TEXT[status] || status;
  if (!override && status === 'ringing') text = call.transport === 'web' ? 'Ringing the dispatcher console…' : `Ringing ${call.to || 'the dispatcher'}…`;
  if (!override && status === 'failed' && call.error) text = `Call failed: ${call.error}`;
  $('call-sub').textContent = text;
  const btn = $('call-btn');
  btn.textContent = ['ended', 'failed'].includes(status) ? 'Call again' : 'Hang up';
  btn.hidden = status === 'idle' && !override;
}

function logLine(line) {
  const who = { agent: 'AI → dispatcher', dispatcher: 'Dispatcher', relay: 'To you', you: 'You reported' }[line.who] || line.who;
  const li = document.createElement('li');
  li.className = `line ${line.who}`;
  const label = document.createElement('small');
  label.textContent = who;
  const text = document.createElement('span');
  text.textContent = line.text;
  li.append(label, text);
  const log = $('call-log');
  log.append(li);
  while (log.children.length > 30) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function showRelay(text) {
  $('relay-text').textContent = text;
  $('relay').hidden = false;
  beat.chime();
  navigator.vibrate?.([200, 100, 200]);
  voice.say(`Message from the dispatcher. ${text}`, { force: true });
  if (run) run.coach.lastCueAt = performance.now() + 4000; // let the message finish
  clearTimeout(showRelay.timer);
  showRelay.timer = setTimeout(() => { $('relay').hidden = true; }, 20000);
}

function renderReports() {
  const row = $('report-row');
  row.replaceChildren();
  const codes = new Set(scenarioOf(incident.scenario).reports);
  if (run) ['aed_here', 'swapped', 'breathing'].forEach((c) => codes.add(c));
  for (const code of codes) {
    const btn = document.createElement('button');
    btn.textContent = REPORTS[code].label;
    btn.addEventListener('click', () => {
      addReport(code);
      btn.classList.add('sent');
      setTimeout(() => btn.classList.remove('sent'), 1200);
    });
    row.append(btn);
  }
}

function placeCaller(screenId) {
  const slot = document.querySelector(`#${screenId} [data-caller-slot]`);
  if (slot && incident) slot.append($('caller'));
}

$('call-btn').addEventListener('click', async () => {
  if (!link) return;
  if (['ended', 'failed'].includes(incident?.call.status)) {
    try {
      setCallStatus(await link.call());
    } catch (err) {
      setCallStatus({ status: 'failed', error: err.message });
    }
  } else {
    await link.hangup();
  }
});

// Tell the dispatcher something by voice (or typing where speech isn't available).
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) $('talk-btn').textContent = 'Type a message for the dispatcher';
$('talk-btn').addEventListener('click', () => {
  if (!Recognition) {
    $('type-row').hidden = false;
    $('type-input').focus();
    return;
  }
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  const btn = $('talk-btn');
  btn.classList.add('listening');
  btn.textContent = 'Listening…';
  voice.stop();
  if (run) run.listening = true;
  rec.onresult = (e) => {
    const text = e.results[0]?.[0]?.transcript?.trim();
    if (text) addReport('note', text);
  };
  rec.onend = () => {
    btn.classList.remove('listening');
    btn.textContent = 'Tap and tell the dispatcher';
    if (run) run.listening = false;
  };
  rec.onerror = () => {
    $('type-row').hidden = false;
  };
  rec.start();
});
function sendTyped() {
  const text = $('type-input').value.trim();
  if (!text) return;
  addReport('note', text);
  $('type-input').value = '';
}
$('type-send').addEventListener('click', sendTyped);
$('type-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTyped();
});

// ---- location and nearby AEDs ------------------------------------------------

function locate() {
  if (!navigator.geolocation || !incident) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    if (!incident) return;
    incident.location = {
      address: settings.address,
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracyM: pos.coords.accuracy,
    };
    link?.push();
    lookupNearby();
  }, () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

async function lookupNearby() {
  const { lat, lon } = incident.location;
  const kinds = incident.scenario === 'overdose' ? ['aed', 'pharmacy'] : ['aed'];
  const found = [];
  for (const kind of kinds) {
    try {
      const places = await findNearby({ lat, lon, kind });
      if (places[0]) found.push(places[0]);
    } catch (err) {
      console.warn('[bystander] nearby lookup failed', err);
    }
  }
  if (!incident || !found.length) return;
  incident.nearby = found;
  const p = $('nearby');
  p.replaceChildren();
  for (const place of found) {
    const a = document.createElement('a');
    a.href = mapLink(place);
    a.target = '_blank';
    a.rel = 'noopener';
    const label = place.kind === 'aed' ? 'Nearest mapped AED' : 'Nearest pharmacy (naloxone is sold over the counter)';
    a.textContent = `${label}: ${place.distanceM} m ${place.direction}, ${place.name}`;
    p.append(a);
  }
  p.hidden = false;
  link?.push();
}

// ---- CPR coach --------------------------------------------------------------

function startCoach(mode) {
  stopCoach();
  run = {
    mode,
    detector: new CompressionDetector(),
    coach: new Coach(),
    form: { elbowFrames: 0, elbowOk: 0, shoulderFrames: 0, shoulderOk: 0 },
    startPerf: performance.now(),
    lastVisibleAt: -Infinity,
    lastHud: 0,
    frame: null,
    checks: null,
    target: null,
    marking: false,
    tracking: false,
    source: null,
    raf: 0,
    listening: false,
  };
  if (incident) {
    incident.cprStartedAtS ??= elapsedS();
    placeCaller('coach');
    renderReports();
  }
  $('mode-pill').textContent = mode === 'train' ? 'Training' : 'Emergency';
  $('mode-pill').classList.toggle('danger', mode !== 'train');
  $('caller').hidden = !incident;
  $('cue').textContent = CUES.start.text;
  $('frame-guide').hidden = false;
  $('sim-bar').hidden = true;
  $('rate').textContent = '—';
  $('count').textContent = '0';
  $('depth').textContent = '–';
  show('coach');
  if (beat.enabled) beat.start();
  voice.say(CUES.start.text);
  run.coach.lastCueAt = performance.now() + 2000;
  startSource(run);
  run.raf = requestAnimationFrame(loop);
}

async function startSource(current) {
  const stage = $('stage');
  const portrait = stage.clientHeight >= stage.clientWidth;
  if (settings.sim) {
    current.source = new SimSource(portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 });
    current.tracking = true;
    $('video').hidden = true;
    $('frame-guide').hidden = true;
    $('sim-bar').hidden = false;
    $('sim-rate').textContent = current.source.opts.rate;
    stage.classList.remove('mirrored');
    return;
  }
  setTrack('Loading pose tracker…');
  try {
    const landmarker = await loadLandmarker(health || {});
    if (run !== current) return;
    setTrack('Opening camera…');
    const source = new CameraSource($('video'), landmarker);
    await source.open(settings.facing);
    if (run !== current) {
      source.stop();
      return;
    }
    current.source = source;
    current.tracking = true;
    stage.classList.toggle('mirrored', settings.facing === 'user');
  } catch (err) {
    console.error('[bystander] camera or pose tracker failed', err);
    if (run !== current) return;
    current.tracking = false;
    setTrack('Camera off: beat only', 'warn');
    $('frame-hint').textContent = `${err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Pose tracking could not start.'} Follow the beat. Turn on the simulated rescuer in Settings for a demo.`;
  }
}

function setTrack(text, tone = '') {
  const pill = $('track-pill');
  pill.textContent = text;
  pill.dataset.tone = tone;
}

function stopCoach() {
  if (!run) return;
  cancelAnimationFrame(run.raf);
  run.source?.stop();
  beat.stop();
  run = null;
}

function loop() {
  if (!run) return;
  const current = run;
  current.raf = requestAnimationFrame(loop);
  const now = performance.now();
  if (current.source) {
    let landmarks;
    try {
      landmarks = current.source.frame(now);
    } catch (err) {
      console.error('[bystander] tracking error', err);
      landmarks = null;
    }
    if (landmarks === undefined) return;
    onFrame(current, landmarks, now);
  } else {
    onFrame(current, undefined, now);
  }
}

function onFrame(current, landmarks, now) {
  const size = current.source?.size;
  const frame = landmarks ? analyzePose(landmarks, { ...size, target: current.target }) : { visible: false, framing: 'no_person' };
  current.frame = frame;
  const { detector } = current;
  if (frame.visible) {
    current.lastVisibleAt = now;
    const event = detector.push(now, frame.handY, frame.armLen);
    if (event && detector.count === 1) current.firstAt = event.t;
  } else if (now - current.lastVisibleAt > 500) {
    detector.restart();
  }
  const rate = detector.rate(now);
  const checks = formChecks(frame);
  current.checks = checks;
  if (rate !== null) {
    if (checks.elbows !== null) {
      current.form.elbowFrames++;
      if (checks.elbows) current.form.elbowOk++;
    }
    if (checks.shoulders !== null) {
      current.form.shoulderFrames++;
      if (checks.shoulders) current.form.shoulderOk++;
    }
  }

  if (!current.listening) {
    const cue = current.coach.update({
      tracking: current.tracking,
      visible: frame.visible,
      count: detector.count,
      lastAt: detector.lastAt,
      firstAt: current.firstAt ?? null,
      rate,
      depthCm: detector.depth(),
      elbowAngle: frame.elbowAngle,
      armTilt: frame.armTilt,
      sideView: frame.sideView,
      offTarget: frame.offTarget ?? null,
    }, now);
    if (cue) {
      $('cue').textContent = cue.text;
      $('cue').dataset.kind = cue.kind;
      voice.say(cue.text);
    }
  }

  if (size?.width) {
    drawPose($('overlay').getContext('2d'), landmarks || null, { ...size, frame, checks, target: current.target, sim: current.source?.kind === 'sim' });
  }
  if (now - current.lastHud > 100) {
    current.lastHud = now;
    renderHud(current, frame, rate, checks, now);
  }

  // Training rounds end on their own, counted from the first compression.
  if (current.mode === 'train' && settings.roundS > 0 && current.firstAt && now - current.firstAt >= settings.roundS * 1000) {
    voice.say('Time. Nice work. Here is your score.');
    finishCoach();
  }
}

function renderHud(current, frame, rate, checks, now) {
  const { detector } = current;
  $('count').textContent = detector.count;
  const depth = detector.depth();
  $('depth').textContent = depth === null ? '–' : `~${depth.toFixed(1)} cm`;
  $('rate').textContent = rate === null ? '—' : rate;
  const box = $('rate-box');
  box.dataset.zone = rate === null ? '' : rate < AHA.rateMin ? 'slow' : rate > AHA.rateMax ? 'fast' : 'good';
  const needle = $('needle');
  needle.hidden = rate === null;
  if (rate !== null) needle.style.left = `${Math.max(0, Math.min(100, ((rate - 70) / 80) * 100))}%`;

  for (const el of $('checks').children) {
    const v = checks[el.dataset.check];
    el.dataset.state = v === null ? 'unknown' : v ? 'ok' : 'bad';
  }

  if (current.tracking) {
    const hint = FRAMING_HINTS[frame.framing] || '';
    setTrack(frame.visible && frame.framing === 'good' ? (frame.sideView ? 'Tracking' : 'Tracking · turn sideways for form tips') : hint, frame.visible ? (frame.framing === 'good' ? 'ok' : 'warn') : 'bad');
    $('frame-guide').hidden = frame.visible || current.source?.kind === 'sim';
    if (!frame.visible) $('frame-hint').textContent = `${hint}. Prop the phone 1.5–2 m away at chest height, looking at you from the side.`;
  }

  if (current.mode === 'train' && settings.roundS > 0) {
    const left = current.firstAt ? Math.max(0, settings.roundS - (now - current.firstAt) / 1000) : settings.roundS;
    $('clock').textContent = current.firstAt ? `${clock(Math.ceil(left))} left` : 'Start pushing';
  } else {
    $('clock').textContent = clock(incident ? elapsedS() : (now - current.startPerf) / 1000);
  }
}

async function finishCoach() {
  if (!run) return;
  const current = run;
  const result = scoreSession({
    compressions: current.detector.compressions,
    startedAt: current.firstAt ?? current.startPerf,
    endedAt: performance.now(),
    form: current.form,
  });
  stopCoach();
  renderScore(result, current.mode);
  if (incident) await endIncident();
  show('score');
}

$('end-btn').addEventListener('click', async () => {
  if (!run) return;
  if (run.mode === 'emergency' && !(await confirmDialog('End CPR coaching and hang up the call?', 'End and hang up'))) return;
  finishCoach();
});

// Tap the video to mark where the hands should be.
$('mark-btn').addEventListener('click', () => {
  if (!run) return;
  run.marking = true;
  $('tap-hint').hidden = false;
});
$('stage').addEventListener('click', (e) => {
  if (!run?.marking || !run.source?.size?.width) return;
  run.marking = false;
  $('tap-hint').hidden = true;
  run.target = clientToFrame(e, run.source.size, $('stage').classList.contains('mirrored'));
  voice.say('Chest marked.');
});

// Video and overlay use object-fit: cover, so map the tap through that crop.
function clientToFrame(e, { width, height }, mirrored) {
  const rect = $('stage').getBoundingClientRect();
  const scale = Math.max(rect.width / width, rect.height / height);
  const dw = width * scale;
  const dh = height * scale;
  let x = (e.clientX - rect.left - (rect.width - dw) / 2) / dw;
  const y = (e.clientY - rect.top - (rect.height - dh) / 2) / dh;
  if (mirrored) x = 1 - x;
  return { x, y };
}

function toggle(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
}
$('beat-btn').addEventListener('click', () => {
  beat.enabled = !beat.enabled;
  settings.beat = beat.enabled;
  saved.set('beat', beat.enabled);
  toggle($('beat-btn'), beat.enabled);
  if (beat.enabled && run) beat.start();
  else beat.stop();
});
$('voice-btn').addEventListener('click', () => {
  voice.enabled = !voice.enabled;
  settings.voice = voice.enabled;
  saved.set('voice', voice.enabled);
  toggle($('voice-btn'), voice.enabled);
  if (!voice.enabled) voice.stop();
});
$('flip-btn').addEventListener('click', async () => {
  settings.facing = settings.facing === 'user' ? 'environment' : 'user';
  saved.set('facing', settings.facing);
  if (run?.source?.kind === 'camera') {
    try {
      await run.source.open(settings.facing);
      $('stage').classList.toggle('mirrored', settings.facing === 'user');
    } catch (err) {
      console.error(err);
    }
  }
});

// Simulated rescuer controls (also on the keyboard: arrows, E, P).
function simAction(action) {
  const sim = run?.source?.kind === 'sim' ? run.source : null;
  if (!sim) return;
  if (action === 'faster') sim.opts.rate = Math.min(160, sim.opts.rate + 10);
  if (action === 'slower') sim.opts.rate = Math.max(60, sim.opts.rate - 10);
  if (action === 'elbows') sim.opts.elbowBend = sim.opts.elbowBend ? 0 : 45;
  if (action === 'pause') sim.paused = !sim.paused;
  if (action === 'pause') {
    [sim.opts.rate, sim.savedRate] = sim.paused ? [0, sim.opts.rate] : [sim.savedRate || 110, null];
  }
  $('sim-rate').textContent = sim.paused ? 'paused' : sim.opts.rate;
  toggle(document.querySelector('[data-sim="elbows"]'), Boolean(sim.opts.elbowBend));
  toggle(document.querySelector('[data-sim="pause"]'), Boolean(sim.paused));
}
$('sim-bar').addEventListener('click', (e) => {
  const action = e.target.closest('[data-sim]')?.dataset.sim;
  if (action) simAction(action);
});
document.addEventListener('keydown', (e) => {
  if (!run || e.target.closest('input, select, textarea, dialog')) return;
  const map = { ArrowUp: 'faster', ArrowDown: 'slower', e: 'elbows', p: 'pause' };
  if (map[e.key]) {
    e.preventDefault();
    simAction(map[e.key]);
  }
});

// ---- scorecard ----------------------------------------------------------------

function renderScore(result, mode) {
  $('score-headline').textContent = result.headline;
  $('score-detail').textContent = result.detail;
  $('score-count').textContent = result.count;
  $('score-time').textContent = clock(result.durationS);
  $('score-pass').textContent = `${result.passed}/${result.graded}`;
  const body = $('metrics');
  body.replaceChildren();
  for (const m of result.metrics) {
    const tr = document.createElement('tr');
    tr.dataset.ok = m.ok === null ? 'na' : String(m.ok);
    const cells = [m.label, m.value, m.target, m.ok === null ? 'est.' : m.ok ? '✓' : '✗'];
    for (const [i, text] of cells.entries()) {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 0 && m.note) {
        const note = document.createElement('small');
        note.textContent = m.note;
        td.append(note);
      }
      tr.append(td);
    }
    body.append(tr);
  }
  $('again-btn').hidden = mode !== 'train';
  if (mode === 'train') voice.say(`${result.headline}. ${result.detail}`, { interrupt: false });
}

$('again-btn').addEventListener('click', () => beginTraining());
$('home-btn').addEventListener('click', () => show('home'));

// ---- step-by-step guides ------------------------------------------------------

function startGuide(id) {
  const scenario = SCENARIOS[id];
  guide = { index: 0 };
  $('guide-title').textContent = scenario.title;
  $('guide-note').textContent = scenario.note || '';
  const list = $('steps');
  list.replaceChildren();
  scenario.steps.forEach((step, i) => {
    const li = document.createElement('li');
    const h = document.createElement('strong');
    h.textContent = step.title;
    const p = document.createElement('p');
    p.textContent = step.text;
    li.append(h, p);
    li.addEventListener('click', () => goStep(i));
    list.append(li);
  });
  placeCaller('guide');
  show('guide');
  goStep(0);
}

function goStep(i) {
  const steps = scenarioOf(incident.scenario).steps;
  guide.index = Math.max(0, Math.min(steps.length - 1, i));
  const step = steps[guide.index];
  [...$('steps').children].forEach((li, n) => {
    li.classList.toggle('current', n === guide.index);
    li.classList.toggle('done', n < guide.index);
  });
  $('steps').children[guide.index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('step-prev').disabled = guide.index === 0;
  $('step-next').disabled = guide.index === steps.length - 1;
  $('guide-cpr').hidden = !step.cpr;
  voice.say(`${step.title}. ${step.text}`);
  link?.push();
}

$('step-prev').addEventListener('click', () => goStep(guide.index - 1));
$('step-next').addEventListener('click', () => goStep(guide.index + 1));
$('step-say').addEventListener('click', () => goStep(guide.index));
$('guide-cpr').addEventListener('click', () => {
  addReport('cpr_started');
  guide = null;
  startCoach('emergency');
});
$('guide-end').addEventListener('click', async () => {
  if (!(await confirmDialog('End the guide and hang up the call?', 'End and hang up'))) return;
  await endIncident();
  show('home');
});

// Runs even if the bystander switches to CPR, so the reminder still comes.
function startNaloxoneTimer() {
  clearInterval(naloxoneTimer);
  const due = Date.now() + 150000;
  const el = $('guide-timer');
  el.hidden = false;
  naloxoneTimer = setInterval(() => {
    const left = Math.ceil((due - Date.now()) / 1000);
    if (left > 0) {
      el.textContent = `Second naloxone dose in ${clock(left)} if they haven’t woken up`;
      return;
    }
    clearInterval(naloxoneTimer);
    el.textContent = 'If they haven’t woken up, give a second dose in the other nostril now.';
    voice.say('It has been two and a half minutes. If they have not woken up, give a second dose in the other nostril.', { force: true });
  }, 1000);
}

// ---- flows ------------------------------------------------------------------------

let checkAge = 'adult';
for (const btn of document.querySelectorAll('[data-age]')) {
  btn.addEventListener('click', () => {
    checkAge = btn.dataset.age;
    for (const b of document.querySelectorAll('[data-age]')) b.setAttribute('aria-checked', String(b === btn));
  });
}

function unlockAudio() {
  voice.unlock();
  if (beat.enabled) beat.audio();
}

function beginEmergency(scenario) {
  unlockAudio();
  incident = newIncident(scenario);
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (incident) {
      $('guide-clock').textContent = clock(elapsedS());
      const c = incident.call;
      $('call-clock').textContent = c.status === 'connected' && c.connectedAt ? clock((Date.now() - c.connectedAt) / 1000) : '';
    }
  }, 500);
  if (scenario === 'cardiac_arrest') incident.reports.push({ id: 'initial', atS: 0, code: 'not_breathing', text: '' });
  // Coach first, so the call opens with CPR already under way in the record.
  if (scenario === 'cardiac_arrest') startCoach('emergency');
  else startGuide(scenario);
  startCaller();
  locate();
}

async function endIncident() {
  clearInterval(ticker);
  clearInterval(naloxoneTimer);
  $('guide-timer').hidden = true;
  guide = null;
  stopCoach();
  voice.stop();
  if (link) {
    await link.push();
    await link.hangup();
    link.close();
  }
  link = null;
  incident = null;
  $('caller').hidden = true;
  document.body.append($('caller'));
}

function beginTraining() {
  unlockAudio();
  incident = null;
  startCoach('train');
}

$('go-emergency').addEventListener('click', () => {
  $('breathing-note').hidden = true;
  show('check');
});
$('check-yes').addEventListener('click', () => beginEmergency('cardiac_arrest'));
$('check-no').addEventListener('click', () => { $('breathing-note').hidden = false; });
$('go-train').addEventListener('click', beginTraining);
for (const tile of document.querySelectorAll('[data-scenario]')) {
  tile.addEventListener('click', () => beginEmergency(tile.dataset.scenario));
}
for (const back of document.querySelectorAll('[data-home]')) back.addEventListener('click', () => show('home'));

// ---- settings -----------------------------------------------------------------------

$('open-settings').addEventListener('click', () => {
  $('set-address').value = settings.address;
  $('set-callback').value = settings.callback;
  $('set-round').value = String(settings.roundS);
  $('set-sim').checked = settings.sim;
  $('settings').showModal();
});
$('settings-done').addEventListener('click', () => {
  settings.address = $('set-address').value.trim();
  settings.callback = $('set-callback').value.trim();
  settings.roundS = Number($('set-round').value);
  settings.sim = $('set-sim').checked;
  for (const key of ['address', 'callback', 'roundS', 'sim']) saved.set(key, settings[key]);
  $('settings').close();
});

// ---- start-up --------------------------------------------------------------------------

toggle($('beat-btn'), beat.enabled);
toggle($('voice-btn'), voice.enabled);
fetchHealth().then((h) => {
  health = h;
  const el = $('server-status');
  if (!h) {
    el.textContent = 'Offline: the coach works, but the AI caller needs the Bystander server.';
    el.dataset.tone = 'warn';
    return;
  }
  const brain = h.ai ? 'answers with Claude' : 'answers with built-in rules';
  if (h.caller === 'phone' && !h.dispatchError) el.textContent = `AI caller ready: phones ${h.dispatchTo} and ${brain}.`;
  else if (h.caller === 'phone') el.textContent = `AI caller problem: ${h.dispatchError}`;
  else el.textContent = `AI caller ready: rings the dispatcher console and ${brain}.`;
  el.dataset.tone = h.dispatchError ? 'warn' : 'ok';
  if (!settings.sim) loadLandmarker(h).catch(() => {}); // warm up the tracker
});
if (params.has('train')) beginTraining();
