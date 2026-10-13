import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePose, angleAt, formChecks } from '../public/js/core/pose.js';
import { CompressionDetector, median } from '../public/js/core/compressions.js';
import { seededRandom, simulatedPose } from '../public/js/core/sim.js';

// Runs the simulated rescuer through pose analysis and the detector.
function simulate({ rate = 110, fps = 30, seconds = 30, noise = 0.003, depthCm = 5.5, elbowBend = 0, seed = 7, width = 720, height = 1280 } = {}) {
  const rng = seededRandom(seed);
  const detector = new CompressionDetector();
  let frame;
  const end = seconds * 1000;
  for (let t = 0; t < end; t += 1000 / fps) {
    frame = analyzePose(simulatedPose(t, { rate, noise, depthCm, elbowBend, rng, width, height }), { width, height });
    if (frame.visible) detector.push(t, frame.handY, frame.armLen);
  }
  return { detector, frame, end };
}

describe('pose geometry', () => {
  it('measures the angle at a joint', () => {
    assert.equal(Math.round(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })), 180);
    assert.equal(Math.round(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })), 90);
  });

  it('reads locked elbows and a side view from the simulated rescuer', () => {
    const frame = analyzePose(simulatedPose(0, { noise: 0 }), { width: 720, height: 1280 });
    assert.equal(frame.visible, true);
    assert.equal(frame.framing, 'good');
    assert.equal(frame.sideView, true);
    assert.ok(frame.elbowAngle > 170, `elbow ${frame.elbowAngle}`);
    assert.ok(frame.armTilt < 10, `tilt ${frame.armTilt}`);
    assert.deepEqual(formChecks(frame), { elbows: true, shoulders: true, hands: null });
  });

  it('flags bent elbows and shoulders behind the hands', () => {
    const frame = analyzePose(simulatedPose(0, { noise: 0, elbowBend: 50, lean: 35 }), { width: 720, height: 1280 });
    const checks = formChecks(frame);
    assert.equal(checks.elbows, false);
    assert.equal(checks.shoulders, false);
  });

  it('checks the hands against the marked chest point', () => {
    const lm = simulatedPose(0, { noise: 0 });
    const on = analyzePose(lm, { width: 720, height: 1280, target: { x: 0.55, y: 0.7 } });
    const off = analyzePose(lm, { width: 720, height: 1280, target: { x: 0.75, y: 0.7 } });
    assert.equal(formChecks(on).hands, true);
    assert.equal(formChecks(off).hands, false);
  });

  it('reports framing problems instead of guessing', () => {
    assert.equal(analyzePose(null, { width: 720, height: 1280 }).visible, false);
    const hidden = simulatedPose(0, { noise: 0 }).map((p) => ({ ...p, visibility: 0.1 }));
    assert.equal(analyzePose(hidden, { width: 720, height: 1280 }).framing, 'no_arms');
    const tiny = simulatedPose(0, { noise: 0, width: 720, height: 1280 }).map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.3, y: 0.5 + (p.y - 0.5) * 0.3 }));
    assert.equal(analyzePose(tiny, { width: 720, height: 1280 }).framing, 'too_far');
  });
});

describe('compression detection', () => {
  for (const [rate, fps] of [[110, 30], [80, 15], [140, 60], [105, 12], [118, 24]]) {
    it(`counts ${rate}/min at ${fps} fps`, () => {
      const { detector, end } = simulate({ rate, fps });
      const expected = Math.round((rate * end) / 60000);
      assert.ok(Math.abs(detector.count - expected) <= 1, `counted ${detector.count}, expected ${expected}`);
      const measured = detector.rate(end - 50);
      assert.ok(Math.abs(measured - rate) <= 4, `rate ${measured}, expected ${rate}`);
    });
  }

  it('works in landscape video too', () => {
    const { detector, end } = simulate({ rate: 110, width: 1280, height: 720 });
    assert.ok(Math.abs(detector.count - 55) <= 1, `counted ${detector.count}`);
  });

  it('estimates depth within about a centimeter', () => {
    for (const depthCm of [3, 5, 6]) {
      const { detector } = simulate({ depthCm, noise: 0.002 });
      assert.ok(Math.abs(detector.depth() - depthCm) <= 1, `depth ${detector.depth()} for ${depthCm}`);
    }
  });

  it('ignores a still rescuer', () => {
    const { detector } = simulate({ rate: 0, noise: 0.002 });
    assert.equal(detector.count, 0);
  });

  it('reports no rate while paused and resumes after', () => {
    const detector = new CompressionDetector();
    const rng = seededRandom(3);
    let t = 0;
    const run = (ms, rate) => {
      for (const stop = t + ms; t < stop; t += 33) {
        const f = analyzePose(simulatedPose(t, { rate, rng }), { width: 720, height: 1280 });
        detector.push(t, f.handY, f.armLen);
      }
    };
    run(10000, 110);
    assert.ok(detector.rate(t) > 100);
    run(4000, 0);
    assert.equal(detector.rate(t), null);
    run(5000, 110);
    assert.ok(detector.rate(t) > 100);
  });

  it('restarts cleanly after tracking is lost', () => {
    const detector = new CompressionDetector();
    detector.push(0, 100, 300);
    detector.push(33, 130, 300);
    const before = detector.count;
    // A one-second gap, then the hands reappear far away: no phantom compression.
    assert.equal(detector.push(1033, 400, 300), null);
    assert.equal(detector.count, before);
  });

  it('takes the median', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), null);
  });
});
