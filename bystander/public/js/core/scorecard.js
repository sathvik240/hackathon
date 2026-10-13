// Scores a CPR session against American Heart Association adult targets.
// Depth comes from a single camera, so it is shown as an estimate and left
// out of the pass count.

import { AHA, PAUSE_MS, median } from './compressions.js';

const pct = (part, whole) => (whole > 0 ? Math.round((100 * part) / whole) : null);

// compressions: [{ t, depthCm }] in time order. form: { elbowFrames, elbowOk,
// shoulderFrames, shoulderOk } counted during compressions. Times in ms.
export function scoreSession({ compressions = [], startedAt, endedAt, form = {} }) {
  const n = compressions.length;
  const durationS = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (n < 3) {
    return {
      count: n,
      durationS,
      metrics: [],
      passed: 0,
      graded: 0,
      headline: 'Not enough compressions to score',
      detail: 'Do at least 10 seconds of compressions with your arms in view.',
    };
  }

  const first = compressions[0].t;
  const last = compressions[n - 1].t;
  const intervals = [];
  for (let i = 1; i < n; i++) intervals.push(compressions[i].t - compressions[i - 1].t);
  const running = intervals.filter((iv) => iv <= PAUSE_MS);
  const handsOnMs = running.reduce((a, b) => a + b, 0);

  // Pauses: gaps inside the session plus a stop before the end.
  const tail = Math.max(0, endedAt - last);
  const pauses = intervals.filter((iv) => iv > PAUSE_MS);
  if (tail > PAUSE_MS) pauses.push(tail);
  const longestPauseS = pauses.length ? Math.round(Math.max(...pauses) / 100) / 10 : 0;

  // Compression fraction: hands-on time over the time since CPR began.
  const spanMs = Math.max(endedAt, last) - first;
  const fraction = spanMs > 0 ? Math.min(1, handsOnMs / spanMs) : 1;

  const avgRate = running.length ? Math.round((60000 * running.length) / handsOnMs) : null;
  // A stroke is "on target" when the rate over it and its neighbours is in range,
  // which smooths out the jitter of a single stroke.
  let onTarget = 0;
  for (let i = 0; i < intervals.length; i++) {
    const window = intervals.slice(Math.max(0, i - 1), i + 2).filter((iv) => iv <= PAUSE_MS);
    if (intervals[i] > PAUSE_MS || !window.length) continue;
    const r = 60000 / median(window);
    if (r >= AHA.rateMin && r <= AHA.rateMax) onTarget++;
  }
  const onTargetPct = pct(onTarget, running.length);

  const depths = compressions.map((c) => c.depthCm).filter(Number.isFinite);
  const depthCm = depths.length ? Math.round(median(depths) * 10) / 10 : null;
  const depthOkPct = pct(depths.filter((d) => d >= AHA.depthMinCm && d <= AHA.depthMaxCm).length, depths.length);

  const metrics = [
    {
      id: 'rate',
      label: 'Average rate',
      value: avgRate === null ? '—' : `${avgRate}/min`,
      target: `${AHA.rateMin}–${AHA.rateMax}/min`,
      ok: avgRate !== null && avgRate >= AHA.rateMin && avgRate <= AHA.rateMax,
      source: 'AHA',
    },
    {
      id: 'onTarget',
      label: 'Compressions at the right speed',
      value: onTargetPct === null ? '—' : `${onTargetPct}%`,
      target: '80% or more',
      ok: onTargetPct !== null && onTargetPct >= 80,
      source: 'Coaching goal',
    },
    {
      id: 'fraction',
      label: 'Hands-on time',
      value: `${Math.round(fraction * 100)}%`,
      target: `${AHA.fractionMin * 100}% minimum, ${AHA.fractionGoal * 100}% goal`,
      ok: fraction >= AHA.fractionMin,
      source: 'AHA',
    },
    {
      id: 'pause',
      label: 'Longest pause',
      value: `${longestPauseS} s`,
      target: `under ${AHA.maxPauseS} s`,
      ok: longestPauseS < AHA.maxPauseS,
      source: 'AHA',
    },
  ];

  if (form.elbowFrames > 0) {
    const elbowPct = pct(form.elbowOk, form.elbowFrames);
    metrics.push({
      id: 'elbows',
      label: 'Elbows locked',
      value: `${elbowPct}%`,
      target: '80% or more',
      ok: elbowPct >= 80,
      source: 'Coaching goal',
    });
  }
  if (form.shoulderFrames > 0) {
    const shoulderPct = pct(form.shoulderOk, form.shoulderFrames);
    metrics.push({
      id: 'shoulders',
      label: 'Shoulders over hands',
      value: `${shoulderPct}%`,
      target: '80% or more',
      ok: shoulderPct >= 80,
      source: 'Coaching goal',
    });
  }

  metrics.push({
    id: 'depth',
    label: 'Depth (estimated)',
    value: depthCm === null ? '—' : `~${depthCm} cm`,
    target: `${AHA.depthMinCm}–${AHA.depthMaxCm} cm`,
    ok: null,
    estimated: true,
    note: `A single camera can’t measure depth exactly. ${depthOkPct ?? 0}% of strokes looked in range.`,
    source: 'AHA',
  });

  const graded = metrics.filter((m) => m.ok !== null);
  const passed = graded.filter((m) => m.ok).length;
  const ratio = passed / graded.length;
  const headline = ratio === 1 ? 'High-quality CPR' : ratio >= 0.6 ? 'Good CPR, with fixes' : 'Keep practicing';
  const fixes = graded.filter((m) => !m.ok).map((m) => m.label.toLowerCase());
  const detail = fixes.length ? `Work on: ${fixes.join(', ')}.` : 'Every graded target met.';

  return { count: n, durationS, avgRate, fraction, longestPauseS, depthCm, metrics, passed, graded: graded.length, headline, detail };
}
