// Small text helpers shared by the rule engine and the link inspector.

// A negation word close before a match ("never share your code",
// "do not give us your PIN") turns a request into a warning.
const NEGATION_BEFORE =
  /\b(?:don['’]?t|do not|never|not|won['’]?t|will not|wouldn['’]?t|shouldn['’]?t|cannot|can['’]?t|no one should)\s+(?:[\w'’]+\s+){0,3}$/i;

export function isNegated(text, index) {
  const before = text.slice(Math.max(0, index - 48), index);
  return NEGATION_BEFORE.test(before);
}

// The sentence (or line) that contains a position.
export function sentenceAround(text, start, end) {
  let s = start;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
  let e = end;
  while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
  return text.slice(s, e);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Collapse characters that scammers swap to fake a brand name:
// "paypa1", "arnazon", "rnicrosoft", "g00gle" all reduce to the real spelling.
export function skeleton(label) {
  return label
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[0]/g, 'o')
    .replace(/[1i!|]/g, 'l')
    .replace(/3/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/@/g, 'a')
    .replace(/-/g, '');
}

const SCRIPT_TESTS = [
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Cherokee', /\p{Script=Cherokee}/u],
];

export function scriptOf(ch) {
  if (/\p{Script=Latin}/u.test(ch)) return 'Latin';
  for (const [name, re] of SCRIPT_TESTS) if (re.test(ch)) return name;
  return null;
}

// Words that mix Latin letters with look-alike letters from another alphabet,
// e.g. "Аmazon" where the first letter is Cyrillic.
export function findMixedScriptWords(text) {
  const out = [];
  for (const m of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    const scripts = new Set();
    for (const ch of m[0]) {
      const s = scriptOf(ch);
      if (s) scripts.add(s);
    }
    if (scripts.has('Latin') && scripts.size > 1) {
      const foreign = [...scripts].filter((s) => s !== 'Latin');
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], scripts: foreign });
    }
  }
  return out;
}

export const HIDDEN_CHARS = /[​-‍⁠﻿­᠎]/g;

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Noisy-OR: several independent warning signs add up without ever passing 1.
export function combine(weights) {
  return 1 - weights.reduce((acc, w) => acc * (1 - clamp(w, 0, 0.99)), 1);
}
