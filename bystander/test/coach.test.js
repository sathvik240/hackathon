import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Coach } from '../public/js/core/coach.js';
import { scoreSession } from '../public/js/core/scorecard.js';

const good = { tracking: true, visible: true, count: 20, lastAt: 0, firstAt: 0, rate: 110, depthCm: 5.4, elbowAngle: 175, armTilt: 5, sideView: true, offTarget: null };

// Feeds the same metrics every 100 ms and collects what the coach says.
function drive(coach, metrics, fromMs, toMs) {
  const said = [];
  for (let t = fromMs; t <= toMs; t += 100) {
    const cue = coach.update({ ...metrics, lastAt: metrics.lastAt ?? t - 300 }, t);
    if (cue) said.push({ t, id: cue.id });
  }
  return said;
}

describe('coach', () => {
  it('says "faster" only after slow pacing lasts', () => {
    const coach = new Coach();
    const said = drive(coach, { ...good, rate: 88, lastAt: null }, 0, 3000);
    assert.equal(said[0].id, 'faster');
    assert.ok(said[0].t >= 1500);
  });

  it('says "slower" when too fast', () => {
    const said = drive(new Coach(), { ...good, rate: 135, lastAt: null }, 0, 3000);
    assert.equal(said[0].id, 'slower');
  });

  it('never talks over itself and does not nag', () => {
    const said = drive(new Coach(), { ...good, rate: 88, lastAt: null }, 0, 20000);
    for (let i = 1; i < said.length; i++) assert.ok(said[i].t - said[i - 1].t >= 2500);
    const faster = said.filter((s) => s.id === 'faster');
    for (let i = 1; i < faster.length; i++) assert.ok(faster[i].t - faster[i - 1].t >= 6000);
  });

  it('corrects form only from a side view', () => {
    assert.equal(drive(new Coach(), { ...good, elbowAngle: 130, lastAt: null }, 0, 3000)[0].id, 'elbows');
    const frontal = drive(new Coach(), { ...good, elbowAngle: 130, sideView: false, lastAt: null }, 0, 3000);
    assert.ok(!frontal.some((s) => s.id === 'elbows'));
  });

  it('praises good compressions now and then', () => {
    const said = drive(new Coach(), { ...good, lastAt: null }, 0, 30000);
    assert.ok(said.length >= 2 && said.length <= 4, `${said.length} cues`);
    assert.ok(said.every((s) => s.id === 'good'));
  });

  it('tells the rescuer to keep going after a pause', () => {
    const coach = new Coach();
    const cue = coach.update({ ...good, rate: null, lastAt: 1000 }, 4500);
    assert.equal(cue.id, 'keepGoing');
  });

  it('asks for the arms back in view before anything else', () => {
    const said = drive(new Coach(), { ...good, visible: false, rate: 88, lastAt: null }, 0, 3000);
    assert.equal(said[0].id, 'frame');
  });

  it('prompts a rescuer swap every two minutes', () => {
    const coach = new Coach();
    const said = drive(coach, { ...good, firstAt: 0, lastAt: null }, 0, 125000);
    assert.equal(said.filter((s) => s.id === 'switch').length, 1);
  });
});

function session({ rate = 110, seconds = 60, pauseAt = null, pauseS = 0, depthCm = 5.5 }) {
  const compressions = [];
  const iv = 60000 / rate;
  let t = 0;
  while (t < seconds * 1000) {
    if (pauseAt !== null && t >= pauseAt * 1000 && t < pauseAt * 1000 + iv) t += pauseS * 1000;
    compressions.push({ t, depthCm });
    t += iv;
  }
  return { compressions, startedAt: 0, endedAt: seconds * 1000 + pauseS * 1000 };
}

describe('scorecard', () => {
  it('passes high-quality CPR', () => {
    const r = scoreSession({ ...session({}), form: { elbowFrames: 100, elbowOk: 95, shoulderFrames: 100, shoulderOk: 90 } });
    assert.equal(r.headline, 'High-quality CPR');
    assert.equal(r.passed, r.graded);
    assert.equal(r.avgRate, 110);
    assert.ok(r.metrics.find((m) => m.id === 'depth').estimated);
  });

  it('fails slow compressions on rate', () => {
    const r = scoreSession(session({ rate: 85 }));
    assert.equal(r.metrics.find((m) => m.id === 'rate').ok, false);
    assert.equal(r.metrics.find((m) => m.id === 'onTarget').ok, false);
    assert.match(r.detail, /average rate/);
  });

  it('catches a long pause', () => {
    const r = scoreSession(session({ pauseAt: 20, pauseS: 12 }));
    assert.equal(r.metrics.find((m) => m.id === 'pause').ok, false);
    assert.ok(r.longestPauseS >= 12);
    assert.ok(r.fraction < 0.9);
  });

  it('counts stopping early as a pause', () => {
    const s = session({ seconds: 30 });
    const r = scoreSession({ ...s, endedAt: s.endedAt + 15000 });
    assert.equal(r.metrics.find((m) => m.id === 'pause').ok, false);
  });

  it('does not grade depth, which one camera cannot measure exactly', () => {
    const r = scoreSession(session({ depthCm: 3 }));
    assert.equal(r.metrics.find((m) => m.id === 'depth').ok, null);
    assert.equal(r.headline, 'High-quality CPR');
  });

  it('needs a few compressions to score', () => {
    const r = scoreSession({ compressions: [{ t: 0 }], startedAt: 0, endedAt: 5000 });
    assert.equal(r.metrics.length, 0);
    assert.match(r.headline, /Not enough/);
  });
});
