// Draws the tracked rescuer over the video: skeleton, the arm being judged,
// the hands, and the chest point the rescuer marked.

import { SKELETON } from '../core/pose.js';

const COLORS = {
  bone: 'rgba(255,255,255,0.55)',
  good: '#34d399',
  warn: '#fbbf24',
  hand: '#f43f5e',
  target: '#60a5fa',
};

export function drawPose(ctx, landmarks, { width, height, frame, checks, target, sim = false }) {
  if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
    ctx.canvas.width = width;
    ctx.canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  if (sim) drawSimScene(ctx, width, height);
  const unit = Math.max(2, Math.round(Math.min(width, height) / 160));

  if (target) {
    const x = target.x * width;
    const y = target.y * height;
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = unit;
    ctx.setLineDash([unit * 2, unit * 2]);
    ctx.beginPath();
    ctx.arc(x, y, (frame?.armLen || height * 0.3) * 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (!landmarks) return;

  const p = (i) => landmarks[i];
  const visible = (i) => p(i) && (p(i).visibility ?? 1) > 0.5;
  ctx.lineCap = 'round';
  ctx.lineWidth = unit * 1.5;
  ctx.strokeStyle = COLORS.bone;
  for (const [a, b] of SKELETON) {
    if (!visible(a) || !visible(b)) continue;
    ctx.beginPath();
    ctx.moveTo(p(a).x * width, p(a).y * height);
    ctx.lineTo(p(b).x * width, p(b).y * height);
    ctx.stroke();
  }

  if (frame?.visible) {
    const [s, e, w] = frame.side === 'left' ? [11, 13, 15] : [12, 14, 16];
    ctx.lineWidth = unit * 3;
    ctx.strokeStyle = checks?.elbows === false || checks?.shoulders === false ? COLORS.warn : COLORS.good;
    ctx.beginPath();
    ctx.moveTo(p(s).x * width, p(s).y * height);
    ctx.lineTo(p(e).x * width, p(e).y * height);
    ctx.lineTo(p(w).x * width, p(w).y * height);
    ctx.stroke();
    ctx.fillStyle = COLORS.hand;
    ctx.beginPath();
    ctx.arc(frame.handX, frame.handY, unit * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A floor and a "manikin" so the simulated rescuer reads as a scene.
function drawSimScene(ctx, width, height) {
  ctx.fillStyle = '#11151c';
  ctx.fillRect(0, 0, width, height);
  const floor = height * 0.81;
  ctx.fillStyle = '#1b2230';
  ctx.fillRect(0, floor, width, height - floor);
  ctx.fillStyle = '#2b3445';
  const chestTop = height * 0.71;
  ctx.beginPath();
  ctx.roundRect(width * 0.45, chestTop, width * 0.45, floor - chestTop, height * 0.03);
  ctx.fill();
}
