import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BRANDS } from '../public/js/engine/brands.js';
import { analyzeEmail, analyzeUrl, extractEmails, extractLinks, registrableDomain } from '../public/js/engine/urls.js';

const findingIds = (a) => a.findings.map((f) => f.id);

describe('registrableDomain', () => {
  it('finds the real website name', () => {
    assert.equal(registrableDomain('usps.com-trackhelp.top'), 'com-trackhelp.top');
    assert.equal(registrableDomain('wellsfargo.secure-verify-login.com'), 'secure-verify-login.com');
    assert.equal(registrableDomain('tools.usps.com'), 'usps.com');
    assert.equal(registrableDomain('www.amazon.co.uk'), 'amazon.co.uk');
    assert.equal(registrableDomain('example.com'), 'example.com');
    assert.equal(registrableDomain('192.168.0.1'), '192.168.0.1');
  });
});

describe('extractLinks', () => {
  it('finds links with and without http, trimming punctuation', () => {
    const links = extractLinks('Pay at https://ezpass-pay.info/now. Or visit bit.ly/3Wq7xPz, or www.example.com!').map((l) => l.raw);
    assert.deepEqual(links, ['https://ezpass-pay.info/now', 'bit.ly/3Wq7xPz', 'www.example.com']);
  });

  it('ignores things that only look like addresses', () => {
    assert.deepEqual(extractLinks('Pay $6.99 now.Click here, see file.txt or St.Louis, e.g. this'), []);
  });

  it('does not count the domain of an email address as a link', () => {
    const text = 'Sent from: paypal.billing.dept@gmail.com';
    assert.deepEqual(extractLinks(text), []);
    assert.equal(extractEmails(text)[0].domain, 'gmail.com');
  });

  it('records where each link sits in the text', () => {
    const text = 'Go to https://usps.com-trackhelp.top/update now';
    const [link] = extractLinks(text);
    assert.equal(text.slice(link.start, link.end), 'https://usps.com-trackhelp.top/update');
  });
});

describe('analyzeUrl', () => {
  it('trusts official sites', () => {
    for (const url of ['https://www.usps.com/track', 'https://tools.usps.com/go', 'https://www.irs.gov/payments', 'https://dmv.ca.gov/portal', 'https://amzn.to/abc']) {
      assert.equal(analyzeUrl(url).verdict, 'official', url);
    }
  });

  it('catches a brand name in front of someone else’s site', () => {
    const a = analyzeUrl('https://usps.com-trackhelp.top/update');
    assert.equal(a.verdict, 'dangerous');
    assert.equal(a.impersonates.id, 'usps');
    assert.ok(findingIds(a).includes('brand_in_address'));
    assert.ok(findingIds(a).includes('risky_ending'));
  });

  it('catches misspelled brands', () => {
    for (const [url, brand] of [['https://paypa1.com/login', 'paypal'], ['http://arnazon.com', 'amazon'], ['https://rnicrosoft.com', 'microsoft'], ['https://wellsfargo-secure.net', 'wellsfargo']]) {
      const a = analyzeUrl(url);
      assert.equal(a.impersonates?.id, brand, url);
      assert.equal(a.verdict, 'dangerous', url);
    }
  });

  it('does not accuse unrelated sites of impersonation', () => {
    for (const url of ['https://www.citizensbank.com', 'https://pineapple-recipes.com', 'https://www.nytimes.com/section', 'https://groups.google.com/forum']) {
      assert.equal(analyzeUrl(url).impersonates, null, url);
    }
  });

  it('catches look-alike letters from other alphabets', () => {
    const a = analyzeUrl('https://аpple.com/verify'); // Cyrillic а
    assert.ok(findingIds(a).includes('lookalike_letters'));
    assert.equal(a.verdict, 'dangerous');
  });

  it('catches the @ trick, raw IP addresses, and shorteners', () => {
    const at = analyzeUrl('https://paypal.com@evil.example/login');
    assert.equal(at.registrable, 'evil.example');
    assert.ok(findingIds(at).includes('at_trick'));
    assert.ok(findingIds(analyzeUrl('http://192.168.44.10/paypal/login')).includes('ip_host'));
    assert.ok(findingIds(analyzeUrl('bit.ly/3Wq7xPz')).includes('shortener'));
  });

  it('notices when the message claims a brand the link does not belong to', () => {
    const usps = BRANDS.find((b) => b.id === 'usps');
    const a = analyzeUrl('https://parcel-redelivery.net/form', { claimedBrands: [usps] });
    assert.ok(findingIds(a).includes('brand_mismatch'));
  });
});

describe('analyzeEmail', () => {
  it('flags a company name on a free email account', () => {
    const [email] = extractEmails('From: paypal.billing.dept@gmail.com');
    const a = analyzeEmail(email);
    assert.ok(findingIds(a).includes('free_email'));
    assert.equal(a.verdict, 'suspicious');
  });

  it('trusts an official sender domain', () => {
    const [email] = extractEmails('alerts@chase.com');
    assert.equal(analyzeEmail(email).verdict, 'official');
  });
});
