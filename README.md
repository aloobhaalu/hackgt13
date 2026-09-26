# FormFlow

A client-only visual form-awareness prototype for squats (side view), standing dumbbell curls (front view), and seated cable rows (side view). React, TypeScript, Vite, and MediaPipe Pose Landmarker. No backend, accounts, uploads, storage APIs, or workout history.

## Run locally

Node.js 22.12+ and npm:

```sh
npm install
npm run dev
npm test
npm run build
```

In PowerShell, use `npm.cmd` if script execution is restricted. Open Vite's localhost URL. Clicking any part of an exercise card immediately requests the camera and opens coaching. Allow permission; video appears before model loading finishes. A 2.6-second visual overlay shows the camera view. No separate setup or second camera click. Pause disables the video track; Back/End stops it. Backgrounding the tab pauses the session.

## Debug and tuning

Press **D** or add **?debug=1** to show developer diagnostics: required landmark visibility, raw angles, phase, score components, and tracking failure reasons. Synthetic demo controls are available only there; demo sessions are explicitly labelled and use a separate source from the webcam.

Tune `src/config.ts`:

- `visibility` (0.45), `framingHoldMs` / `framingLossMs` (500 ms): framing confidence and debounce.
- `movementDelta` (8 degrees), `movementHoldMs`, `phaseStart` / `phaseEnd`: movement validation and repetition phases.
- `smoothing`, `scoreSmoothing`, `perfectFrames`: landmark/score stability; 100 requires eight accepted samples.
- `errorHoldMs` (450 ms): how long an error must persist before a cue appears. Accepted corrections clear immediately without a separate delay.
- Exercise `maxLean`, squat `depthAngle` / `stability`, curl `elbowDrift` / `asymmetry`, row `shoulderElevation` / `elbowPath`, and `SCORE_RANGES`: heuristic thresholds and penalty scales.

Framing requires shoulders, hips, knees and ankles; it ignores face/hands, centering and apparent body size. A side view accepts one complete camera-facing chain; curls require both sides. Missing arm landmarks pause arm-dependent assessment without a reframe warning. Brief tracking loss immediately removes scores/cues; only sustained cropping shows a reframe hint. Other uncertainty stays neutral.

Curl/row scores require observed angle change during an active phase. Squats use a separate sequence classifier: stable upright baseline → correlated hip descent/knee bend → recognizable bottom → correlated ascent → upright completion. Static bent-knee, floor-level, kneeling, non-side-on, and uncertain movements remain unscored. Only recognized squat phases show corrections. Partial squat scores are capped at 95; 100 requires a completed sequence and stable accepted metrics.

Squat geometry prefers the selected person's MediaPipe world landmarks, with aspect-corrected normalized landmarks as fallback. Because world landmarks are pelvis-centered, hip drop is measured relative to the ankle and the standing leg-length baseline, not absolute world hip coordinates. A three-sample median precedes smoothing. Brief tracking loss hides the score and preserves phase memory for up to 180 ms; sustained loss, source/side changes and long frame gaps discard the baseline. Confident heels and foot indexes supplement ankle stability without becoming framing requirements. A front view prompts “Rotate sideways”; shoulder/hip separation limits of 0.58/0.50 torso lengths allow a slightly angled side view. Depth guidance uses one downward arrow to a target 0.07 standing leg lengths below the rendered hip. Debug mode exposes both knee angles, side-profile ratios, foot visibility, tracking reliability and the exact scoring reason.

Start squat tuning with `EXERCISES.squat.startKneeMin`, `startHipMin`, `baselineHoldMs`, `minHipDrop`, `minKneeBend`, `bottomDropMin`, `bottomKneeMax`, `sideShoulderRatioMax`, `maxStillMs`, and the phase-specific `weights`. Distances and speeds use the user's leg length. These experimental heuristics are not medical standards or validated form accuracy. Real-body camera testing is still needed; camera angle, world-model estimates and occlusion affect results.

## Privacy and delivery

All frames, landmarks, and session data stay in browser memory. Camera startup downloads MediaPipe WASM from jsDelivr and the pose model from Google; Google Fonts provides typography. Those asset requests never contain video or poses. Camera access requires localhost or HTTPS. Self-host these assets for offline camera use.

`npm run build` produces static `dist/` files suitable for HTTPS hosting on Vultr; no deployment is configured. Rename the brand in `src/config.ts` and metadata in `index.html`.

Tests cover DOM card/retry/debug interactions, camera ownership, framing/recovery, movement gating, metric scores, and canvas arrow/target commands. DOM tests simulate permission responses; they do not replace a physical-webcam or rendered-browser check.
