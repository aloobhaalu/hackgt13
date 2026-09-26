export const BRAND = { name: 'FormFlow', tagline: 'See your form.\nFind your flow.' };
export type ExerciseId = 'squat' | 'curl' | 'row';

// Prototype heuristics, not clinical or universal movement standards.
// Angles are degrees. Curl/row distances use torso length; squats use baseline leg length.
export const EXERCISES = {
  squat: {
    name: 'Bodyweight squat', short: 'Squat', angle: 'Side profile',
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
    name: 'Standing dumbbell curl', short: 'Dumbbell curl', angle: 'Front facing',
    phaseStart: 150, phaseEnd: 65,
    maxLean: 12, elbowDrift: 0.38, asymmetry: 28,
  },
  row: {
    name: 'Seated cable row', short: 'Seated cable row', angle: 'Side profile',
    phaseStart: 145, phaseEnd: 80,
    maxLean: 22, shoulderElevation: 0.18, elbowPath: 0.3,
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

// Excess beyond the accepted limit that produces a 70-point component penalty.
export const SCORE_RANGES = {
  torso: 20,
  depth: 30,
  stability: 0.25,
  elbow: 0.35,
  symmetry: 45,
  shoulder: 0.18,
  path: 0.4,
};
