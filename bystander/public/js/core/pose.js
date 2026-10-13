// Geometry on MediaPipe pose landmarks (33 points, x and y normalized to the
// video frame). Points are converted to pixels first so angles are true
// angles on a non-square video.
//
// The camera watches the rescuer, ideally from the side. From one landmark set
// we read: where the hands are (the compression signal), how straight the
// elbows are, whether the shoulders are stacked over the hands, and whether
// the hands are on the chest point the rescuer marked.

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
};

// Bones drawn on the overlay.
export const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
];

const SIDES = {
  left: { shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST, hip: LM.L_HIP },
  right: { shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST, hip: LM.R_HIP },
};

export const MIN_VISIBILITY = 0.5;
// Locked elbows read about 170-180 degrees; below this they are clearly bent.
export const ELBOW_LOCKED_DEG = 150;
// Shoulder-to-hand line within this many degrees of vertical counts as "over the hands".
export const SHOULDERS_OVER_DEG = 25;
// Hands farther than this (in arm lengths, about 10 cm) from the marked chest point.
export const HANDS_OFF_TARGET = 0.18;

export function angleAt(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function toPx(lm, width, height) {
  if (!lm) return { x: NaN, y: NaN, v: 0, inFrame: false };
  return {
    x: lm.x * width,
    y: lm.y * height,
    v: lm.visibility ?? 1,
    inFrame: lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1,
  };
}

function armOf(landmarks, side, width, height) {
  const idx = SIDES[side];
  const p = (i) => toPx(landmarks[i], width, height);
  const arm = { side, shoulder: p(idx.shoulder), elbow: p(idx.elbow), wrist: p(idx.wrist), hip: p(idx.hip) };
  arm.score = Math.min(arm.shoulder.v, arm.elbow.v, arm.wrist.v);
  return arm;
}

// Returns one analyzed frame. `target` is the chest point the rescuer tapped,
// in normalized video coordinates, or null.
export function analyzePose(landmarks, { width, height, target = null } = {}) {
  if (!landmarks || landmarks.length < 25 || !(width > 0) || !(height > 0)) {
    return { visible: false, framing: 'no_person' };
  }
  const left = armOf(landmarks, 'left', width, height);
  const right = armOf(landmarks, 'right', width, height);
  const near = left.score >= right.score ? left : right;
  const far = near === left ? right : left;
  if (near.score < MIN_VISIBILITY) return { visible: false, framing: 'no_arms' };

  const armLen = distance(near.shoulder, near.elbow) + distance(near.elbow, near.wrist);
  if (!(armLen > 0)) return { visible: false, framing: 'no_arms' };

  const bothArms = far.score >= MIN_VISIBILITY;
  const hand = bothArms ? mid(near.wrist, far.wrist) : near.wrist;
  const shoulder = bothArms ? mid(near.shoulder, far.shoulder) : near.shoulder;

  // 0 degrees when the shoulders are straight above the hands.
  const dx = Math.abs(hand.x - shoulder.x);
  const dy = hand.y - shoulder.y;
  const armTilt = dy > 0 ? (Math.atan2(dx, dy) * 180) / Math.PI : 90;

  // From the side the two shoulders nearly overlap; from the front they are
  // about 0.7 arm lengths apart.
  const shoulderSpan = distance(left.shoulder, right.shoulder) / armLen;
  const sideView = shoulderSpan < 0.45;

  let framing = 'good';
  if (!near.shoulder.inFrame || !near.elbow.inFrame || !near.wrist.inFrame) framing = 'cut_off';
  else if (armLen < 0.12 * height) framing = 'too_far';
  else if (armLen > 0.7 * height) framing = 'too_close';

  let offTarget = null;
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    offTarget = distance(hand, { x: target.x * width, y: target.y * height }) / armLen;
  }

  return {
    visible: true,
    framing,
    side: near.side,
    handX: hand.x,
    handY: hand.y,
    armLen,
    elbowAngle: angleAt(near.shoulder, near.elbow, near.wrist),
    armTilt,
    handsApart: bothArms ? distance(near.wrist, far.wrist) / armLen : null,
    sideView,
    offTarget,
  };
}

// Form checks that are trustworthy from this frame. Elbow and shoulder
// checks need a side view; from the front, foreshortening makes them guesses.
export function formChecks(frame) {
  if (!frame?.visible) return { elbows: null, shoulders: null, hands: null };
  return {
    elbows: frame.sideView ? frame.elbowAngle >= ELBOW_LOCKED_DEG : null,
    shoulders: frame.sideView ? frame.armTilt <= SHOULDERS_OVER_DEG : null,
    hands: frame.offTarget === null ? null : frame.offTarget <= HANDS_OFF_TARGET,
  };
}

export const FRAMING_HINTS = {
  good: 'Tracking',
  no_person: 'Step into view',
  no_arms: 'I can’t see your arms',
  cut_off: 'Move so your arms are fully in view',
  too_far: 'Move the phone closer',
  too_close: 'Move the phone back',
};
