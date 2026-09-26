export const BRAND = { name: 'FormFlow', tagline: 'See your form.\nFind your flow.' };
export type ExerciseId = 'squat' | 'curl' | 'row';

// Prototype heuristics, not clinical or universal movement standards.
// Angles are degrees. Distances are fractions of the user's torso length.
export const EXERCISES = {
  squat: {
    name: 'Bodyweight squat', short: 'Squat', angle: 'Side profile',
    phaseStart: 158, phaseEnd: 105,
    maxLean: 48, depthAngle: 115, stability: 0.22,
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
