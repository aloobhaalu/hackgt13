export type Point = { x: number; y: number; z?: number; visibility: number };
export type Pose = Point[];
export type Correction = {
  id: string; label: string; joint: number; anchor: number; target: Point; targetAnchor?: Point;
  severity: number; kind: 'translation' | 'rotation' | 'instability';
};
export type ScoreComponent = { id: string; value: number | null; limit: number; error: number; score: number | null };
export type SquatCycleDebug = {
  state:string; blockReason:string; lastFailure:string|null;
  calibrated:boolean; bottomConfirmed:boolean; ascentConfirmationMs:number;
};
export type CurlCycleDebug = {
  state:string; calibrated:boolean; validCycle:boolean; topConfirmed:boolean;
  blockReason:string; lastFailure:string|null; returnConfirmationMs:number;
};
export type DebugData = {
  exercise?: string; view?: string; state?: string; viewValid?: boolean; trackingGapMs?:number;
  coachingEnabled?: boolean; scoringEnabled?: boolean; scoreUpdatedAt?: number | null;
  curlCycle?:CurlCycleDebug;
  curlPartial?: { count:number; severityTotal:number; maxSeverity:number };
  squat?: SquatDebug; squatCycle?:SquatCycleDebug;
  landmarks: { index: number; name: string; visibility: number; inFrame: boolean; required: boolean }[];
  angles: Record<string, number>;
  rawAngles?: Record<string, number>;
  components: ScoreComponent[];
  reason: string;
  validMovement: boolean;
  rawScore: number | null;
  stableFrames: number;
};
export type SquatState = 'FRAME_INVALID' | 'CALIBRATING_STANDING' | 'DESCENDING' | 'HOLDING' | 'ASCENDING' | 'EXIT';
export type SquatDebug = {
  cycle?:SquatCycleDebug;
  scoreUpdatedAt?: number | null;
  coachingEnabled?: boolean;
  state: SquatState; source: 'world' | 'normalized' | null;
  kneeAngle: number | null; hipAngle: number | null; torsoTilt: number | null;
  hipDrop: number | null; hipVelocity: number | null; kneeVelocity: number | null;
  baselineDetected: boolean; sideOn: boolean; reason: string;
  leftKneeAngle: number | null; rightKneeAngle: number | null;
  shoulderRatio: number | null; hipRatio: number | null;
  trackingReliable: boolean; rotateSideways: boolean; footPoints: number;
  landmarkConfidence: number;
  baseline: { knee: number; hip: number; height: number; leg: number; tilt: number; confidence: number; feet: Record<number, Point> } | null;
  holdConfirmationMs: number; evaluatedAt: number | null; activeCorrections: string[];
  heelLift?: { baseline: { heel: number; ankle: number } | null; lift: number | null; reason: string };
};
export type Assessment = {
  ready: boolean; confidence: number; reason: string; score: number | null;
  scoreStatus?: 'ready' | 'uncertain' | 'live'; holdMs?: number;
  phase: 'Ready' | 'Lower' | 'Hold' | 'Rise' | 'Curl' | 'Release' | 'Pull' | 'Return';
  correction: Correction | null; confirmed: boolean;
  corrections?: Correction[];
  guidance?: string[];
  squatVisual?: { reference: Pose[]; recovery: Correction[]; recoveryPose: Pose; framing: boolean; pathJoint?: number; paths?: Point[][] };
  framingWarning: boolean; debug: DebugData;
};
export const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32]];
