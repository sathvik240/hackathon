// Decides what the coach says, and when. A correction is spoken only after
// the problem has lasted a moment, the same line is not repeated too often,
// and there is always a pause between lines so the rescuer can follow the
// beat. Good pacing earns occasional praise.

import { AHA } from './compressions.js';
import { ELBOW_LOCKED_DEG, HANDS_OFF_TARGET, SHOULDERS_OVER_DEG } from './pose.js';

export const CUES = {
  start: { text: 'Push hard and fast in the center of the chest. Follow the beat.', kind: 'info' },
  frame: { text: 'I can’t see your arms. Move into the camera view.', kind: 'fix' },
  keepGoing: { text: 'Keep pushing. Don’t stop.', kind: 'fix' },
  faster: { text: 'Faster.', kind: 'fix' },
  slower: { text: 'Slower.', kind: 'fix' },
  elbows: { text: 'Lock your elbows.', kind: 'fix' },
  shoulders: { text: 'Shoulders over your hands.', kind: 'fix' },
  hands: { text: 'Hands back to the center of the chest.', kind: 'fix' },
  harder: { text: 'Push harder.', kind: 'fix' },
  switch: { text: 'Two minutes. If someone can take over compressions, switch now.', kind: 'info' },
  good: { text: 'Good.', kind: 'praise' },
};

const PRAISE = ['Good.', 'Good pace. Keep going.', 'That’s it.', 'Great rhythm.'];

// How long each problem must last before it is spoken (ms), in priority order.
const RULES = [
  ['frame', 2000],
  ['keepGoing', 0],
  ['faster', 1500],
  ['slower', 1500],
  ['elbows', 1500],
  ['shoulders', 2000],
  ['hands', 1500],
  ['harder', 3000],
];

const SHORT_DEPTH_CM = 4; // well under the 5 cm target, allowing for estimate error

export class Coach {
  constructor({ minGapMs = 2500, repeatGapMs = 6000, praiseGapMs = 9000, switchEveryMs = 120000 } = {}) {
    this.minGapMs = minGapMs;
    this.repeatGapMs = repeatGapMs;
    this.praiseGapMs = praiseGapMs;
    this.switchEveryMs = switchEveryMs;
    this.since = {};
    this.lastSaid = {};
    this.lastCueAt = -Infinity;
    this.praiseIndex = 0;
    this.switchCount = 0;
    this.active = [];
  }

  // m: { tracking, visible, count, lastAt, firstAt, rate, depthCm, elbowAngle,
  //      armTilt, sideView, offTarget }. Returns { id, text, kind } or null.
  update(m, now) {
    const lost = Boolean(m.tracking && !m.visible);
    const running = m.rate !== null && m.rate !== undefined && !lost;
    const conditions = {
      frame: lost,
      keepGoing: m.count > 0 && m.lastAt !== null && now - m.lastAt > 3000 && !lost,
      faster: running && m.rate < AHA.rateMin,
      slower: running && m.rate > AHA.rateMax,
      elbows: Boolean(running && m.visible && m.sideView && m.elbowAngle < ELBOW_LOCKED_DEG),
      shoulders: Boolean(running && m.visible && m.sideView && m.armTilt > SHOULDERS_OVER_DEG),
      hands: Boolean(running && m.visible && m.offTarget !== null && m.offTarget !== undefined && m.offTarget > HANDS_OFF_TARGET),
      harder: Boolean(running && m.visible && m.depthCm !== null && m.depthCm !== undefined && m.depthCm < SHORT_DEPTH_CM),
    };

    this.active = [];
    for (const [id, holdMs] of RULES) {
      if (!conditions[id]) {
        delete this.since[id];
        continue;
      }
      this.since[id] ??= now;
      if (now - this.since[id] >= holdMs) this.active.push(id);
    }

    if (now - this.lastCueAt < this.minGapMs) return null;

    // Every two minutes of compressions, prompt a swap: rescuers tire fast.
    if (m.firstAt !== null && m.firstAt !== undefined) {
      const due = Math.floor((now - m.firstAt) / this.switchEveryMs);
      if (due > this.switchCount) {
        this.switchCount = due;
        return this.say('switch', now);
      }
    }

    for (const id of this.active) {
      if (now - (this.lastSaid[id] ?? -Infinity) >= this.repeatGapMs) return this.say(id, now);
    }

    // Praise only when nothing is wrong, not even a problem still building up.
    const inTarget = running && m.rate >= AHA.rateMin && m.rate <= AHA.rateMax;
    const clean = !Object.values(conditions).some(Boolean);
    if (inTarget && clean && now - this.lastCueAt >= this.praiseGapMs) {
      const text = PRAISE[this.praiseIndex++ % PRAISE.length];
      this.lastCueAt = now;
      return { id: 'good', text, kind: 'praise' };
    }
    return null;
  }

  say(id, now) {
    this.lastSaid[id] = now;
    this.lastCueAt = now;
    return { id, ...CUES[id] };
  }
}
