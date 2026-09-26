import { EXERCISES } from '../config';
import type { Assessment, Point, Pose } from './types';

const visible = (p?: Point) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.visibility >= EXERCISES.squat.visibility && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const segment = (a: Point, b: Point, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Measured limb lengths and planted ankles; no screen-position template. */
export function squatReference(pose: Pose, aspect: number): Pose[] {
  const side = [0, 1].find(s => [11, 23, 25, 27].every(i => visible(pose[i + s])));
  if (side === undefined) return [];
  const s = side, ankle = pose[27 + s], knee = pose[25 + s], hip = pose[23 + s], shoulder = pose[11 + s];
  const shin = segment(ankle, knee, aspect), thigh = segment(knee, hip, aspect), torso = segment(hip, shoulder, aspect);
  if (Math.min(shin, thigh, torso) < 0.01) return [];
  const foot = pose[31 + s];
  const direction = visible(foot) && Math.abs(foot.x - ankle.x) > 0.005 ? Math.sign(foot.x - ankle.x) : Math.sign(shoulder.x - hip.x) || 1;
  return [0, 1, 0].map(flex => {
    const ghost = pose.map(p => ({ ...p, visibility: 0 }));
    for (const side of [0, 1]) {
      const footAnchor = visible(pose[27 + side]) ? pose[27 + side] : ankle;
      const at = (x: number, y: number): Point => ({ x, y, visibility: 1 });
      const k = at(footAnchor.x + direction * shin * Math.sin(flex * 0.4) / aspect, footAnchor.y - shin * Math.cos(flex * 0.4));
      const h = at(k.x - direction * thigh * Math.sin(flex * 1.35) / aspect, k.y - thigh * Math.cos(flex * 1.35));
      const sh = at(h.x + direction * torso * Math.sin(flex * 0.35) / aspect, h.y - torso * Math.cos(flex * 0.35));
      ghost[27 + side] = { ...footAnchor, visibility: 1 }; ghost[25 + side] = k; ghost[23 + side] = h; ghost[11 + side] = sh;
      // Arms are optional, and use observed lengths when available.
      if (visible(pose[13 + side]) && visible(pose[15 + side])) {
        const upper = segment(pose[11 + side], pose[13 + side], aspect), lower = segment(pose[13 + side], pose[15 + side], aspect);
        ghost[13 + side] = at(sh.x + direction * upper * flex / aspect, sh.y + upper * (1 - flex));
        ghost[15 + side] = at(ghost[13 + side].x + direction * lower * flex / aspect, ghost[13 + side].y + lower * (1 - flex));
      }
    }
    return ghost;
  });
}

export class SquatVisuals {
  reset() {}
  update(pose: Pose, a: Assessment, aspect: number, _now: number): NonNullable<Assessment['squatVisual']> {
    const d = a.debug.squat;
    const missing = a.debug.landmarks.some(p => p.required && (!p.inFrame || p.visibility < EXERCISES.squat.visibility));
    const framing = missing || !pose.length || d?.state === 'FRAME_INVALID';
    const needsReference = !d?.coachingEnabled || !d.trackingReliable;
    return { reference: !framing && needsReference ? squatReference(pose, aspect) : [], recovery: [], recoveryPose: [], framing };
  }
}
