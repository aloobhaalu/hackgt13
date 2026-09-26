import { CONNECTIONS, type Assessment, type Correction, type Point, type Pose } from './types';

export function drawCorrection(ctx: CanvasRenderingContext2D, pose: Pose, c: Correction, width: number, height: number, time: number, subtle = false) {
  if(!Number.isFinite(c.severity) || c.severity<=0)return;
  const severity=Math.max(0,Math.min(1,c.severity));
  const opacity=0.4+severity*0.6;
  const fault=severity>=0.65?'#ff785e':'#ffa26b';
  const toeCue=c.id.startsWith('toe-direction-');
  const toPixel = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const from = toPixel(pose[c.joint]), target = toPixel(c.target), pivot = toPixel(pose[c.anchor]);
  const size = Math.max(1, Math.min(width, height) / 650);
  if (c.kind === 'instability') {
    // This marks irregular motion, not a positional target to chase.
    const radius = Math.max(5, Math.hypot(from.x - pivot.x, from.y - pivot.y) * 0.06);
    ctx.save(); ctx.strokeStyle = fault; ctx.lineWidth = (1+severity) * size;
    for (let ring = 0; ring < 2; ring++) {
      const phase = ((time / 900 + ring * 0.5) % 1);
      ctx.globalAlpha = (1 - phase) * opacity;
      ctx.beginPath(); ctx.arc(from.x, from.y, radius * (1 + phase), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore(); return;
  }
  const segment = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, lineWidth: number) => {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = lineWidth * size; ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha=opacity;
  if(c.id.startsWith('stance-')) {
    const side=c.joint-27,dx=target.x-from.x;
    // Foot placement highlights stay below the ankle; no orange shin/knee target.
    for(const i of [29+side,31+side]) if(pose[i]?.visibility>=0.45) {
      const foot=toPixel(pose[i]);
      segment(from,foot,fault,(subtle?2:3)+severity*2);
      segment(target,{x:foot.x+dx,y:foot.y},'#bcf6ac99',2);
    }
  }
  if (c.id === 'hip-line' || c.id === 'knee-line') {
    segment(toPixel(pose[c.anchor]), toPixel(pose[27 + (c.anchor - 11)]), '#8acfff66', 2);
  }
  // Highlight this issue's affected segment and its target.
  segment(pivot, from, fault, (subtle ? 2 : 3)+severity*2);
  const targetPivot=c.targetAnchor?toPixel(c.targetAnchor):pivot;
  segment(targetPivot, target, '#b9f5aa45', subtle ? 5 : 15);
  segment(targetPivot, target, '#bcf6ac99', 2);
  ctx.beginPath(); ctx.arc(from.x, from.y, (toeCue?5:7) * size, 0, Math.PI * 2);
  ctx.fillStyle = fault; ctx.fill(); ctx.strokeStyle = '#19251f'; ctx.lineWidth = 2 * size; ctx.stroke();

  // One continuous direction arrow, curved around the pivot for rotation issues.
  let tangent = from;
  let control: { x: number; y: number } | undefined;
  if (c.kind === 'rotation') {
    const middle = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 };
    const v = { x: middle.x - pivot.x, y: middle.y - pivot.y };
    const length = Math.max(1, Math.hypot(v.x, v.y));
    const bow = Math.max((toeCue?8:22) * size, Math.hypot(target.x - from.x, target.y - from.y) * 0.4);
    control = { x: middle.x + v.x / length * bow, y: middle.y + v.y / length * bow };
    tangent = control;
  }
  const drawArrow = () => {
    ctx.beginPath(); ctx.moveTo(from.x, from.y);
    if (control) ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
    else ctx.lineTo(target.x, target.y);
    ctx.stroke();
  };
  ctx.strokeStyle = '#0e1713dd'; ctx.lineWidth = (subtle ? 3 : 7) * size; drawArrow();
  ctx.globalAlpha=opacity*(1-severity*0.18+Math.sin(time/190)*severity*0.18);
  ctx.strokeStyle = '#bcf6ac'; ctx.lineWidth = ((subtle ? 1 : 2)+severity*1.5) * size; drawArrow();
  const direction = Math.atan2(target.y - tangent.y, target.x - tangent.x);
  const tip = { x: target.x - Math.cos(direction) * (toeCue?4:9) * size, y: target.y - Math.sin(direction) * (toeCue?4:9) * size };
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(direction - 0.5) * (toeCue?7:13) * size, tip.y - Math.sin(direction - 0.5) * (toeCue?7:13) * size);
  ctx.lineTo(tip.x - Math.cos(direction + 0.5) * (toeCue?7:13) * size, tip.y - Math.sin(direction + 0.5) * (toeCue?7:13) * size);
  ctx.closePath(); ctx.fillStyle = '#bcf6ac'; ctx.fill();

  // A visible destination, not just an unrelated ghost line.
  ctx.globalAlpha=opacity;
  const pulse = 1 + Math.sin(time / 190) * (0.06+severity*0.2);
  ctx.beginPath(); ctx.arc(target.x, target.y, (toeCue?9:15) * size * pulse, 0, Math.PI * 2);
  ctx.fillStyle = '#bcf6ac22'; ctx.fill(); ctx.strokeStyle = '#bcf6acbb'; ctx.lineWidth = 2 * size; ctx.stroke();
  ctx.beginPath(); ctx.arc(target.x, target.y, 6 * size, 0, Math.PI * 2);
  ctx.fillStyle = '#bcf6ac'; ctx.fill(); ctx.strokeStyle = '#142219'; ctx.lineWidth = 2 * size; ctx.stroke();
  ctx.restore();
}

export function drawPose(ctx: CanvasRenderingContext2D, pose: Pose, width: number, height: number, assessment?: Assessment, time = 0, silhouette = false) {
  if (pose.length < 33) {
    if (assessment?.squatVisual) drawSquatVisual(ctx, assessment.squatVisual, width, height, time);
    return;
  }
  const point = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const line = (a: Point, b: Point, color: string, lineWidth: number) => {
    const x = point(a), y = point(b);
    ctx.beginPath(); ctx.moveTo(x.x, x.y); ctx.lineTo(y.x, y.y); ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const low = assessment && !assessment.ready;
  const color = '#f0f5ef';
  ctx.globalAlpha = low && !assessment?.squatVisual ? 0.45 : 1;
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
  if (assessment?.squatVisual) drawSquatVisual(ctx, assessment.squatVisual, width, height, time);
  if (assessment && !low) {
    for (const correction of assessment.corrections ?? (assessment.correction ? [assessment.correction] : [])) {
      drawCorrection(ctx, pose, correction, width, height, time, !!assessment.squatVisual);
    }
  }
}

export function drawSquatVisual(ctx: CanvasRenderingContext2D, visual: NonNullable<Assessment['squatVisual']>, width: number, height: number, time: number) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pulse = 0.45 + 0.2 * Math.sin(time / 350);
  for (let index = 0; index < visual.reference.length; index++) {
    const ghost = visual.reference[index];
    // Start and return share the same planted-foot geometry; distinct colors and
    // travelling pulses show the out-and-back sequence without displacing feet.
    ctx.strokeStyle = index === 2 ? '#8acfff' : '#bcf6ac';
    ctx.globalAlpha = index === 0 ? pulse : 0.18;
    ctx.lineWidth = index === 2 ? 1 : 2;
    ctx.setLineDash(index === 2 ? [3, 7] : []);
    for (const [a, b] of CONNECTIONS) if (ghost[a]?.visibility && ghost[b]?.visibility) {
      ctx.beginPath(); ctx.moveTo(ghost[a].x * width, ghost[a].y * height); ctx.lineTo(ghost[b].x * width, ghost[b].y * height); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  if (visual.paths?.length) {
    const phase=(time%3600)/1800;
    const progress=(1-Math.cos(Math.PI*(phase<1?phase:2-phase)))/2;
    for(const path of visual.paths) {
      ctx.globalAlpha=0.35;ctx.strokeStyle='#8acfff';ctx.lineWidth=1;
      ctx.setLineDash([4,6]);ctx.lineDashOffset=-time/100;ctx.beginPath();
      path.forEach((p,i)=>i===0?ctx.moveTo(p.x*width,p.y*height):ctx.lineTo(p.x*width,p.y*height));ctx.stroke();
      const position=progress*(path.length-1),i=Math.min(Math.floor(position),path.length-2),t=position-i;
      const from=path[i],to=path[i+1];
      ctx.setLineDash([]);ctx.globalAlpha=0.7;ctx.fillStyle='#bcf6ac';
      ctx.beginPath();ctx.arc((from.x+(to.x-from.x)*t)*width,(from.y+(to.y-from.y)*t)*height,4,0,Math.PI*2);ctx.fill();
    }
  } else if (visual.reference.length === 3) {
    const j=visual.pathJoint ?? 23;
    const [start, bottom, end] = visual.reference;
    const phase = (time % 3600) / 1800;
    const from = phase < 1 ? start[j] : bottom[j], to = phase < 1 ? bottom[j] : end[j];
    const t = (1 - Math.cos(Math.PI * (phase % 1))) / 2;
    ctx.globalAlpha = 0.35; ctx.strokeStyle = '#8acfff'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]); ctx.lineDashOffset = -time / 100;
    ctx.beginPath(); ctx.moveTo(start[j].x * width, start[j].y * height); ctx.lineTo(bottom[j].x * width, bottom[j].y * height); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 0.7; ctx.fillStyle = '#bcf6ac';
    ctx.beginPath(); ctx.arc((from.x + (to.x - from.x) * t) * width, (from.y + (to.y - from.y) * t) * height, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.7;
  for (const cue of visual.recovery) drawCorrection(ctx, visual.recoveryPose, cue, width, height, time, true);
  if (visual.framing) {
    ctx.globalAlpha = pulse; ctx.strokeStyle = '#8acfff'; ctx.lineWidth = 2;
    for (const [x, y, sx, sy] of [[12, 12, 1, 1], [width - 12, 12, -1, 1], [12, height - 12, 1, -1], [width - 12, height - 12, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x + sx * 24, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * 24); ctx.stroke();
    }
  }
  ctx.restore();
}
