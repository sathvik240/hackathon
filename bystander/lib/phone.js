// The caller must never dial a real emergency number. Bystander only calls
// the one number set in the server's environment, and that number has to be
// a full international (E.164) number, which rules out every short code
// like 911, 112, 999, or 000.

// Short emergency and service codes used around the world.
const EMERGENCY_CODES = new Set([
  '911', '933', '112', '999', '000', '110', '119', '120', '122', '100', '101', '102', '103', '108', '111', '113', '115', '117', '118', '123', '155', '190', '191', '192', '193', '194', '995', '997', '998',
]);

export function normalizeNumber(raw) {
  return String(raw || '').trim().replace(/[\s().-]/g, '');
}

export function checkDialable(raw) {
  const number = normalizeNumber(raw);
  if (!number) return { ok: false, reason: 'No dispatcher number is set.' };
  const digits = number.replace(/^\+/, '');
  if (EMERGENCY_CODES.has(digits) || EMERGENCY_CODES.has(digits.replace(/^1/, ''))) {
    return { ok: false, reason: 'Bystander never calls emergency numbers. Use a teammate’s phone for demos.' };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    return { ok: false, reason: 'Use a full international number, like +14155550123.' };
  }
  // North American numbers: area codes of the form N11 (211-911) are service
  // codes and never real area codes.
  if (/^\+1[2-9]11/.test(number)) {
    return { ok: false, reason: 'That looks like a service code, not a phone number.' };
  }
  return { ok: true, number };
}

export function maskNumber(raw) {
  const n = normalizeNumber(raw);
  return n.length > 4 ? `${'•'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}` : n;
}
