// The caller's fallback brain: answers common dispatcher questions from the
// incident record with plain rules. It runs when no Anthropic key is set,
// when Claude is slow or unreachable, and in tests. It never invents facts.

import { aedLine, briefing, cprLine, elapsedNow, locationLine, reportLine, spokenDuration, spokenPhone } from '../public/js/core/incident.js';
import { scenarioOf } from '../public/js/core/scenarios.js';

// "tell them to keep going" / "ask them if he's breathing" -> a relay.
const RELAY_RE = /\b(?:tell|ask|have|get|instruct|let)\s+(?:them|him|her|the\s+(?:bystander|caller|rescuer|person\s+doing\s+cpr))\b[\s,:]*(.*)$/i;

function latest(incident, codes) {
  return [...incident.reports].reverse().find((r) => codes.includes(r.code));
}

function breathingAnswer(incident) {
  const r = latest(incident, ['breathing', 'not_breathing', 'moving', 'object_out']);
  if (r) return `At ${spokenDuration(r.atS)} in, the bystander reported: ${reportLine(r)}`;
  if (incident.scenario === 'cardiac_arrest') return 'When CPR started, the person was unresponsive and not breathing normally. Nothing newer has been reported.';
  return 'The bystander has not reported on breathing yet. I can ask them.';
}

const INTENTS = [
  [/\b(address|where|location|cross ?street|located|gps|coordinates)\b/i, (inc) => locationLine(inc)],
  [/\b(breath|breathing|airway|gasp)/i, breathingAnswer],
  [/\b(conscious|responsive|awake|alert|respond)/i, (inc) => {
    const r = latest(inc, ['moving', 'unresponsive', 'breathing']);
    return r ? `The latest report: ${reportLine(r)}` : `${scenarioOf(inc.scenario).situation} Nothing newer has been reported.`;
  }],
  [/\b(compression|cpr|rate|pace|how fast|pumping)/i, (inc, now) => cprLine(inc, now) || 'CPR has not started.'],
  [/\b(how long|when did|what time|minutes|started)\b/i, (inc, now) => {
    const cpr = cprLine(inc, now);
    return `The emergency started ${spokenDuration(elapsedNow(inc, now))} ago. ${cpr}`.trim();
  }],
  [/\b(aed|defib)/i, (inc) => {
    const r = latest(inc, ['aed_here', 'aed_shock']);
    const parts = [r ? reportLine(r) : 'No AED has been reported at the scene.'];
    if (inc.nearestAed) parts.push(aedLine(inc.nearestAed));
    return parts.join(' ');
  }],
  [/\b(old|age|adult|child|kid|baby|infant)\b/i, (inc) => (inc.patient.age === 'unknown'
    ? 'The bystander has not given an age. I can ask them.'
    : `The patient is reported as ${inc.patient.age === 'adult' ? 'an adult' : `a ${inc.patient.age}`}.`)],
  [/\b(call ?back|phone number|number)\b/i, (inc) => (inc.callback
    ? `The bystander’s callback number is ${spokenPhone(inc.callback)}.`
    : 'The bystander did not give a callback number.')],
  [/\b(who are you|robot|automated|computer|real person|human|ai)\b/i, () => 'I am an automated assistant calling for a bystander who is busy giving first aid. I can relay instructions to them.'],
  [/\b(what happened|what'?s going on|situation|nature|emergency)\b/i, (inc) => scenarioOf(inc.scenario).situation],
  [/\b(repeat|say (that )?again|start over|from the top)\b/i, (inc, now, demo) => briefing(inc, { now, demo })],
  [/\b(drug|overdose|opioid|narcan|naloxone)\b/i, (inc) => {
    const r = latest(inc, ['naloxone', 'naloxone_2']);
    return r ? `${reportLine(r)} At ${spokenDuration(r.atS)} in.` : 'No naloxone has been reported given.';
  }],
  [/\b(bleed|blood|tourniquet|wound)\b/i, (inc) => {
    const r = latest(inc, ['tourniquet', 'bleeding_controlled']);
    return r ? `${reportLine(r)} At ${spokenDuration(r.atS)} in.` : 'Nothing about bleeding has been reported.';
  }],
  [/\b(update|status|how('?s| is) (it|he|she|they)|anything new|change)\b/i, (inc, now) => {
    const r = inc.reports.at(-1);
    return [cprLine(inc, now), r ? `Latest report: ${reportLine(r)}` : ''].filter(Boolean).join(' ') || 'No change reported.';
  }],
];

export function relayFrom(question) {
  const m = RELAY_RE.exec(question);
  if (!m) return null;
  let message = m[1].trim().replace(/[.?!]+$/, '');
  if (!message) return null;
  // "tell them to keep going" -> "Keep going." ; "ask if he's breathing" -> "Is he breathing?"
  const isAsk = /^\s*ask\b/i.test(question.slice(m.index));
  message = message.replace(/^(to|that)\s+/i, '');
  if (isAsk) {
    message = message.replace(/^(if|whether)\s+/i, '');
    message = `Dispatcher asks: ${message[0].toUpperCase()}${message.slice(1)}?`;
  } else {
    message = `${message[0].toUpperCase()}${message.slice(1)}.`;
  }
  return message.slice(0, 200);
}

export function ruleAnswer(question, incident, { now = Date.now(), demo = true } = {}) {
  const q = String(question || '');
  const relay = relayFrom(q);
  if (relay) return { text: 'Okay. I’m passing that to the bystander now.', relays: [relay] };
  for (const [re, answer] of INTENTS) {
    if (re.test(q)) return { text: answer(incident, now, demo), relays: [] };
  }
  return {
    text: 'I don’t have that information. I can pass a question or instruction to the bystander. Just say “tell them” or “ask them”.',
    relays: [],
  };
}
