import { analyzeMessage, describeFindings } from './engine/index.js';
import { REPORT_OPTIONS } from './engine/playbooks.js';
import { CHECK_CHIPS, DEFAULT_EXAMPLE, PRACTICE_DECK, exampleById } from './data/examples.js';
import { LANGUAGES } from './ai/prompt.js';
import { PERMANENT_CODES, findAiProvider } from './ai/providers.js';
import { el, renderAiResult, renderAnnotated, renderFindings, renderGoodSigns, renderLegend, renderLinks } from './ui/render.js';

const $ = (id) => document.getElementById(id);

const ui = {
  input: $('message-input'),
  editor: $('editor'),
  annotated: $('annotated'),
  annotatedText: $('annotated-text'),
  checkBtn: $('check-btn'),
  editBtn: $('edit-btn'),
  clearBtn: $('clear-btn'),
  exampleTag: $('example-tag'),
  chips: $('example-chips'),
  legend: $('legend'),
  legendList: $('legend-list'),
  linksPanel: $('links-panel'),
  linkList: $('link-list'),
  verdict: $('verdict'),
  verdictEmpty: $('verdict-empty'),
  verdictBody: $('verdict-body'),
  verdictLabel: $('verdict-label'),
  verdictSummary: $('verdict-summary'),
  meter: $('meter'),
  meterPin: $('meter-pin'),
  kind: $('kind'),
  kindName: $('kind-name'),
  kindArticle: $('kind-article'),
  kindTell: $('kind-tell'),
  findingList: $('finding-list'),
  goodList: $('good-list'),
  stepList: $('step-list'),
  acted: $('acted'),
  actedList: $('acted-list'),
  reportList: $('report-list'),
  speakBtn: $('speak-btn'),
  shareBtn: $('share-btn'),
  sharePanel: $('share-panel'),
  shareText: $('share-text'),
  copyShare: $('copy-share'),
  smsShare: $('sms-share'),
  mailShare: $('mail-share'),
  shareStatus: $('share-status'),
  aiBtn: $('ai-btn'),
  aiPanel: $('ai-panel'),
  aiNote: $('ai-note'),
  aiControls: $('ai-controls'),
  aiLanguage: $('ai-language'),
  aiImageField: $('ai-image-field'),
  aiImage: $('ai-image'),
  aiRun: $('ai-run'),
  aiStop: $('ai-stop'),
  aiResult: $('ai-result'),
};

const state = {
  result: null,
  exampleId: null,
  ai: { provider: undefined, controller: null, disabled: false },
};

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

const isNarrow = () => window.matchMedia('(max-width: 920px)').matches;
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/* Text size */
function setTextSize(size) {
  document.documentElement.dataset.textsize = size;
  for (const b of document.querySelectorAll('.textsize-btn')) b.setAttribute('aria-pressed', String(b.dataset.size === size));
  remember('secondlook:textsize', size);
}
for (const b of document.querySelectorAll('.textsize-btn')) b.addEventListener('click', () => setTextSize(b.dataset.size));
setTextSize(recall('secondlook:textsize') || '1');

/* Tabs */
function showView(name) {
  const practice = name === 'practice';
  $('view-check').hidden = practice;
  $('view-practice').hidden = !practice;
  $('tab-check').setAttribute('aria-selected', String(!practice));
  $('tab-practice').setAttribute('aria-selected', String(practice));
  if (practice && !practiceState.started) startPractice();
  stopSpeaking();
}
$('tab-check').addEventListener('click', () => showView('check'));
$('tab-practice').addEventListener('click', () => showView('practice'));

/* Examples */
for (const id of CHECK_CHIPS) {
  const ex = exampleById(id);
  ui.chips.append(el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': 'false',
    dataset: { example: id },
    onclick: () => loadExample(id, { scroll: true }),
  }, ex.label, ex.answer === 'legit' ? el('span', { class: 'chip-safe' }, ' (safe)') : null));
}

function markChip(id) {
  for (const chip of ui.chips.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.example === id));
}

function loadExample(id, opts) {
  const ex = exampleById(id);
  ui.input.value = ex.text;
  state.exampleId = id;
  ui.exampleTag.hidden = false;
  markChip(id);
  runCheck(opts);
}

ui.input.addEventListener('input', () => {
  if (state.exampleId) {
    state.exampleId = null;
    ui.exampleTag.hidden = true;
    markChip(null);
  }
});
ui.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runCheck({ scroll: true });
  }
});

/* Check */
function showEditor() {
  ui.editor.hidden = false;
  ui.annotated.hidden = true;
  ui.checkBtn.hidden = false;
  ui.editBtn.hidden = true;
}

function runCheck({ scroll = false } = {}) {
  const result = analyzeMessage(ui.input.value);
  stopSpeaking();
  closePanels();
  if (result.empty) {
    state.result = null;
    showEditor();
    ui.verdict.removeAttribute('data-level');
    ui.verdictBody.hidden = true;
    ui.verdictEmpty.hidden = false;
    ui.verdictEmpty.querySelector('.verdict-placeholder').textContent = 'Paste the message you received into the box first, then press Check this message.';
    ui.legend.hidden = true;
    ui.linksPanel.hidden = true;
    ui.input.focus();
    return;
  }
  state.result = result;

  renderAnnotated(ui.annotatedText, result.input, result.highlights, result.findings);
  ui.editor.hidden = true;
  ui.annotated.hidden = false;
  ui.checkBtn.hidden = true;
  ui.editBtn.hidden = false;

  const marked = result.findings.some((f) => f.spans?.length);
  ui.legend.hidden = !marked;
  if (marked) renderLegend(ui.legendList, result.findings);

  ui.linksPanel.hidden = result.links.length === 0;
  if (result.links.length) renderLinks(ui.linkList, result.links);

  renderVerdict(result);
  if (scroll && isNarrow()) ui.verdict.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const SEGMENTS = ['low', 'caution', 'likely', 'very_likely'];

function renderVerdict(r) {
  ui.verdictEmpty.hidden = true;
  ui.verdictBody.hidden = false;
  ui.verdict.dataset.level = r.level;
  ui.verdictLabel.textContent = r.levelLabel;
  ui.verdictSummary.textContent = r.levelSummary;

  const reached = SEGMENTS.indexOf(r.level);
  ui.meter.querySelectorAll('.meter-seg').forEach((seg, i) => seg.classList.toggle('is-on', i <= reached));
  ui.meterPin.style.left = `${Math.max(1, Math.min(99, r.score))}%`;
  ui.meter.setAttribute('aria-label', `Scam risk ${r.score} out of 100: ${r.levelLabel}`);

  ui.kind.hidden = !r.kind;
  if (r.kind) {
    const name = r.kind.id === 'generic' ? r.kind.name.toLowerCase() : r.kind.name;
    ui.kindArticle.textContent = article(name);
    ui.kindName.textContent = name;
    ui.kindTell.textContent = r.kind.tell;
  }

  renderFindings(ui.findingList, r.findings);
  ui.findingList.hidden = r.findings.length === 0;
  renderGoodSigns(ui.goodList, r.goodSigns);

  ui.stepList.replaceChildren(...r.steps.map((s) => el('li', {}, s)));
  ui.acted.hidden = r.ifActed.length === 0;
  ui.actedList.replaceChildren(...r.ifActed.map((s) => el('li', {}, s)));
}

function renderReportOptions() {
  ui.reportList.replaceChildren(...REPORT_OPTIONS.map((o) => el('li', {},
    el('strong', {}, o.href ? el('a', { href: o.href, target: '_blank', rel: 'noopener' }, o.title) : o.title),
    el('span', {}, o.detail))));
}
renderReportOptions();

ui.checkBtn.addEventListener('click', () => runCheck({ scroll: true }));
ui.editBtn.addEventListener('click', () => {
  showEditor();
  ui.input.focus();
});
ui.clearBtn.addEventListener('click', () => {
  ui.input.value = '';
  state.exampleId = null;
  state.result = null;
  ui.exampleTag.hidden = true;
  markChip(null);
  showEditor();
  stopSpeaking();
  closePanels();
  ui.verdict.removeAttribute('data-level');
  ui.verdictBody.hidden = true;
  ui.verdictEmpty.hidden = false;
  ui.verdictEmpty.querySelector('.verdict-placeholder').textContent = 'Paste a message and press Check this message. Your verdict will appear here.';
  ui.legend.hidden = true;
  ui.linksPanel.hidden = true;
  ui.input.focus();
});

/* Point from a reason to its marks in the message, and back */
let flashTimer;
function flash(findingId) {
  clearTimeout(flashTimer);
  document.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active'));
  const marks = ui.annotatedText.querySelectorAll(`mark[data-finding="${CSS.escape(findingId)}"]`);
  const items = ui.findingList.querySelectorAll(`.finding[data-finding="${CSS.escape(findingId)}"]`);
  [...marks, ...items].forEach((n) => n.classList.add('is-active'));
  flashTimer = setTimeout(() => document.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active')), 2200);
  return marks[0];
}
ui.findingList.addEventListener('click', (e) => {
  const btn = e.target.closest('button.finding');
  if (!btn) return;
  const first = flash(btn.dataset.finding);
  if (first) {
    const box = first.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
ui.annotatedText.addEventListener('click', (e) => {
  const mark = e.target.closest('mark[data-finding]');
  if (!mark) return;
  flash(mark.dataset.finding);
  const item = ui.findingList.querySelector(`.finding[data-finding="${CSS.escape(mark.dataset.finding)}"]`);
  if (item && isNarrow()) item.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* Read aloud */
const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
if (!canSpeak) ui.speakBtn.hidden = true;

function stopSpeaking() {
  if (!canSpeak) return;
  window.speechSynthesis.cancel();
  ui.speakBtn.setAttribute('aria-pressed', 'false');
  ui.speakBtn.querySelector('span').textContent = 'Read it to me';
}

ui.speakBtn.addEventListener('click', () => {
  if (!state.result) return;
  if (window.speechSynthesis.speaking) {
    stopSpeaking();
    return;
  }
  const r = state.result;
  const parts = [`${r.levelLabel}.`, r.levelSummary];
  if (r.kind) parts.push(`This looks like ${article(r.kind.name)} ${r.kind.name}.`, r.kind.tell);
  parts.push('What to do now.', ...r.steps);
  const utterance = new SpeechSynthesisUtterance(parts.join(' '));
  utterance.rate = 0.92;
  utterance.onend = stopSpeaking;
  utterance.onerror = stopSpeaking;
  ui.speakBtn.setAttribute('aria-pressed', 'true');
  ui.speakBtn.querySelector('span').textContent = 'Stop reading';
  window.speechSynthesis.speak(utterance);
});

/* Panels */
function closePanels() {
  ui.sharePanel.hidden = true;
  ui.shareBtn.setAttribute('aria-expanded', 'false');
  ui.aiPanel.hidden = true;
  ui.aiBtn.setAttribute('aria-expanded', 'false');
  ui.aiResult.hidden = true;
  ui.aiResult.replaceChildren();
  state.ai.controller?.abort();
}

function togglePanel(btn, panel) {
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  return open;
}

/* Ask someone I trust */
function shareMessage(r) {
  const excerpt = r.input.length > 700 ? `${r.input.slice(0, 700)}…` : r.input;
  const what = r.kind ? `${r.levelLabel.toLowerCase()} (${r.kind.name.toLowerCase()})` : r.levelLabel.toLowerCase();
  return `Hi, I got this message and I want a second opinion before I do anything. SecondLook says it is ${what}.\n\nHere is the message:\n"${excerpt}"\n\nCan you take a look, or give me a call?`;
}

ui.shareBtn.addEventListener('click', () => {
  if (!state.result) return;
  if (!togglePanel(ui.shareBtn, ui.sharePanel)) return;
  ui.shareText.value = shareMessage(state.result);
  ui.shareStatus.textContent = '';
  updateShareLinks();
});
ui.shareText.addEventListener('input', updateShareLinks);

function updateShareLinks() {
  const body = encodeURIComponent(ui.shareText.value);
  ui.smsShare.href = `sms:?&body=${body}`;
  ui.mailShare.href = `mailto:?subject=${encodeURIComponent('Is this a scam?')}&body=${body}`;
}

ui.copyShare.addEventListener('click', () => {
  const text = ui.shareText.value;
  const fallback = () => {
    ui.shareText.focus();
    ui.shareText.select();
    ui.shareStatus.textContent = 'Selected. Press Ctrl+C (or Cmd+C) to copy, or long-press on a phone.';
  };
  if (!navigator.clipboard?.writeText) return fallback();
  navigator.clipboard.writeText(text).then(() => {
    ui.shareStatus.textContent = 'Copied. Paste it into a text or email to someone you trust.';
  }, fallback);
});

/* AI second opinion */
ui.aiLanguage.replaceChildren(...LANGUAGES.map(([value, label]) => el('option', { value }, label)));
const savedLanguage = recall('secondlook:language');
if (savedLanguage && LANGUAGES.some(([v]) => v === savedLanguage)) ui.aiLanguage.value = savedLanguage;
ui.aiLanguage.addEventListener('change', () => remember('secondlook:language', ui.aiLanguage.value));

const providerPromise = findAiProvider().catch(() => null);

function aiUnavailable(message) {
  state.ai.disabled = true;
  ui.aiControls.hidden = true;
  ui.aiNote.textContent = message;
}

ui.aiBtn.addEventListener('click', async () => {
  if (!state.result) return;
  if (!togglePanel(ui.aiBtn, ui.aiPanel)) {
    state.ai.controller?.abort();
    return;
  }
  if (state.ai.disabled) return;
  if (state.ai.provider === undefined) {
    ui.aiNote.textContent = 'Checking whether the AI second opinion is available…';
    ui.aiControls.hidden = true;
    state.ai.provider = await providerPromise;
  }
  const p = state.ai.provider;
  if (!p) {
    aiUnavailable('The AI second opinion needs the SecondLook server running with an Anthropic API key, or the hosted version on claude.ai. The on-device check above works without it.');
    return;
  }
  if (!p.ready) {
    aiUnavailable('The AI second opinion is off on this server. Restart it with an ANTHROPIC_API_KEY to turn it on. The on-device check above works without it.');
    return;
  }
  ui.aiNote.textContent = `Ask ${p.label} to read the message and explain it in plain words.`;
  ui.aiControls.hidden = false;
  ui.aiImageField.hidden = !p.supportsImages;
  if (p.imageTypes?.length) ui.aiImage.accept = p.imageTypes.join(',');
});

ui.aiStop.addEventListener('click', () => state.ai.controller?.abort());

ui.aiRun.addEventListener('click', async () => {
  const p = state.ai.provider;
  const r = state.result;
  if (!p?.ready || !r) return;
  const image = ui.aiImage.files?.[0] || null;
  const controller = new AbortController();
  state.ai.controller = controller;
  ui.aiRun.disabled = true;
  ui.aiStop.hidden = false;
  ui.aiResult.hidden = false;
  ui.aiResult.replaceChildren(el('p', { class: 'ai-thinking' }, 'Claude is reading the message…'));
  try {
    const result = await p.analyze({
      text: r.input,
      language: ui.aiLanguage.value,
      localSummary: describeFindings(r),
      image,
      signal: controller.signal,
    });
    if (state.ai.controller !== controller) return;
    renderAiResult(ui.aiResult, result, p.label);
  } catch (err) {
    if (state.ai.controller !== controller) return;
    if (err?.code === 'cancelled') {
      ui.aiResult.hidden = true;
      ui.aiResult.replaceChildren();
    } else if (PERMANENT_CODES.has(err?.code)) {
      ui.aiResult.hidden = true;
      aiUnavailable(err.message);
    } else {
      ui.aiResult.replaceChildren(el('p', { class: 'ai-error' }, err?.message || 'The AI check did not finish. Try again.'));
    }
  } finally {
    if (state.ai.controller === controller) {
      state.ai.controller = null;
      ui.aiRun.disabled = false;
      ui.aiStop.hidden = true;
    }
  }
});

/* Practice */
const practiceState = { started: false, index: 0, answers: [] };
const pr = {
  count: $('practice-count'),
  dots: $('practice-dots'),
  label: $('practice-label'),
  bubble: $('practice-bubble'),
  choices: $('practice-choices'),
  reveal: $('practice-reveal'),
  banner: $('reveal-banner'),
  explain: $('reveal-explain'),
  findings: $('reveal-findings'),
  next: $('practice-next'),
  done: $('practice-done'),
  doneScore: $('done-score'),
};

function startPractice() {
  practiceState.started = true;
  practiceState.index = 0;
  practiceState.answers = [];
  renderPracticeCard();
}

function renderPracticeDots() {
  pr.dots.replaceChildren(...PRACTICE_DECK.map((_, i) => {
    const a = practiceState.answers[i];
    const cls = a === true ? 'is-right' : a === false ? 'is-wrong' : i === practiceState.index ? 'is-current' : '';
    return el('li', { class: cls });
  }));
}

function renderPracticeCard() {
  const ex = exampleById(PRACTICE_DECK[practiceState.index]);
  pr.count.textContent = `Message ${practiceState.index + 1} of ${PRACTICE_DECK.length}`;
  pr.label.textContent = /@/.test(ex.text) ? 'Email' : 'Text message';
  pr.bubble.textContent = ex.text;
  pr.bubble.hidden = false;
  pr.choices.hidden = false;
  pr.reveal.hidden = true;
  pr.done.hidden = true;
  renderPracticeDots();
}

pr.choices.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-answer]');
  if (!btn) return;
  const ex = exampleById(PRACTICE_DECK[practiceState.index]);
  const right = btn.dataset.answer === ex.answer;
  practiceState.answers[practiceState.index] = right;
  const r = analyzeMessage(ex.text);
  renderAnnotated(pr.bubble, ex.text, r.highlights, r.findings);
  const real = ex.answer === 'legit';
  pr.banner.textContent = right ? (real ? 'Right. This one is real.' : 'Right. It’s a scam.') : (real ? 'Not quite. This one is real.' : 'Not quite. This one is a scam.');
  pr.banner.className = `reveal-banner ${right ? 'is-right' : 'is-wrong'}`;
  pr.explain.textContent = ex.explain;
  if (real) {
    pr.findings.className = 'good-list';
    renderGoodSigns(pr.findings, r.goodSigns);
  } else {
    pr.findings.className = 'finding-list compact';
    pr.findings.hidden = false;
    renderFindings(pr.findings, r.findings.filter((f) => f.source !== 'combo'), { interactive: false, limit: 3 });
  }
  pr.choices.hidden = true;
  pr.reveal.hidden = false;
  pr.next.textContent = practiceState.index === PRACTICE_DECK.length - 1 ? 'See my score' : 'Next message';
  renderPracticeDots();
  pr.banner.focus();
});

pr.next.addEventListener('click', () => {
  if (practiceState.index < PRACTICE_DECK.length - 1) {
    practiceState.index += 1;
    renderPracticeCard();
    pr.choices.querySelector('button').focus();
    return;
  }
  const right = practiceState.answers.filter(Boolean).length;
  pr.bubble.hidden = true;
  pr.choices.hidden = true;
  pr.reveal.hidden = true;
  pr.done.hidden = false;
  pr.label.textContent = 'Your score';
  pr.count.textContent = 'All done';
  pr.doneScore.textContent = `You spotted ${right} of ${PRACTICE_DECK.length}.${right === PRACTICE_DECK.length ? ' Excellent.' : ''}`;
  renderPracticeDots();
});

$('practice-restart').addEventListener('click', startPractice);

/* Start: open on a worked example so the first screen shows what SecondLook does. */
if (location.hash === '#practice') showView('practice');
loadExample(DEFAULT_EXAMPLE, { scroll: false });
