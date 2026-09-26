import { CONNECTIONS, type Assessment, type Correction, type Point, type Pose } from './types';

export function drawCorrection(ctx: CanvasRenderingContext2D, pose: Pose, c: Correction, width: number, height: number, time: number) {
  const toPixel = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const from = toPixel(pose[c.joint]), target = toPixel(c.target), pivot = toPixel(pose[c.anchor]);
  const size = Math.max(1, Math.min(width, height) / 650);
  const segment = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, lineWidth: number) => {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = lineWidth * size; ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // The only colored body segment is the one currently being corrected.
  segment(pivot, from, '#ffa26b', 5);
  segment(pivot, target, '#b9f5aa45', 15);
  segment(pivot, target, '#bcf6ac99', 2);
  ctx.beginPath(); ctx.arc(from.x, from.y, 7 * size, 0, Math.PI * 2);
  ctx.fillStyle = '#ffa26b'; ctx.fill(); ctx.strokeStyle = '#19251f'; ctx.lineWidth = 2 * size; ctx.stroke();

  // One continuous direction arrow, curved around the pivot for rotation issues.
  let tangent = from;
  let control: { x: number; y: number } | undefined;
  if (c.kind === 'rotation') {
    const middle = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 };
    const v = { x: middle.x - pivot.x, y: middle.y - pivot.y };
    const length = Math.max(1, Math.hypot(v.x, v.y));
    const bow = Math.max(22 * size, Math.hypot(target.x - from.x, target.y - from.y) * 0.4);
    control = { x: middle.x + v.x / length * bow, y: middle.y + v.y / length * bow };
    tangent = control;
  }
  const drawArrow = () => {
    ctx.beginPath(); ctx.moveTo(from.x, from.y);
    if (control) ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
    else ctx.lineTo(target.x, target.y);
    ctx.stroke();
  };
  ctx.strokeStyle = '#0e1713dd'; ctx.lineWidth = 7 * size; drawArrow();
  ctx.strokeStyle = '#bcf6ac'; ctx.lineWidth = 3 * size; drawArrow();
  const direction = Math.atan2(target.y - tangent.y, target.x - tangent.x);
  const tip = { x: target.x - Math.cos(direction) * 9 * size, y: target.y - Math.sin(direction) * 9 * size };
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(direction - 0.5) * 13 * size, tip.y - Math.sin(direction - 0.5) * 13 * size);
  ctx.lineTo(tip.x - Math.cos(direction + 0.5) * 13 * size, tip.y - Math.sin(direction + 0.5) * 13 * size);
  ctx.closePath(); ctx.fillStyle = '#bcf6ac'; ctx.fill();

  // A visible destination, not just an unrelated ghost line.
  const pulse = 1 + Math.sin(time / 190) * 0.18;
  ctx.beginPath(); ctx.arc(target.x, target.y, 15 * size * pulse, 0, Math.PI * 2);
  ctx.fillStyle = '#bcf6ac22'; ctx.fill(); ctx.strokeStyle = '#bcf6acbb'; ctx.lineWidth = 2 * size; ctx.stroke();
  ctx.beginPath(); ctx.arc(target.x, target.y, 6 * size, 0, Math.PI * 2);
  ctx.fillStyle = '#bcf6ac'; ctx.fill(); ctx.strokeStyle = '#142219'; ctx.lineWidth = 2 * size; ctx.stroke();
  ctx.restore();
}

export function drawPose(ctx: CanvasRenderingContext2D, pose: Pose, width: number, height: number, assessment?: Assessment, time = 0, silhouette = false) {
  if (pose.length < 33) return;
  const point = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const line = (a: Point, b: Point, color: string, lineWidth: number) => {
    const x = point(a), y = point(b);
    ctx.beginPath(); ctx.moveTo(x.x, x.y); ctx.lineTo(y.x, y.y); ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const low = assessment && !assessment.ready;
  const color = '#f0f5ef';
  ctx.globalAlpha = low ? 0.45 : 1;
  if (silhouette) {
    for (const [a, b] of CONNECTIONS) line(pose[a], pose[b], '#9bb1a016', Math.max(12, width * 0.039));
  }
  for (const [a, b] of CONNECTIONS) if (pose[a].visibility > 0.4 && pose[b].visibility > 0.4) line(pose[a], pose[b], color, Math.max(2, width * 0.004));
  if (pose[0].visibility > 0.4) {
    const mid = { ...pose[11], x: (pose[11].x + pose[12].x) / 2, y: (pose[11].y + pose[12].y) / 2 };
    line(mid, pose[0], color, Math.max(2, width * 0.004));
    const head = point(pose[0]); ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(7, width * 0.021), 0, Math.PI * 2);
    ctx.fillStyle = '#171e1a'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (pose[i].visibility < 0.4) continue;
    const q = point(pose[i]); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(3, width * 0.006), 0, Math.PI * 2);
    ctx.fillStyle = '#161e1a'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.stroke();
  }
  ctx.restore();
  if (assessment?.correction && !low) drawCorrection(ctx, pose, assessment.correction, width, height, time);
}
