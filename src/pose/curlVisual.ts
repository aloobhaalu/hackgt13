import type { CameraView } from '../config';
import type { Point, Pose } from './types';

/** Project elbow flexion in front of the torso, not out into a lateral raise. */
export function curlWrist(elbow: Point, length: number, flex: number, view: CameraView, direction: number, aspect = 1): Point {
  const angle = (5 + flex * 155) * Math.PI / 180;
  const forward = Math.sin(angle) * length;
  // In front view most forward travel is depth, with a slight inward sweep.
  const horizontal = view === 'front' ? forward * 0.12 : forward;
  return { ...elbow, x: elbow.x + direction * horizontal / aspect,
    y: elbow.y + Math.cos(angle) * length,
    z: view === 'front' ? (elbow.z ?? 0) - forward * Math.sqrt(1 - 0.12 ** 2) : elbow.z };
}

export function curlFacing(pose: Pose): number {
  const visible = (i: number) => pose[i]?.visibility >= 0.45;
  if (visible(0)) {
    const ears = [7, 8].filter(visible);
    if (ears.length) {
      const dx = pose[0].x - ears.reduce((sum, i) => sum + pose[i].x, 0) / ears.length;
      if (Math.abs(dx) > 0.003) return Math.sign(dx);
    }
  }
  // Optional foot direction is useful when facial projection is ambiguous.
  for (const s of [0, 1]) if (visible(29 + s) && visible(31 + s)) {
    const dx = pose[31 + s].x - pose[29 + s].x;
    if (Math.abs(dx) > 0.003) return Math.sign(dx);
  }
  return 1;
}
