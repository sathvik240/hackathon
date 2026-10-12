// DOM helpers. User text is only ever inserted as text nodes, never as HTML.

import { GROUPS } from '../engine/index.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function checkIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4 10.5 L8.2 14.5 L16 5.5');
  svg.append(path);
  return svg;
}

export function swatch(group) {
  return el('span', { class: `swatch swatch-${group}`, 'aria-hidden': 'true' });
}

// The message with highlighter marks over each warning sign.
export function renderAnnotated(container, text, highlights, findings) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  container.replaceChildren();
  let cursor = 0;
  for (const h of highlights) {
    if (h.start > cursor) container.append(text.slice(cursor, h.start));
    const finding = byId.get(h.findingId);
    const group = GROUPS[h.group];
    const mark = el('mark', {
      class: `hl hl-${h.group}${finding?.source === 'link' ? ' hl-link' : ''}`,
      title: finding ? `${group?.label || ''}: ${finding.title}` : undefined,
      dataset: { finding: h.findingId },
    }, text.slice(h.start, h.end));
    container.append(mark);
    cursor = h.end;
  }
  if (cursor < text.length) container.append(text.slice(cursor));
}

export function renderFindings(list, findings, { interactive = true, limit } = {}) {
  list.replaceChildren();
  const shown = typeof limit === 'number' ? findings.slice(0, limit) : findings;
  for (const f of shown) {
    const isCombo = f.source === 'combo';
    const canPoint = interactive && f.spans?.length;
    const body = [
      swatch(isCombo ? 'combo' : f.group),
      el('span', { class: 'finding-title' }, isCombo ? `Known pattern: ${f.title}` : f.title),
      el('span', { class: 'finding-why' }, f.why),
    ];
    const item = canPoint
      ? el('button', { type: 'button', class: 'finding', dataset: { finding: f.id }, 'aria-label': `${f.title}. Show it in the message.` }, body)
      : el('div', { class: 'finding', dataset: { finding: f.id } }, body);
    list.append(el('li', {}, item));
  }
}

export function renderGoodSigns(list, signs) {
  list.replaceChildren(...signs.map((s) => el('li', {}, checkIcon(), el('span', { class: 'finding-title' }, s.title), el('span', { class: 'finding-why' }, s.why))));
  list.hidden = signs.length === 0;
}

export function renderLegend(list, findings) {
  const counts = {};
  for (const f of findings) if (f.spans?.length) counts[f.group] = (counts[f.group] || 0) + 1;
  list.replaceChildren(
    ...Object.entries(GROUPS).map(([id, g]) =>
      el('li', { class: counts[id] ? '' : 'is-empty', title: g.hint },
        swatch(id),
        el('span', {}, g.label),
        el('span', { class: 'count' }, counts[id] ? `(${counts[id]})` : '')))
  );
}

const VERDICT_PILL = {
  dangerous: 'Dangerous',
  suspicious: 'Suspicious',
  official: 'Official site',
  unknown: 'Unknown site',
};

function addressNode(link) {
  if (link.isEmail) {
    const [local] = link.raw.split('@');
    return el('p', { class: 'link-address' }, `${local}@`, el('span', { class: 'real' }, link.host));
  }
  const prefix = link.raw.match(/^[a-z]+:\/\//i)?.[0] || '';
  return el('p', { class: 'link-address' },
    prefix,
    link.subdomain,
    el('span', { class: 'real' }, link.registrable),
    link.path || '');
}

export function renderLinks(list, links) {
  list.replaceChildren();
  for (const link of links) {
    const verdict = link.verdict;
    const real = link.isEmail
      ? el('p', { class: 'link-real' }, 'Sent from ', el('strong', {}, link.registrable),
        link.officialBrand ? `, ${link.officialBrand.name}’s real domain.` : '.')
      : el('p', { class: 'link-real' }, 'Really goes to ', el('strong', {}, link.registrable),
        link.officialBrand ? `, ${link.officialBrand.name}’s real website.` : link.impersonates ? `, not ${link.impersonates.name}.` : '.');
    const reasons = link.findings.length
      ? el('ul', { class: 'link-reasons' }, link.findings.slice(0, 4).map((f) => el('li', {}, el('strong', {}, `${f.title}. `), f.why)))
      : el('p', { class: 'link-reasons' },
        verdict === 'official' ? 'Only log in if you were expecting this message.' : 'We have no warnings about this site, but we do not know it either. Only open it if you trust the sender.');
    list.append(el('li', { class: 'link-card', dataset: { verdict } },
      el('span', { class: `pill pill-${verdict}` }, link.isEmail ? `${VERDICT_PILL[verdict].replace('site', 'sender')}` : VERDICT_PILL[verdict]),
      addressNode(link),
      real,
      reasons));
  }
}

const AI_VERDICT = {
  scam: { label: 'Scam', pill: 'dangerous' },
  suspicious: { label: 'Suspicious', pill: 'suspicious' },
  likely_safe: { label: 'Likely safe', pill: 'official' },
};

export function renderAiResult(container, result, providerLabel) {
  const v = AI_VERDICT[result.verdict];
  const parts = [
    el('div', { class: 'ai-head' },
      el('span', { class: `pill pill-${v.pill}` }, v.label),
      el('span', { class: 'ai-type' }, result.scamType),
      el('span', { class: 'ai-conf' }, `${result.confidence}% sure`)),
  ];
  if (result.summary) parts.push(el('p', {}, result.summary));
  if (result.redFlags.length) {
    parts.push(el('h4', {}, 'What stood out'),
      el('ul', {}, result.redFlags.map((f) => el('li', {}, f.quote ? el('blockquote', {}, `“${f.quote}”`) : null, f.why))));
  }
  if (result.nextSteps.length) parts.push(el('h4', {}, 'What to do'), el('ol', {}, result.nextSteps.map((s) => el('li', {}, s))));
  if (result.safeReply) parts.push(el('h4', {}, 'If you must reply'), el('p', { class: 'ai-reply' }, result.safeReply));
  parts.push(el('p', { class: 'panel-note small' }, `Answer from ${providerLabel}. AI can be wrong. When the two opinions disagree, check with someone you trust.`));
  container.replaceChildren(...parts);
}
