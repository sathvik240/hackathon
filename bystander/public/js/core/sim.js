// A synthetic rescuer seen from the side, for demos without a camera and for
// tests. It produces the same 33-point landmark list MediaPipe does, so the
// whole pipeline (pose analysis, compression detection, coaching, caller)
// runs unchanged.

export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// t in ms. Options (all can change between calls):
//   rate       compressions per minute (0 = hands resting on the chest)
//   phase      stroke phase 0-1; pass an accumulated phase when the rate changes live
//   depthCm    stroke depth
//   elbowBend  degrees the elbows are bent (0 = locked)
//   lean       how far the shoulders sit behind the hands, in degrees
//   noise      landmark jitter as a fraction of frame height
export function simulatedPose(t, {
  rate = 110,
  depthCm = 5.5,
  elbowBend = 0,
  lean = 5,
  noise = 0.003,
  width = 720,
  height = 1280,
  armCm = 58,
  rng = Math.random,
  phase = null,
} = {}) {
  const armPx = 0.3 * height;
  const cmToPx = armPx / armCm;
  // Depth of the hands below the top of the stroke, in pixels.
  const p = phase ?? ((t / 60000) * rate) % 1;
  const push = rate > 0 ? depthCm * cmToPx * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)) : 0;

  const hand = { x: 0.55 * width, y: 0.7 * height + push };
  const leanRad = (lean * Math.PI) / 180;
  const bendRad = (elbowBend * Math.PI) / 180;
  // With bent elbows the shoulder sits closer to the hands.
  const reach = armPx * Math.cos(bendRad / 2);
  const shoulder = { x: hand.x - reach * Math.sin(leanRad), y: hand.y - reach * Math.cos(leanRad) };
  const elbowOut = (armPx / 2) * Math.sin(bendRad / 2);
  const elbow = {
    x: (hand.x + shoulder.x) / 2 + elbowOut * Math.cos(leanRad),
    y: (hand.y + shoulder.y) / 2 - elbowOut * Math.sin(leanRad),
  };
  const hip = { x: shoulder.x - 0.28 * height, y: shoulder.y + 0.12 * height };
  const knee = { x: hip.x + 0.02 * height, y: hip.y + 0.28 * height };
  const ankle = { x: knee.x - 0.2 * height, y: knee.y + 0.01 * height };
  const head = { x: shoulder.x + 0.06 * height, y: shoulder.y - 0.06 * height };

  const jitter = () => noise * height * gaussian(rng);
  const point = (p, visibility, dx = 0) => ({
    x: (p.x + dx + jitter()) / width,
    y: (p.y + jitter()) / height,
    z: 0,
    visibility,
  });

  const lm = new Array(33);
  for (let i = 0; i <= 10; i++) lm[i] = point(head, 0.95, (i - 5) * 2);
  // Right side faces the camera; the left side is mostly hidden behind it.
  lm[12] = point(shoulder, 0.98);
  lm[14] = point(elbow, 0.97);
  lm[16] = point(hand, 0.97);
  lm[11] = point(shoulder, 0.6, -6);
  lm[13] = point(elbow, 0.55, -6);
  lm[15] = point(hand, 0.55, -4);
  for (const [l, r] of [[17, 18], [19, 20], [21, 22]]) {
    lm[l] = point(hand, 0.5, -4);
    lm[r] = point(hand, 0.9);
  }
  lm[24] = point(hip, 0.95);
  lm[23] = point(hip, 0.6, -6);
  lm[26] = point(knee, 0.9);
  lm[25] = point(knee, 0.6, -6);
  for (const i of [27, 29, 31]) lm[i] = point(ankle, 0.5, -6);
  for (const i of [28, 30, 32]) lm[i] = point(ankle, 0.8);
  return lm;
}
