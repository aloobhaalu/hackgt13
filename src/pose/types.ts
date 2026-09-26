export type Point = { x: number; y: number; z?: number; visibility: number };
export type Pose = Point[];
export type Correction = {
  id: string; label: string; joint: number; anchor: number; target: Point;
  severity: number; kind: 'translation' | 'rotation';
};
export type ScoreComponent = { id: string; value: number | null; limit: number; error: number; score: number | null };
export type DebugData = {
  squat?: SquatDebug;
  landmarks: { index: number; name: string; visibility: number; inFrame: boolean; required: boolean }[];
  angles: Record<string, number>;
  components: ScoreComponent[];
  reason: string;
  validMovement: boolean;
  rawScore: number | null;
  stableFrames: number;
};
export type SquatState = 'FRAME_INVALID' | 'WAITING_FOR_START_POSE' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING' | 'VALID_REP' | 'NOT_SQUAT_MOVEMENT';
export type SquatDebug = {
  state: SquatState; source: 'world' | 'normalized' | null;
  kneeAngle: number | null; hipAngle: number | null; torsoTilt: number | null;
  hipDrop: number | null; hipVelocity: number | null; kneeVelocity: number | null;
  baselineDetected: boolean; sideOn: boolean; reason: string;
  leftKneeAngle: number | null; rightKneeAngle: number | null;
  shoulderRatio: number | null; hipRatio: number | null;
  trackingReliable: boolean; rotateSideways: boolean; footPoints: number;
};
export type Assessment = {
  ready: boolean; confidence: number; reason: string; score: number | null;
  reps: number; phase: 'Ready' | 'Lower' | 'Rise' | 'Curl' | 'Release' | 'Pull' | 'Return';
  correction: Correction | null; confirmed: boolean;
  framingWarning: boolean; debug: DebugData;
};
export const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32]];
