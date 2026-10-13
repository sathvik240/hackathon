// The incident record the phone keeps up to date, and the words the caller
// agent says about it. Shared by the browser (which builds the record) and
// the server (which speaks it to the dispatcher), so both describe the scene
// the same way.

import { REPORTS, SCENARIOS, scenarioOf } from './scenarios.js';

const AGES = new Set(['adult', 'child', 'infant', 'unknown']);
const MAX_REPORTS = 40;

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

// Keeps only known fields with sane values. Anything from the browser goes
// through here before the server stores or speaks it.
export function sanitizeIncident(input) {
  const src = input && typeof input === 'object' ? input : {};
  const loc = src.location && typeof src.location === 'object' ? src.location : {};
  const cpr = src.cpr && typeof src.cpr === 'object' ? src.cpr : {};
  const aed = src.nearestAed && typeof src.nearestAed === 'object' ? src.nearestAed : null;
  const lat = num(loc.lat, -90, 90);
  const lon = num(loc.lon, -180, 180);

  const reports = (Array.isArray(src.reports) ? src.reports : [])
    .slice(-MAX_REPORTS)
    .map((r) => ({
      id: str(r?.id, 40),
      atS: num(r?.atS, 0, 86400) ?? 0,
      code: Object.hasOwn(REPORTS, r?.code) ? r.code : null,
      text: str(r?.text, 240),
    }))
    .filter((r) => r.id && r.code && (r.code !== 'note' || r.text));

  return {
    mode: src.mode === 'train' ? 'train' : 'emergency',
    scenario: Object.hasOwn(SCENARIOS, src.scenario) ? src.scenario : 'cardiac_arrest',
    elapsedS: num(src.elapsedS, 0, 86400) ?? 0,
    step: str(src.step, 120),
    location: {
      address: str(loc.address, 200),
      lat: lat !== null && lon !== null ? lat : null,
      lon: lat !== null && lon !== null ? lon : null,
      accuracyM: num(loc.accuracyM, 0, 100000),
    },
    callback: str(src.callback, 30).replace(/[^0-9+()\-. ]/g, ''),
    patient: { age: AGES.has(src.patient?.age) ? src.patient.age : 'unknown' },
    cpr: {
      active: cpr.active === true,
      measuring: cpr.measuring === true,
      startedAtS: num(cpr.startedAtS, 0, 86400),
      compressions: Math.round(num(cpr.compressions, 0, 1e6) ?? 0),
      rate: num(cpr.rate, 1, 300) === null ? null : Math.round(cpr.rate),
      sinceLastS: num(cpr.sinceLastS, 0, 86400),
    },
    reports,
    nearestAed: aed && str(aed.name, 120)
      ? { name: str(aed.name, 120), distanceM: Math.round(num(aed.distanceM, 0, 100000) ?? 0), direction: str(aed.direction, 20) }
      : null,
  };
}

// Seconds since the incident began, accounting for time since the last update.
export function elapsedNow(incident, now = Date.now()) {
  const drift = incident.receivedAt ? Math.max(0, (now - incident.receivedAt) / 1000) : 0;
  return incident.elapsedS + drift;
}

export function spokenDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const mins = m === 1 ? '1 minute' : `${m} minutes`;
  const secs = r === 1 ? '1 second' : `${r} seconds`;
  if (!m) return secs;
  return r ? `${mins} ${secs}` : mins;
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// "+1 (415) 555-0123" -> "4 1 5, 5 5 5, 0 1 2 3" so text-to-speech reads digits.
export function spokenPhone(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '';
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const groups = national.length === 10 ? [national.slice(0, 3), national.slice(3, 6), national.slice(6)] : [national];
  return groups.map((g) => g.split('').join(' ')).join(', ');
}

function spokenCoordinates({ lat, lon }) {
  const ns = lat >= 0 ? 'north' : 'south';
  const ew = lon >= 0 ? 'east' : 'west';
  return `${Math.abs(lat).toFixed(5)} ${ns}, ${Math.abs(lon).toFixed(5)} ${ew}`;
}

export function locationLine(incident) {
  const { address, lat, lon, accuracyM } = incident.location;
  const parts = [];
  if (address) parts.push(`The location is ${address}.`);
  if (lat !== null) {
    const acc = accuracyM ? `, accurate to about ${Math.max(5, Math.round(accuracyM / 5) * 5)} meters` : '';
    parts.push(`${address ? 'GPS' : 'The GPS location is'} ${spokenCoordinates(incident.location)}${acc}.`);
  }
  if (!parts.length) return 'I do not have the address yet. I can ask the bystander.';
  return parts.join(' ');
}

export function cprLine(incident, now = Date.now()) {
  const { cpr } = incident;
  if (cpr.startedAtS === null) return '';
  const drift = incident.receivedAt ? Math.max(0, (now - incident.receivedAt) / 1000) : 0;
  const since = elapsedNow(incident, now) - cpr.startedAtS;
  const running = !cpr.active ? 'CPR has stopped' : since < 5 ? 'CPR is just starting' : `CPR started ${spokenDuration(since)} ago`;
  if (!cpr.measuring) return `${running}. The camera is not measuring compressions right now.`;
  if (!cpr.compressions) return `${running}.`;
  const count = `${cpr.compressions} ${cpr.compressions === 1 ? 'compression' : 'compressions'} so far`;
  const paused = cpr.sinceLastS !== null && cpr.sinceLastS + drift > 3;
  const rate = paused
    ? `compressions paused for ${spokenDuration(cpr.sinceLastS + drift)}`
    : cpr.rate ? `currently ${cpr.rate} per minute` : '';
  return `${running}. ${[count, rate].filter(Boolean).join(', ')}.`;
}

export function reportLine(report) {
  if (report.code === 'note') return `The bystander says: “${report.text}”`;
  const line = REPORTS[report.code]?.line || '';
  return line ? `${line[0].toUpperCase()}${line.slice(1)}.` : '';
}

// What the caller says the moment the dispatcher picks up.
export function briefing(incident, { now = Date.now(), demo = true } = {}) {
  const scenario = scenarioOf(incident.scenario);
  const lines = [
    demo
      ? 'This is a training demo call from Bystander, an automated assistant. No real emergency.'
      : 'This is an automated call from Bystander, an A I assistant calling for a bystander at an emergency.',
    scenario.situation,
    locationLine(incident),
  ];
  const cpr = cprLine(incident, now);
  if (cpr) lines.push(cpr);
  const latest = incident.reports.filter((r) => r.code !== 'note').slice(-3).map(reportLine).filter(Boolean);
  if (latest.length) lines.push(`The bystander reports: ${latest.join(' ')}`);
  if (incident.nearestAed) lines.push(aedLine(incident.nearestAed));
  if (incident.callback) lines.push(`The bystander’s callback number is ${spokenPhone(incident.callback)}.`);
  lines.push('Ask me anything, or tell me what the bystander should do and I will pass it on.');
  return lines.join(' ');
}

export function aedLine(aed) {
  const where = aed.direction ? ` to the ${aed.direction}` : '';
  return `The nearest mapped AED is about ${aed.distanceM} meters${where}, at ${aed.name}.`;
}

// Short spoken update when the bystander reports something new.
export function updateLine(report) {
  const line = reportLine(report);
  return line ? `Update from the scene: ${line}` : '';
}

// Plain facts for the language model and the rule-based fallback.
export function factSheet(incident, { now = Date.now(), demo = true } = {}) {
  const scenario = scenarioOf(incident.scenario);
  const facts = [
    `Call type: ${demo ? 'training demo, not a real emergency' : 'live'}`,
    `Situation: ${scenario.situation}`,
    `Time since the emergency began: ${spokenDuration(elapsedNow(incident, now))}`,
    `Location: ${locationLine(incident)}`,
    `Patient age group: ${incident.patient.age}`,
  ];
  const cpr = cprLine(incident, now);
  if (cpr) facts.push(`CPR (rate and count measured by the phone camera; depth is not measured): ${cpr}`);
  if (incident.step) facts.push(`Current first-aid step on the bystander’s screen: ${incident.step}`);
  if (incident.nearestAed) facts.push(`Nearest AED on the map: ${aedLine(incident.nearestAed)}`);
  facts.push(`Callback number: ${incident.callback || 'not given'}`);
  const reports = incident.reports.map((r) => `[${clock(r.atS)}] ${reportLine(r)}`);
  facts.push(`Bystander reports (oldest first): ${reports.length ? `\n${reports.join('\n')}` : 'none yet'}`);
  return facts.join('\n');
}
