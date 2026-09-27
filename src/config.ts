export const BRAND = { name: 'RepReady', logo: '/repready-mark.svg', tagline: 'See your form.\nFind your flow.' };
export type ExerciseId = 'squat' | 'curl' | 'plank';
export type CameraView = 'side' | 'front';
export const VIEW = { frontMinSpread: 0.65, sideMaxSpread: 0.6, confirmMs: 400 };
export const TARGET = {
  acquireMs: 500, lostMs: 900, fadeMs: 400,
  visibility: 0.55, minTorso: 0.09, centerRadius: 0.32,
  maxMatchDistance: 0.65, maxScaleRatio: 1.45, matchMargin: 0.2,
  acquisitionMargin: 0.15, maxFrameGapMs: 350,
};
export const FEEDBACK = {
  correctionConfirmMs: 200, issueEnter: 0.04, issueRelease: 0.015,
  scoreChangeMin: 2, scoreWindowMs: 350,
  scoreIntervalMs: { squat: 200, curl: 200, plank: 200 },
};
// Keep active targets readable over clothing without changing the rest of the UI
export const CORRECTION_VISUAL = {
  targetColor: '#34d399', targetOpacity: 0.94, segmentWidth: 4.5,
  arrowWidth: 3.5, arrowheadSize: 14, targetDotRadius: 8,
  outlineColor: '#08271f', outlineOpacity: 0.85, outlineWidth: 2,
  pulseStrength: 0.08, pulsePeriodMs: 1400,
};
export const FRONT_SQUAT = {
  baselineMs: 500, baselineRange: 0.025, baselineKneeRange: 8, uprightKnee: 155, minDrop: 0.08,
  kneeBend: 12, holdMs: 400, holdRange: 0.025, returnDrop: 0.04,
  stanceShoulderTarget: 1, stanceTolerance: 0.06, stanceRelease: 0.03, stanceVisibility: 0.65,
  bottomDrop: 0.10, bottomKneeBend: 25, bottomConfirmMs: 100, ascentConfirmMs: 130, returnKneeTolerance: 15, returnConfirmMs: 130,
  toeVisibility: 0.75, toeOutMin: 10, toeOutMax: 35, toeOutTarget: 20, toePenaltyRange: 25,
  toeLengthMin: 0.07, toeLengthMax: 0.35, toeForwardMin: 0.025,
  kneeTrack: 0.28, kneeDirectionOffsetMax: 0.15, symmetry: 0.12, balance: 0.25,
  stability: 0.015, maxFootTravel: 0.25, timeoutMs: 14000,
};

// These are starting points for tuning the prototype, not medical rules
// Angles use degrees
// Curl and plank distances use torso or body length, squats use standing leg length
export const EXERCISES = {
  squat: {
    name: 'Bodyweight squat', short: 'Squat', angle: 'Side view recommended', recommendedView: 'side',
    maxLean: 45, depthAngle: 115,
    visibility: 0.45,
    frameTolerance: 0.02, framingHoldMs: 500, framingLossMs: 500, landmarkSmoothing: 0.32,
    torsoTargetRatio: 0.7, torsoReleaseDegrees: 3, torsoConfirmMs: 200,
    depthKneeWeight: 0.5, depthDropWeight: 0.5,
    holdConfirmMs: 400, holdEvaluationMs: 600, holdSampleWindow: 5,
    holdMinKneeBend: 35, holdMinHipDrop: 0.14,
    // A recognizable reversal can be shallower than the held-depth target
    repMinKneeBend: 25, repMinHipDrop: 0.10,
    holdExitHipSpeed: 0.16, holdExitKneeSpeed: 22,
    holdExitHipRange: 0.06, holdExitKneeRange: 12,
    holdStableHipRange: 0.008, holdStableKneeRange: 2,
    holdMaxHipRange: 0.03, holdMaxKneeRange: 8,
    holdChangeAngle: 2, holdChangeDrop: 0.01, holdChangeStability: 0.08,
    holdIssueThreshold: 0.04,
    holdWeights: { depth: 0.5, torso: 0.3, stability: 0.2 },
    // Use standing leg length to compare squat distances and speeds
    startKneeMin: 150, startHipMin: 150, startTorsoMax: 25,
    setupHipMin: 95, setupTorsoMax: 75,
    baselineHoldMs: 500, baselineHipRange: 0.035, baselineKneeRange: 8,
    baselineHipSpeed: 0.08, baselineKneeSpeed: 14,
    sideShoulderRatioMax: 0.58, sideHipRatioMax: 0.5, // Allow a slightly angled profile
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
    finishHoldMs: 130, returnHipDrop: 0.05, returnKneeTolerance: 15, bottomConfirmMs: 100, ascentConfirmMs: 130, maxSequenceMs: 12000,
    maxFrameGapMs: 350,
    maxHipSpeed: 1.6, maxKneeSpeed: 260,
    minHipHeight: 0.22, minShinHeight: 0.15,
    maxFootTravel: 0.22, maxHipTravel: 0.65, maxLegScaleChange: 0.35,
    depthPenaltyRange: 30, dropPenaltyRange: 0.2, torsoPenaltyRange: 25,
  },
  curl: {
    name: 'Standing Dumbbell Bicep Curl', short: 'Dumbbell curl', angle: 'Front view recommended', recommendedView: 'front',
    phaseStart: 150, phaseEnd: 85, topMinBend: 75, topConfirmMs: 100,
    repMinBend: 60, repTopAngle: 115,
    maxLean: 12, elbowDrift: 0.38, asymmetry: 28,
    readyMs: 1100, movementBend: 18, movementRise: 0.06, phaseMs: 180, timeoutMs: 10000,
    maxSpeed: 220, upperArmDrift: 0.2, stability: 0.035,
    handSideways: 0.32, backwardForearm: 0.15,
    scoreWeights: { arm: 0.25, torso: 0.35, stability: 0.15, control: 0.1, symmetry: 0.15, range: 0.3 },
    calibrationLeanMax: 18, calibrationAngleRange: 8, calibrationSpeed: 22,
    downAngleTolerance: 18, downWristTolerance: 0.16, downStableMs: 100,
    // Allow a near-down return without treating a half-lowered curl as complete
    returnRangeFraction: 0.25, returnAngleMax: 30,
    elbowMotion: 0.12, elbowMotionWindowMs: 600,
    loweringStallMs: 450, directionSpeed: 5, bottomPenaltyAngle: 55,
    maxArmAbduction: 55, minUpperArmVertical: 0.5,
    leanPenaltyRange: 25, hipShift: 0.12, hipShiftPenaltyRange: 0.3,
    trunkSpeed: 0.6, trunkSpeedPenaltyRange: 1, facingEvidence: 0.02,
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
  // Hide feedback during brief tracking gaps
  // Keep the movement context if the same person returns nearby
  recoveryGraceMs: 180, recoveryTravel: 0.45,
  visibility: 0.45,
  frameTolerance: 0.02,       // Allow small coordinate noise at image boundaries
  framingHoldMs: 500,         // Wait for clear landmarks before starting feedback
  framingLossMs: 500,         // Wait for persistent cropping before asking for a better frame
  errorHoldMs: 450,           // Wait before adding a correction and clear it when the issue is gone
  confirmationMs: 700,
  smoothing: 0.32,            // Smooth landmark movement between frames
  phaseHoldMs: 140,
  ambiguityRatio: 0.72,
  inferenceIntervalMs: 65,
  movementDelta: 8,          // Actual angle change required before scoring
  movementHoldMs: 180,
  scoreSmoothing: 0.18,
  perfectFrames: 8,           // Only allow 100 after all visible checks stay within range
  setupOverlayMs: 2600,
};
