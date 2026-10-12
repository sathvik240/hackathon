// Link inspector: finds web addresses and email addresses in a message and
// explains, in plain words, where each one really goes.

import { BRANDS, FREE_EMAIL_DOMAINS, GOV_SITE, isOfficialFor, officialBrandFor } from './brands.js';
import { combine, levenshtein, scriptOf, skeleton } from './text.js';

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz', 'org.nz', 'govt.nz',
  'co.za', 'co.in', 'gov.in', 'org.in', 'net.in', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'gov.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk', 'com.sg', 'com.tr',
  'com.ng', 'com.ph', 'com.my', 'co.kr', 'co.id', 'com.tw', 'gc.ca', 'qc.ca',
]);

// Web endings that are cheap to register and common in scam campaigns.
const RISKY_TLDS = new Set([
  'top', 'xyz', 'click', 'link', 'zip', 'mov', 'icu', 'cyou', 'buzz', 'rest', 'cfd',
  'sbs', 'bond', 'lat', 'win', 'vip', 'monster', 'quest', 'gq', 'tk', 'ml', 'cf', 'ga',
  'work', 'support', 'help', 'live', 'online', 'site', 'shop', 'info', 'cc', 'pw', 'su',
  'today', 'xin', 'life', 'fun', 'store', 'autos', 'boats', 'loan', 'cam', 'country',
]);

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly',
  'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 't.ly', 's.id', 'bl.ink', 'short.io',
  'tr.im', 'v.gd', 'qrco.de', 'lnkd.in', 'shorturl.gg', 'urlz.fr', 'tiny.one',
]);

// Bare addresses without http:// are only treated as links when they end in
// a real web ending, so "file.txt" or "St.Louis" are left alone.
const KNOWN_TLDS = new Set([
  ...RISKY_TLDS, 'com', 'net', 'org', 'gov', 'edu', 'mil', 'biz', 'io', 'co', 'us', 'uk',
  'ca', 'au', 'de', 'fr', 'in', 'ly', 'me', 'tv', 'app', 'dev', 'ws', 'ru', 'cn', 'to',
  'gl', 'gd', 'at', 'gg', 'one', 'fr', 'es', 'it', 'nl', 'br', 'mx', 'jp', 'kr', 'id',
  'ph', 'ng', 'za', 'nz', 'ie', 'page', 'services', 'center', 'net', 'tech', 'pro', 'ai',
]);

const RISKY_WORDS = /(?:log-?in|sign-?in|verify|verification|secure|security|account|update|unlock|confirm|billing|wallet|refund|claim|reward|gift|redeliver|reschedule|toll|invoice|payment|pay)/i;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+|(?<![@\p{L}\p{N}_.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/giu;
const EMAIL_RE = /\b[a-z0-9._%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi;
const TRAILING = /[.,;:!?)\]}'"’”…>]+$/;

export function registrableDomain(host) {
  if (!host) return '';
  if (isIp(host)) return host;
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function isIp(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-f:]+\]$/i.test(host);
}

// Pieces of a host name to compare against brand names: "usps.com-track.top"
// gives usps, com, track, top, comtrack.
function hostTokens(host) {
  const tokens = new Set();
  for (const label of host.toLowerCase().split('.')) {
    tokens.add(label);
    tokens.add(label.replace(/-/g, ''));
    for (const part of label.split('-')) if (part) tokens.add(part);
  }
  return [...tokens];
}

const EXACT_ONLY_TOKENS = new Set(['apple', 'citi', 'norton', 'windows']);

function brandInHost(host) {
  const tokens = hostTokens(host);
  for (const brand of BRANDS) {
    for (const bt of brand.tokens) {
      const t = bt.replace(/-/g, '');
      const hit = tokens.some((tok) => {
        if (tok === t) return true;
        if (EXACT_ONLY_TOKENS.has(t) || t.length < 4) return false;
        if (t.length >= 6) return tok.includes(t);
        return tok.startsWith(t);
      });
      if (hit) return brand;
    }
  }
  return null;
}

function lookalikeOf(registrable) {
  const label = registrable.split('.')[0];
  if (!label || label.length < 3) return null;
  const sk = skeleton(label);
  for (const brand of BRANDS) {
    for (const domain of brand.domains) {
      const official = domain.split('.')[0];
      if (official.length < 3 || official === label) continue;
      const osk = skeleton(official);
      if (sk === osk) return { brand, domain };
      if (official.length >= 5 && levenshtein(label, official) === 1) return { brand, domain };
      if (official.length >= 9 && levenshtein(sk, osk) <= 2) return { brand, domain };
    }
  }
  return null;
}

function realSitesOf(brand) {
  if (!brand.domains.length) return `${brand.name} uses a .gov address.`;
  if (brand.kind === 'toll') return `${brand.name} uses addresses like ${brand.domains.slice(0, 2).join(' or ')}.`;
  return `${brand.name}’s real site is ${brand.domains[0]}.`;
}

function rawHostOf(candidate) {
  let rest = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  rest = rest.split(/[/?#]/)[0];
  const at = rest.lastIndexOf('@');
  if (at >= 0) rest = rest.slice(at + 1);
  return rest.replace(/:\d+$/, '');
}

function finding(id, weight, title, why) {
  return { id, weight, title, why };
}

// Analyze one host (from a link or an email address). `context` carries the
// brands the surrounding message claims to be from.
export function analyzeHost(host, rawHost = host, context = {}) {
  const findings = [];
  const registrable = registrableDomain(host);
  const officialBrand = officialBrandFor(registrable) || (registrable.endsWith('.gov') ? GOV_SITE : null);
  const tld = registrable.split('.').pop();

  if (isIp(host)) {
    findings.push(finding('ip_host', 0.6, 'Uses a number instead of a website name',
      'Real companies use names like amazon.com. A string of numbers hides who runs the site.'));
  }

  const foreign = [...rawHost].filter((ch) => /[^\x00-\x7F]/.test(ch));
  if (foreign.length || host.split('.').some((l) => l.startsWith('xn--'))) {
    const scripts = [...new Set(foreign.map(scriptOf).filter(Boolean))];
    findings.push(finding('lookalike_letters', 0.65, 'Uses look-alike letters from another alphabet',
      scripts.length
        ? `Some letters in this address are ${scripts.join(' and ')}, not English. They look the same but lead to a different site.`
        : 'This address contains special characters that can imitate normal letters and lead to a different site.'));
  }

  let impersonates = null;
  if (!officialBrand && !isIp(host)) {
    const claimed = brandInHost(host);
    if (claimed) {
      findings.push(finding('brand_in_address', 0.7, `Pretends to be ${claimed.name}`,
        `The address mentions ${claimed.name}, but the real website is ${registrable}. ${realSitesOf(claimed)}`));
      impersonates = claimed;
    } else {
      const look = lookalikeOf(registrable);
      if (look) {
        findings.push(finding('misspelled_brand', 0.7, `Misspelled copy of ${look.domain}`,
          `${registrable} is spelled to look like ${look.domain}, ${look.brand.name}'s real website, but it is a different site.`));
        impersonates = look.brand;
      }
    }

    const mentioned = (context.claimedBrands || []).filter((b) => !isOfficialFor(b, registrable));
    if (mentioned.length && !impersonates && !SHORTENERS.has(registrable)) {
      const b = mentioned[0];
      findings.push(finding('brand_mismatch', 0.5, `Message says ${b.name}, link goes elsewhere`,
        `The message claims to be from ${b.name}, but this link goes to ${registrable}, which is not ${b.name}'s website.`));
    }
  }

  if (SHORTENERS.has(registrable) || SHORTENERS.has(host)) {
    findings.push(finding('shortener', 0.3, 'Shortened link hides where it really goes',
      'Link shorteners like this one hide the real destination until you click. Scammers use them to disguise fake sites.'));
  }

  if (RISKY_TLDS.has(tld) && !officialBrand) {
    findings.push(finding('risky_ending', 0.3, `Ends in “.${tld}”`,
      `Web addresses ending in .${tld} are cheap and quick to set up, and they show up often in scam texts.`));
  }

  const labels = host.split('.');
  const extra = labels.length - registrable.split('.').length;
  if (!officialBrand && extra >= 3) {
    findings.push(finding('long_address', 0.2, 'Unusually long address',
      'Stacking many words in front of the real site name is a trick to push the real name out of view on a phone screen.'));
  }

  const mainLabel = registrable.split('.')[0];
  if (!officialBrand && (mainLabel.match(/-/g) || []).length >= 2) {
    findings.push(finding('hyphens', 0.15, 'Many dashes in the site name',
      'Names like secure-account-update are a common pattern for fake sites.'));
  }

  return { registrable, tld, officialBrand, impersonates, findings };
}

export function analyzeUrl(candidate, context = {}) {
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate);
  let url;
  try {
    url = new URL(hadScheme ? candidate : `http://${candidate}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const rawHost = rawHostOf(candidate);
  const base = analyzeHost(host, rawHost, context);
  const findings = [...base.findings];

  if (url.username || url.password) {
    findings.push(finding('at_trick', 0.6, 'Hides the real address after an @ sign',
      `Everything before the @ is ignored by your browser. This link really goes to ${base.registrable}.`));
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    findings.push(finding('odd_port', 0.25, 'Uses an unusual port number',
      'Normal websites do not need a number after the name. This is a sign of a hastily set up server.'));
  }
  if (hadScheme && url.protocol === 'http:' && !base.officialBrand) {
    findings.push(finding('not_secure', 0.1, 'Not a secure (https) link',
      'The address starts with http:// instead of https://, so anything you type could be seen by others.'));
  }
  if (!base.officialBrand && RISKY_WORDS.test(host + url.pathname) && findings.length) {
    findings.push(finding('bait_words', 0.15, 'Uses words like “verify” or “pay”',
      'Fake sites put reassuring or urgent words in the address to make you trust them.'));
  }

  const risk = combine(findings.map((f) => f.weight));
  let verdict = 'unknown';
  if (base.officialBrand && !findings.some((f) => f.weight >= 0.5)) verdict = 'official';
  else if (risk >= 0.6) verdict = 'dangerous';
  else if (risk >= 0.25) verdict = 'suspicious';

  const sub = host.endsWith(base.registrable) ? host.slice(0, host.length - base.registrable.length) : '';
  return {
    raw: candidate,
    href: url.href,
    host,
    subdomain: sub,
    registrable: base.registrable,
    path: url.pathname === '/' ? '' : url.pathname + url.search,
    officialBrand: base.officialBrand ? { id: base.officialBrand.id, name: base.officialBrand.name } : null,
    impersonates: base.impersonates ? { id: base.impersonates.id, name: base.impersonates.name } : null,
    findings: findings.sort((a, b) => b.weight - a.weight),
    risk,
    verdict,
  };
}

export function extractLinks(text) {
  const out = [];
  const emailSpans = [];
  for (const m of text.matchAll(EMAIL_RE)) emailSpans.push([m.index, m.index + m[0].length]);
  const insideEmail = (i) => emailSpans.some(([s, e]) => i >= s && i < e);

  for (const m of text.matchAll(URL_RE)) {
    if (insideEmail(m.index)) continue;
    let raw = m[0].replace(TRAILING, '');
    if (!raw) continue;
    const isExplicit = /^(?:https?:\/\/|www\.)/i.test(raw);
    if (!isExplicit) {
      const host = raw.split(/[/:?#]/)[0];
      const tld = host.split('.').pop();
      // "now.Click here" is a missing space, not a web address.
      if (tld !== tld.toLowerCase() || !KNOWN_TLDS.has(tld)) continue;
    }
    out.push({ raw, start: m.index, end: m.index + raw.length });
  }
  return out;
}

export function extractEmails(text) {
  return [...text.matchAll(EMAIL_RE)].map((m) => ({
    raw: m[0],
    domain: m[1].toLowerCase(),
    local: m[0].split('@')[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

export function analyzeEmail(email, context = {}) {
  const base = analyzeHost(email.domain, email.domain, context);
  const findings = [...base.findings];
  const registrable = base.registrable;
  if (FREE_EMAIL_DOMAINS.has(registrable)) {
    const named = BRANDS.find((b) => b.tokens.some((t) => t.length >= 4 && email.local.includes(t)));
    const claimed = named || (context.claimedBrands || [])[0];
    if (claimed && !claimed.domains.includes(registrable)) {
      findings.push(finding('free_email', 0.5, `Claims to be ${claimed.name} but uses a free email account`,
        `${claimed.name} does not send official messages from a free ${registrable} address. Anyone can make one in a minute.`));
    }
  }
  // A free email address is not itself a brand mismatch.
  const cleaned = FREE_EMAIL_DOMAINS.has(registrable) ? findings.filter((f) => f.id !== 'brand_mismatch') : findings;
  const risk = combine(cleaned.map((f) => f.weight));
  return {
    raw: email.raw,
    host: email.domain,
    registrable,
    subdomain: '',
    path: '',
    isEmail: true,
    officialBrand: base.officialBrand ? { id: base.officialBrand.id, name: base.officialBrand.name } : null,
    impersonates: base.impersonates ? { id: base.impersonates.id, name: base.impersonates.name } : null,
    findings: cleaned.sort((a, b) => b.weight - a.weight),
    risk,
    verdict: base.officialBrand && !cleaned.length ? 'official' : risk >= 0.6 ? 'dangerous' : risk >= 0.25 ? 'suspicious' : 'unknown',
  };
}
