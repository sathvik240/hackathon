// Organizations scammers most often pretend to be, with the web addresses
// they really use. `mentions` finds the brand in a message; `tokens` finds it
// inside a web address; `domains` are the official registrable domains.
// `govOk` accepts any .gov address (state DMVs and toll agencies vary by state).

export const BRANDS = [
  // Government
  { id: 'irs', name: 'the IRS', kind: 'government', mentions: [/\bIRS\b/, /\binternal revenue service\b/i], tokens: ['irs'], domains: ['irs.gov'] },
  { id: 'ssa', name: 'Social Security', kind: 'government', mentions: [/\bsocial security (?:administration|office|benefits?|payments?|account)\b/i, /\bSSA\b/], tokens: ['ssa', 'socialsecurity'], domains: ['ssa.gov'] },
  { id: 'medicare', name: 'Medicare', kind: 'government', mentions: [/\bmedicare\b/i], tokens: ['medicare'], domains: ['medicare.gov', 'cms.gov'] },
  { id: 'dmv', name: 'the DMV', kind: 'government', mentions: [/\bDMV\b/, /\bdepartment of motor vehicles\b/i], tokens: ['dmv'], domains: [], govOk: true },
  { id: 'fbi', name: 'the FBI', kind: 'government', mentions: [/\bFBI\b/, /\bfederal bureau of investigation\b/i], tokens: ['fbi'], domains: ['fbi.gov', 'ic3.gov'] },

  // Delivery
  { id: 'usps', name: 'USPS', kind: 'delivery', mentions: [/\bUSPS\b/i, /\b(?:US|U\.S\.|united states) postal service\b/i], tokens: ['usps'], domains: ['usps.com', 'usps.gov'] },
  { id: 'ups', name: 'UPS', kind: 'delivery', mentions: [/\bUPS\b/], tokens: ['ups'], domains: ['ups.com'] },
  { id: 'fedex', name: 'FedEx', kind: 'delivery', mentions: [/\bfed ?ex\b/i], tokens: ['fedex'], domains: ['fedex.com'] },
  { id: 'dhl', name: 'DHL', kind: 'delivery', mentions: [/\bDHL\b/i], tokens: ['dhl'], domains: ['dhl.com'] },

  // Tolls
  { id: 'ezpass', name: 'E-ZPass', kind: 'toll', mentions: [/\be-?z ?pass\b/i], tokens: ['ezpass', 'e-zpass'], domains: ['e-zpassny.com', 'ezpassnj.com', 'ezpassva.com', 'ezpassmd.com', 'e-zpassiag.com'], govOk: true },
  { id: 'sunpass', name: 'SunPass', kind: 'toll', mentions: [/\bsun ?pass\b/i], tokens: ['sunpass'], domains: ['sunpass.com'], govOk: true },
  { id: 'fastrak', name: 'FasTrak', kind: 'toll', mentions: [/\bfas ?trak\b/i], tokens: ['fastrak'], domains: ['bayareafastrak.org', 'thetollroads.com'], govOk: true },
  { id: 'txtag', name: 'TxTag', kind: 'toll', mentions: [/\btx ?tag\b/i], tokens: ['txtag'], domains: ['txtag.org'], govOk: true },

  // Banks and payments
  { id: 'chase', name: 'Chase', kind: 'bank', mentions: [/\bChase\b(?! (?:me|you|him|her|them|it|after|down))/], tokens: ['chase'], domains: ['chase.com', 'jpmorganchase.com'] },
  { id: 'wellsfargo', name: 'Wells Fargo', kind: 'bank', mentions: [/\bwells fargo\b/i], tokens: ['wellsfargo'], domains: ['wellsfargo.com', 'wf.com'] },
  { id: 'bofa', name: 'Bank of America', kind: 'bank', mentions: [/\bbank of america\b/i, /\bBofA\b/i], tokens: ['bankofamerica', 'bofa'], domains: ['bankofamerica.com', 'bofa.com'] },
  { id: 'citi', name: 'Citi', kind: 'bank', mentions: [/\bciti(?:bank)?\b/i], tokens: ['citi', 'citibank'], domains: ['citi.com', 'citibank.com'] },
  { id: 'capitalone', name: 'Capital One', kind: 'bank', mentions: [/\bcapital one\b/i], tokens: ['capitalone'], domains: ['capitalone.com'] },
  { id: 'navyfederal', name: 'Navy Federal', kind: 'bank', mentions: [/\bnavy federal\b/i], tokens: ['navyfederal'], domains: ['navyfederal.org'] },
  { id: 'paypal', name: 'PayPal', kind: 'bank', mentions: [/\bpay ?pal\b/i], tokens: ['paypal'], domains: ['paypal.com', 'paypal.me'] },
  { id: 'venmo', name: 'Venmo', kind: 'bank', mentions: [/\bvenmo\b/i], tokens: ['venmo'], domains: ['venmo.com'] },
  { id: 'zelle', name: 'Zelle', kind: 'bank', mentions: [/\bzelle\b/i], tokens: ['zelle', 'zellepay'], domains: ['zellepay.com'] },
  { id: 'cashapp', name: 'Cash App', kind: 'bank', mentions: [/\bcash ?app\b/i], tokens: ['cashapp'], domains: ['cash.app', 'cash.me', 'squareup.com'] },
  { id: 'coinbase', name: 'Coinbase', kind: 'bank', mentions: [/\bcoinbase\b/i], tokens: ['coinbase'], domains: ['coinbase.com'] },

  // Tech and retail
  { id: 'microsoft', name: 'Microsoft', kind: 'tech', mentions: [/\bmicrosoft\b/i, /\bwindows (?:defender|security)\b/i], tokens: ['microsoft', 'msft', 'office365', 'windows'], domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com'] },
  { id: 'apple', name: 'Apple', kind: 'tech', mentions: [/\bapple (?:id|support|pay|care|account)\b/i, /\bicloud\b/i, /\bitunes\b/i], tokens: ['apple', 'appleid', 'icloud'], domains: ['apple.com', 'icloud.com'] },
  { id: 'google', name: 'Google', kind: 'tech', mentions: [/\bgoogle\b/i, /\bgmail\b/i], tokens: ['google', 'gmail'], domains: ['google.com', 'gmail.com', 'youtube.com', 'g.co'] },
  { id: 'geeksquad', name: 'Geek Squad', kind: 'tech', mentions: [/\bgeek ?squad\b/i], tokens: ['geeksquad'], domains: ['geeksquad.com', 'bestbuy.com'] },
  { id: 'norton', name: 'Norton', kind: 'tech', mentions: [/\bnorton\b/i], tokens: ['norton'], domains: ['norton.com'] },
  { id: 'mcafee', name: 'McAfee', kind: 'tech', mentions: [/\bmcafee\b/i], tokens: ['mcafee'], domains: ['mcafee.com'] },
  { id: 'amazon', name: 'Amazon', kind: 'retail', mentions: [/\bamazon\b/i], tokens: ['amazon', 'amzn'], domains: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.com.au', 'amazon.de', 'amazon.in', 'amzn.to', 'amzn.com', 'a.co'] },
  { id: 'walmart', name: 'Walmart', kind: 'retail', mentions: [/\bwalmart\b/i], tokens: ['walmart'], domains: ['walmart.com'] },
  { id: 'costco', name: 'Costco', kind: 'retail', mentions: [/\bcostco\b/i], tokens: ['costco'], domains: ['costco.com'] },
  { id: 'netflix', name: 'Netflix', kind: 'retail', mentions: [/\bnetflix\b/i], tokens: ['netflix'], domains: ['netflix.com'] },
  { id: 'facebook', name: 'Facebook', kind: 'tech', mentions: [/\bfacebook\b/i], tokens: ['facebook', 'fb'], domains: ['facebook.com', 'fb.com', 'fb.me', 'meta.com'] },
  { id: 'whatsapp', name: 'WhatsApp', kind: 'tech', mentions: [], tokens: ['whatsapp'], domains: ['whatsapp.com', 'wa.me'] },
];

// Only U.S. government bodies can register a .gov address.
export const GOV_SITE = { id: 'gov', name: 'a U.S. government', kind: 'government', mentions: [], tokens: [], domains: [] };

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'yandex.com', 'zoho.com',
]);

export function brandById(id) {
  return BRANDS.find((b) => b.id === id) || null;
}

export function isOfficialFor(brand, registrable) {
  if (!registrable) return false;
  if (brand.domains.includes(registrable)) return true;
  return Boolean(brand.govOk && registrable.endsWith('.gov'));
}

export function officialBrandFor(registrable) {
  if (!registrable) return null;
  return BRANDS.find((b) => b.domains.includes(registrable)) || null;
}

// Brands a message claims to come from, with where the name appears.
export function findBrandMentions(text) {
  const found = [];
  for (const brand of BRANDS) {
    for (const re of brand.mentions) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const m = new RegExp(re.source, flags).exec(text);
      if (m) {
        found.push({ brand, start: m.index, end: m.index + m[0].length });
        break;
      }
    }
  }
  return found;
}
