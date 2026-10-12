// SecondLook engine: turns a pasted message into a verdict, the reasons
// behind it, and what to do next. Runs entirely on the device.

import { findBrandMentions } from './brands.js';
import { ALREADY_ACTED, LEVELS, PLAYBOOKS } from './playbooks.js';
import { COMBOS, GROUPS, RULES } from './rules.js';
import { HIDDEN_CHARS, combine, findMixedScriptWords, isNegated, sentenceAround } from './text.js';
import { analyzeEmail, analyzeUrl, extractEmails, extractLinks } from './urls.js';

export { GROUPS, LEVELS, PLAYBOOKS };

// Which kind of scam an impersonated brand points to. Retail and tech
// brands are impersonated in many kinds of scams, so they decide nothing.
const BRAND_KIND_TO_SCAM = {
  government: 'government',
  delivery: 'delivery',
  toll: 'toll',
  bank: 'bank_alert',
};

// Signs the message itself shows that point toward it being genuine.
const PROTECTIVE = [
  {
    re: /\b(?:don'?t|do not|never)\s+share\b[^.!?\n]{0,40}\b(?:code|passcode|password|pin)\b|\bwe(?:'ll| will)? never ask\b/i,
    title: 'Warns you not to share your code',
    why: 'Real companies remind you to keep codes private. This alone does not prove it is real, since scammers copy this wording too.',
  },
];

export function levelFor(score) {
  if (score >= 80) return 'very_likely';
  if (score >= 55) return 'likely';
  if (score >= 25) return 'caution';
  return 'low';
}

function globalize(re) {
  return re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
}

function mergeSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

function runRules(text) {
  const findings = [];
  for (const rule of RULES) {
    const spans = [];
    for (const pattern of rule.patterns) {
      for (const m of text.matchAll(globalize(pattern))) {
        if (!m[0]) continue;
        const start = m.index;
        const end = start + m[0].length;
        if (rule.negatable && isNegated(text, start)) continue;
        if (rule.skipIf && rule.skipIf.test(sentenceAround(text, start, end))) continue;
        spans.push({ start, end });
      }
    }
    if (spans.length) {
      findings.push({
        id: rule.id,
        group: rule.group,
        weight: rule.weight,
        title: rule.title,
        why: rule.why,
        kinds: rule.kinds,
        spans: mergeSpans(spans),
        source: 'rule',
      });
    }
  }
  // A specific crypto payment request makes the general crypto mention redundant.
  if (findings.some((f) => f.id === 'crypto_payment')) {
    return findings.filter((f) => f.id !== 'crypto_mention');
  }
  return findings;
}

function hiddenTrickFindings(text) {
  const findings = [];
  const hidden = [...text.matchAll(HIDDEN_CHARS)];
  if (hidden.length) {
    findings.push({
      id: 'hidden_chars', group: 'tricks', weight: 0.4, kinds: [], source: 'rule',
      title: 'Contains invisible characters',
      why: `This message hides ${hidden.length} invisible character${hidden.length > 1 ? 's' : ''} between letters. Scammers do this to slip past spam filters.`,
      spans: mergeSpans(hidden.map((m) => ({ start: Math.max(0, m.index - 1), end: m.index + 1 }))),
    });
  }
  const mixed = findMixedScriptWords(text);
  if (mixed.length) {
    const scripts = [...new Set(mixed.flatMap((w) => w.scripts))].join(' and ');
    findings.push({
      id: 'mixed_letters', group: 'tricks', weight: 0.45, kinds: [], source: 'rule',
      title: 'Uses look-alike letters',
      why: `“${mixed[0].text}” mixes English letters with ${scripts} letters that look the same. That trick fakes brand names and dodges spam filters.`,
      spans: mixed.map(({ start, end }) => ({ start, end })),
    });
  }
  return findings;
}

function linkFindings(links) {
  const findings = [];
  links.forEach((link, index) => {
    if (link.risk < 0.25 || !link.findings.length) return;
    const top = link.findings[0];
    findings.push({
      id: `link_${index}`,
      group: 'tricks',
      weight: link.risk,
      title: link.isEmail ? `Suspicious sender address: ${lowerFirst(top.title)}` : `Risky link: ${lowerFirst(top.title)}`,
      why: top.why,
      kinds: link.impersonates ? [] : ['phishing'],
      spans: [{ start: link.start, end: link.end }],
      source: 'link',
      linkIndex: index,
    });
  });
  return findings;
}

function lowerFirst(s) {
  return s[0].toLowerCase() + s.slice(1);
}

function comboFindings(fired) {
  const findings = [];
  for (const combo of COMBOS) {
    if (combo.when.every((options) => options.some((id) => fired.has(id)))) {
      findings.push({ id: combo.id, group: 'combo', weight: combo.weight, title: combo.title, why: combo.why, kinds: combo.kinds, spans: [], source: 'combo' });
    }
  }
  return findings;
}

// Split the text into non-overlapping highlighted segments. Where marks
// overlap, the stronger warning sign wins.
export function buildHighlights(findings) {
  const spans = [];
  for (const f of findings) for (const s of f.spans || []) spans.push({ ...s, group: f.group, findingId: f.id, weight: f.weight });
  if (!spans.length) return [];
  const points = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const covering = spans.filter((s) => s.start <= a && s.end >= b);
    if (!covering.length) continue;
    const best = covering.reduce((x, y) => (y.weight > x.weight ? y : x));
    const last = segments[segments.length - 1];
    if (last && last.end === a && last.findingId === best.findingId) last.end = b;
    else segments.push({ start: a, end: b, group: best.group, findingId: best.findingId });
  }
  return segments;
}

function pickKind(findings, links, claimedBrands, level) {
  if (level === 'low') return null;
  const scores = {};
  const add = (k, w) => { scores[k] = (scores[k] || 0) + w; };
  for (const f of findings) for (const k of f.kinds || []) add(k, f.weight);
  for (const link of links) {
    if (link.impersonates && link.risk >= 0.25) {
      const brand = claimedBrands.find((b) => b.id === link.impersonates.id);
      const kind = BRAND_KIND_TO_SCAM[brand?.kind] || 'phishing';
      add(kind, 0.3);
      add('phishing', 0.25);
    }
  }
  for (const b of claimedBrands) {
    const kind = BRAND_KIND_TO_SCAM[b.kind];
    if (kind && scores[kind]) add(kind, 0.1);
  }
  const [best, value] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || [];
  const id = best && value >= 0.3 ? best : 'generic';
  return { id, ...PLAYBOOKS[id] };
}

function goodSignsFor(text, links, findings, level) {
  const signs = [];
  for (const link of links) {
    if (link.verdict === 'official') {
      signs.push({
        title: link.isEmail ? `Sent from ${link.officialBrand.name}’s real address` : `Link goes to ${link.officialBrand.name}’s real website`,
        why: `${link.registrable} belongs to ${link.officialBrand.name}. Still, only log in if you were expecting this message.`,
      });
    }
  }
  for (const p of PROTECTIVE) if (p.re.test(text)) signs.push({ title: p.title, why: p.why });
  const asksForSomething = findings.some((f) => ['money', 'private'].includes(f.group)) || links.length > 0;
  if (level === 'low' && !asksForSomething && text.trim().length > 20) {
    signs.push({
      title: 'Does not ask for money, links, or private details',
      why: 'Most scams need you to pay, click, or share something. This message does not.',
    });
  }
  return signs;
}

function emptyResult(text) {
  return { input: text, empty: true, score: 0, level: null, findings: [], goodSigns: [], links: [], highlights: [], kind: null, steps: [], ifActed: [], claimedBrands: [] };
}

export function analyzeMessage(input) {
  const text = String(input ?? '');
  if (text.trim().length < 4) return emptyResult(text);

  const claimedBrands = findBrandMentions(text).map((m) => m.brand);
  const context = { claimedBrands };

  const links = [];
  for (const l of extractLinks(text)) {
    const a = analyzeUrl(l.raw, context);
    if (a) links.push({ ...a, start: l.start, end: l.end });
  }
  for (const e of extractEmails(text)) links.push({ ...analyzeEmail(e, context), start: e.start, end: e.end });
  links.sort((a, b) => a.start - b.start);

  const ruleFindings = [...runRules(text), ...hiddenTrickFindings(text)];
  const lf = linkFindings(links);
  const fired = new Set(ruleFindings.map((f) => f.id));
  if (lf.some((f) => !links[f.linkIndex].isEmail)) fired.add('link:suspicious');
  if (claimedBrands.length) fired.add('brand:claimed');
  const findings = [...ruleFindings, ...lf, ...comboFindings(fired)];

  // Strongest single weight per sign; all risky links count as one sign.
  const strongest = new Map();
  for (const f of findings) {
    const key = f.source === 'link' ? 'links' : f.id;
    strongest.set(key, Math.max(strongest.get(key) || 0, f.weight));
  }
  let risk = combine([...strongest.values()]);
  const hasOfficial = links.some((l) => l.verdict === 'official');
  const hasRiskyLink = links.some((l) => l.risk >= 0.25);
  if (hasOfficial && !hasRiskyLink) risk *= 0.8;

  const score = Math.round(risk * 100);
  const level = levelFor(score);
  const kind = pickKind(findings, links, claimedBrands, level);

  let steps;
  if (level === 'low') {
    steps = [
      'If it asks for money, codes, or personal details, check with the company or person another way first.',
      'When in doubt, ask someone you trust to take a look.',
    ];
  } else {
    steps = [...kind.steps];
    if (level !== 'caution') steps.push('Block the sender and delete the message.');
  }

  findings.sort((a, b) => b.weight - a.weight);

  return {
    input: text,
    empty: false,
    score,
    level,
    levelLabel: LEVELS[level].label,
    levelSummary: LEVELS[level].summary,
    findings,
    goodSigns: goodSignsFor(text, links, findings, level),
    links,
    highlights: buildHighlights(findings),
    kind,
    steps,
    ifActed: level === 'low' ? [] : ALREADY_ACTED,
    claimedBrands: claimedBrands.map((b) => ({ id: b.id, name: b.name })),
  };
}

// One line per finding, used to brief the AI second opinion.
export function describeFindings(result) {
  if (!result || result.empty || !result.findings.length) return 'No warning signs found by the rule-based check.';
  const lines = result.findings.slice(0, 8).map((f) => `- ${f.title} (strength ${Math.round(f.weight * 100)}%)`);
  return `Rule-based score ${result.score}/100 (${result.levelLabel}). Signs found:\n${lines.join('\n')}`;
}
