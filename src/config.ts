export const BRAND = { name: 'FormFlow', tagline: 'See your form.\nFind your flow.' };
export type ExerciseId = 'squat' | 'curl' | 'plank';
export type CameraView = 'side' | 'front';
export const VIEW = { frontMinSpread: 0.65, sideMaxSpread: 0.6, confirmMs: 400 };
export const FRONT_SQUAT = {
  baselineMs: 1500, baselineRange: 0.025, uprightKnee: 155, minDrop: 0.08,
  kneeBend: 12, holdMs: 400, holdRange: 0.025, returnDrop: 0.04,
  stanceMin: 0.8, stanceMax: 1.8, kneeTrack: 0.28, symmetry: 0.12, balance: 0.25,
  stability: 0.015, maxFootTravel: 0.25, timeoutMs: 14000,
};

// Prototype heuristics, not clinical or universal movement standards.
// Angles are degrees. Curl/plank distances use torso or body length; squats use baseline leg length.
export const EXERCISES = {
  squat: {
    name: 'Bodyweight squat', short: 'Squat', angle: 'Side view recommended', recommendedView: 'side',
    maxLean: 48, depthAngle: 115,
    visibility: 0.45,
    frameTolerance: 0.02, framingHoldMs: 500, framingLossMs: 500, landmarkSmoothing: 0.32,
    torsoTargetRatio: 0.7,
    depthKneeWeight: 0.5, depthDropWeight: 0.5,
    holdConfirmMs: 400, holdEvaluationMs: 600, holdSampleWindow: 5,
    holdMinKneeBend: 35, holdMinHipDrop: 0.14,
    holdExitHipSpeed: 0.16, holdExitKneeSpeed: 22,
    holdExitHipRange: 0.06, holdExitKneeRange: 12,
    holdStableHipRange: 0.008, holdStableKneeRange: 2,
    holdMaxHipRange: 0.03, holdMaxKneeRange: 8,
    holdChangeAngle: 2, holdChangeDrop: 0.01, holdChangeStability: 0.08,
    holdIssueThreshold: 0.04,
    holdWeights: { depth: 0.5, torso: 0.3, stability: 0.2 },
    // Squat classifier: distances/speeds below are normalized by baseline leg length.
    startKneeMin: 150, startHipMin: 150, startTorsoMax: 25,
    baselineHoldMs: 1500, baselineHipRange: 0.035,
    baselineHipSpeed: 0.08, baselineKneeSpeed: 14,
    sideShoulderRatioMax: 0.58, sideHipRatioMax: 0.5, // Allow a slightly angled profile.
    featureWindow: 3, trackingGraceMs: 180,
    footVisibility: 0.6, depthTargetDrop: 0.07,
    heelVisibility: 0.75, heelBaselineMs: 650, heelBaselineRange: 0.012,
    heelLiftMin: 0.025, heelLiftRelease: 0.015, heelAnkleLiftMin: 0.012,
    heelConfirmMs: 260, heelToeTravelMax: 0.04,
    heelFootLengthMin: 0.08, heelFootLengthMax: 0.4, heelFootScaleChange: 0.35,
    featureSmoothing: 0.35, velocitySmoothing: 0.3,
    minHipDrop: 0.08, minKneeBend: 15, minHipBend: 8,
    directionHipSpeed: 0.025, directionKneeSpeed: 5, directionHoldMs: 130,
    targetHipDrop: 0.3,
    ascentDrop: 0.035, ascentKneeExtension: 5,
    finishHoldMs: 200, maxSequenceMs: 12000,
    maxFrameGapMs: 350,
    maxHipSpeed: 1.6, maxKneeSpeed: 260,
    minHipHeight: 0.22, minShinHeight: 0.15,
    maxFootTravel: 0.22, maxHipTravel: 0.65, maxLegScaleChange: 0.35,
    depthPenaltyRange: 30, dropPenaltyRange: 0.2, torsoPenaltyRange: 25,
  },
  curl: {
    name: 'Standing Dumbbell Bicep Curl', short: 'Dumbbell curl', angle: 'Front view recommended', recommendedView: 'front',
    phaseStart: 150, phaseEnd: 65,
    maxLean: 12, elbowDrift: 0.38, asymmetry: 28,
    readyMs: 500, movementBend: 18, phaseMs: 180, timeoutMs: 10000,
    maxSpeed: 220, upperArmDrift: 0.2, stability: 0.035,
  },
  plank: {
    name: 'High Plank', short: 'High plank', angle: 'Side view recommended', recommendedView: 'side',
    holdMs: 450, stability: 0.018, holdMotionMax: 0.055,
    bodyHorizontalMax: 45, minBodySpan: 1.6, minKneeAngle: 125, minElbowAngle: 145,
    hipOffset: 0.085, kneeOffset: 0.07, handOffset: 0.4,
    frontDepthMin: 0.7, symmetry: 0.15, balance: 0.22,
  },
} as const;

export const TRACKING = {
  visibility: 0.45,
  frameTolerance: 0.02,       // Allow small coordinate noise at image boundaries.
  framingHoldMs: 500,         // Good body landmarks before first assessment.
  framingLossMs: 500,         // Sustained cropping before a reframe warning.
  errorHoldMs: 450,           // A correction must persist; removal has no extra delay.
  confirmationMs: 700,
  smoothing: 0.32,            // Landmark exponential moving average.
  minRepMs: 1100,
  phaseHoldMs: 140,
  ambiguityRatio: 0.72,
  inferenceIntervalMs: 65,
  movementDelta: 8,          // Actual angle change required before scoring.
  movementHoldMs: 180,
  scoreSmoothing: 0.18,
  perfectFrames: 8,           // All observable metrics accepted before 100 is possible.
  setupOverlayMs: 2600,
};

