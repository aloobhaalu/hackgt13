# FormFlow

A client-only visual form-awareness prototype for Bodyweight Squat, Standing Dumbbell Bicep Curl, and High Plank, each with separate side/front views. React, TypeScript, Vite, and MediaPipe Pose Landmarker. No backend, accounts, uploads, storage APIs, or workout history.

## Run locally

Node.js 22.12+ and npm:

```sh
npm install
npm run dev
npm test
npm run build
```

In PowerShell, use `npm.cmd` if script execution is restricted. Open Vite's localhost URL. Select an exercise card, then a view in the compact popup. Side View is recommended for squat and plank; Front View is recommended for curl. The recommended option appears first and receives initial keyboard focus. Choosing the view synchronously requests the camera; no extra camera button is needed. Video appears before model loading finishes. A thin, low-opacity mint oval stays centered while the app selects a target; it fades out over 400 ms after lock. No placement panel or instruction text appears over live video. Pause disables the video track; Back/End stops it. Backgrounding the tab pauses the session.

The existing squat and curl homepage animations are intentionally preserved. High Plank replaces Cable Row with a static supported plank preview, not a push-up.

## Exercise and view checks

- **Squat side:** existing calibrated descent/hold/ascent logic, depth, torso lean, stability and optional heel-lift guidance.
- **Squat front:** separate standing calibration, hip drop and knee-bend sequence; foot-only stance placement, optional projected toe direction, leg symmetry and balance. Knee tracking runs only during recognized descent/hold/ascent once stance is accepted. No side-view depth or torso penalty.
- **Curl side:** stable arms-down start, sustained elbow flexion, top and lowering; upper-arm drift, torso lean and movement control.
- **Curl front:** the same dynamic curl phases with arm symmetry, outward elbow drift and upper-body stability. No leg/ankle framing requirement.
- **Plank side:** stable supported high-plank hold, shoulder-to-ankle body line, high/low hip offset, knee alignment, hand stacking and stability. No rep count.
- **Plank front:** stable supported hold with world-landmark depth evidence, broad shoulder/hand and hip/foot symmetry and balance. If depth evidence is unavailable, no score is shown.

Framing requires one visible camera-facing chain for side views and both chains for front views. Squat needs head evidence (nose or an ear), shoulders, hips, knees, ankles and foot points. Plank adds arms/wrists and requires feet, but no face. Curl needs head evidence, shoulders, elbows, wrists and hips only. Required landmarks must remain visible for 500 ms. Far-side limb occlusion is permitted in side-view framing, but sufficient shoulder/hip evidence is still needed to confirm camera orientation. Missing required landmarks show neutral framing corners; a visible unrelated pose shows a body-relative mint reference without fault arrows or a score.

All views use smoothed pose geometry, confirmed states, body-normalized distances and independent correction persistence. All active corrections appear together; no live cue labels or focus controls. New view checks are in `src/pose/viewCoach.ts`; existing side squat is in `src/pose/squat.ts`. `src/pose/engine.ts` owns framing, smoothing and routing. `src/components/ViewPicker.tsx` owns pre-camera selection and visual placement.

## Target selection

Real-camera frames pass through a persistent geometric target tracker before exercise analysis. A clear central candidate must persist for 500 ms. Once locked, torso position and scale associate that person across reordered detections; background detections never feed the evaluator or renderer. The corresponding world-landmark index follows the selected image pose. Upper-body-only framing and a hidden far-side torso remain supported.

A missing or ambiguous match immediately clears the skeleton, corrections and score. Brief occlusion retains the lock for up to 900 ms; sustained loss restores the oval with a 400 ms fade and requires fresh acquisition. Overlapping, indistinguishable candidates pause output rather than guessing. A fresh lock starts a fresh exercise evaluator so calibration, scores and reps cannot carry across people. This is short-term geometry association, not biometric identity recognition. `TARGET` in `src/config.ts` centralizes acquisition, loss, matching and fade thresholds. Synthetic demos bypass target selection.

## Feedback gates and local validation

Front squat keeps three distinct targets. Stance uses ankle separation normalized by hip and shoulder widths: the configurable lower recommendation is the larger of 1.1 times hip width and 0.65 times shoulder width; the upper recommendation is approximately 1.1 times shoulder width (never below the lower bound). A soft tolerance avoids strict boundary flicker. Wide/narrow stance arrows translate both feet horizontally, without highlighting or moving the knees. Toe-direction guidance requires confident ankle, heel and foot-index landmarks and a sufficiently visible heel-to-toe vector; the projected toe-out band starts at 10–35 degrees with a 20-degree target. These image-plane angles are tuning heuristics, not anatomical angle measurements or universal rules. Unclear/foreshortened foot geometry produces no toe cue. During a recognized squat with accepted stance, knee targets use the ankle and a limited offset in the observed foot direction. All settings are under `FRONT_SQUAT` in `src/config.ts`; stance ratios and available toe angles appear in debug metrics.

Visual coaching and Form Alignment scoring are separate gates. A reliable, plausible setup can receive targets without a percentage or a rep: front squats get stance, foot/knee symmetry and centering feedback; front curls get elbow/hand-path, arm symmetry and stability feedback; side curls get upper-arm, torso and direction-supported backward-forearm feedback; planks get their view-specific hand/body-line or symmetry feedback while a hold is being confirmed. Unclear direction suppresses the optional forearm-path target. Missing required landmarks or an invalid view suppress both gates.

Form Alignment shows **Ready** in a visible pre-movement setup, a real 0-100% value during recognized movement, and **—** when tracking, view, or movement recognition is uncertain. Squat scoring starts during calibrated descent and continues through bottom and ascent. Curl scoring starts after meaningful elbow flexion and hand rise, continuing through top and lowering. Plank scoring starts in a plausible supported position; its timer starts only after the stable hold is confirmed and resets on leaving that state or tracking loss. No plank reps are displayed.

Live scores average recent pose-derived samples and refresh at most every 200 ms (5 Hz), with small changes suppressed. They are not elapsed-time, mock, or random values. Side-squat moving phases assess torso alignment and movement control; bottom/hold quality adds measured depth and hold stability, so normal descent is not penalized as an unstable hold. Existing correction checks and their confirmation cadence remain separate.

Squat and curl display **Quality Reps**. Only an uninterrupted standing/descent/bottom/ascent/standing or arms-down/up/top/down/arms-down sequence can qualify. A controlled squat reversal can establish the bottom without requiring a pause. Final quality averages the time-weighted smoothed scores in each recognized phase (plus bottom metrics for a continuous squat), giving phases equal weight so a long pause cannot mask poor movement. The default `FEEDBACK.qualityRepThreshold` is **82** in `src/config.ts`. Debug mode exposes a runtime numeric threshold control (reset on page reload), completed-cycle count, and final rep quality. Incomplete or low-quality cycles do not increment the visible counter.

Setup corrections confirm for 200 ms with entry/release hysteresis, independently of the score windows. All confirmed issues remain visible together. Severity affects orange/red color, line/arrow width, opacity and target pulse strength. The detected skeleton remains white. Reference ghosts yield to valid visual coaching so corrected setups show a clean skeleton.

Press D (or use ?debug=1), expand **Local validation**, and choose **Start validation logging**. Browser console entries tagged `[FormFlow validation]` contain exercise/view/source, coaching/scoring gates, state, score, issue types/severity and a confidence summary. Logging is opt-in, sampled at most twice per second except for state/issue transitions, and automatically stops when debug mode closes or the session ends. No webcam frames, landmark coordinates or pose objects are logged or uploaded; synthetic sessions are explicitly identified. The normal coaching UI has no validation controls.

## Debug and tuning

Press **D** or add **?debug=1** to show developer diagnostics: required landmark visibility, raw angles, phase, score components, and tracking failure reasons. Synthetic demo controls are available only there; demo sessions are explicitly labelled and use a separate source from the webcam.

Squat hold mode uses `FRAME_INVALID ? CALIBRATING_STANDING ? DESCENDING ? HOLDING ? ASCENDING / EXIT`. Recognized descent, hold and ascent expose live scores; setup guidance remains independent. Before a recognizable setup, a silent body-relative reference trajectory remains visible; during a visible setup, the white skeleton and applicable corrections take over; missing landmarks use neutral reframing. The front-view evaluator is independent of this side-view flow.

Standing calibration averages about 1.5 seconds of stable upright measurements and stores knee/hip angles, ankle-relative hip height, leg length, torso tilt, foot positions and confidence. A hold requires observed downward hip movement and knee bending after that calibration, then meaningful bend/drop with knee-angle and hip-height variation remaining within a bounded 400 ms window. Entry uses accumulated movement from standing rather than requiring simultaneous derivative thresholds. Standing still or starting in a crouch cannot activate a hold. The squat demo includes a longer standing calibration and bottom hold.

Measurements use a three-frame median followed by smoothing before velocity estimation. MediaPipe world coordinates are preferred, with aspect-corrected image coordinates as fallback; source changes discard calibration. Pelvis-centered world hip height is measured relative to the ankle. On hold entry, the last five smoothed frames are averaged. While holding, correction membership is re-evaluated every 600 ms; live scores use the current smoothed measurements at the separate 200 ms display cadence. No timer generates measurements or scores. A stable hold can continue without the old stalled-rep timeout. Recognized ascent keeps its live score; unreliable landmarks or exiting supported movement hide it immediately. Returning upright completes a cycle, which counts only if its final quality meets the configured threshold.

All hold issues appear simultaneously: depth uses knee bend plus leg-normalized hip drop, torso feedback uses configurable forward lean, and stability uses recent hip-height/knee-angle variation. Targets remain anchored to the currently rendered skeleton. Side squat does not evaluate left/right asymmetry, valgus, butt wink, or knee-over-toe position. Torso corrections also appear during a plausible standing setup or calibrated, recognized descent, using smoothed lean without waiting for hold confirmation. Depth and hold-stability corrections remain hold-only; live alignment also covers recognized movement. Unrecognized motion and unreliable tracking produce no fault corrections.

Tune `FEEDBACK` for correction confirmation/hysteresis and score cadence. Tune `EXERCISES.curl`, `EXERCISES.plank`, `FRONT_SQUAT` and `VIEW` for the new views. Their settings include view spread ratios, ready/hold durations, movement confirmation, symmetry, line offsets and stability tolerances. Tune `EXERCISES.squat` in `src/config.ts`, especially:

- `baselineHoldMs` (1500), `startKneeMin`, `startHipMin`: upright calibration.
- `minHipDrop`, `minKneeBend`, `directionHoldMs`: sustained body-relative descent recognition.
- `holdMinKneeBend` (35 degrees), `holdMinHipDrop` (0.14 leg lengths), `holdConfirmMs` (400): hold qualification.
- `holdEvaluationMs` (600), `holdSampleWindow` (5), `holdChange*`, `holdIssueThreshold`: feedback cadence and noise tolerance.
- `holdExit*`, `holdStable*`, `holdMax*`: motion tolerance and instability feedback.
- `depthAngle`, `targetHipDrop`, `maxLean`, and `holdWeights`: prototype quality ranges and weights.

Debug mode shows state, stored baseline values, smoothed measurements, velocities, hold-confirmation duration, last evaluation timestamp, all active corrections, and the reason scoring is unavailable. The expandable thresholds section lists the live configuration. These are adjustable prototype heuristics, not validated medical or universal standards. Front-view judgments are broad visual estimates; perspective, loose clothing and world-depth noise can suppress or distort measurements. They do not diagnose anatomical alignment. The app is not a medical device. Synthetic tests do not establish real-webcam accuracy or distinguish every seated posture from a visually similar squat.

Experimental heel-lift guidance runs during recognized descent and holds. Stand with heels down during calibration: the camera-facing ankle, heel and toe must have confidence at least 0.75 and stable geometry for 650 ms. The check compares toe-relative heel and ankle rise with that personal baseline, normalized by image leg length. A three-frame median and 260 ms confirmation suppress isolated noise; separate entry/release thresholds reduce flicker. Planted toes and plausible foot geometry are required. A detected lift adds an orange foot segment, mint heel target and downward arrow alongside other corrections. Occlusion or unclear geometry immediately hides this optional correction without blocking the other squat checks. This experiment does not change the Form Alignment score. All tuning values use the `heel*` fields in squat configuration; debug mode shows the foot baseline, measured lift and availability reason. A single webcam estimates landmark movement, not actual floor contact; starting on raised heels cannot establish a valid flat-foot reference.

## Privacy and delivery

All frames, landmarks, and session data stay in browser memory. Camera startup downloads MediaPipe WASM from jsDelivr and the pose model from Google; Google Fonts provides typography. Those asset requests never contain video or poses. Camera access requires localhost or HTTPS. Self-host these assets for offline camera use.

`npm run build` produces static `dist/` files suitable for HTTPS hosting on Vultr; no deployment is configured. Rename the brand in `src/config.ts` and metadata in `index.html`.

Tests cover DOM card/retry/debug interactions, camera ownership, framing/recovery, movement gating, metric scores, and canvas arrow/target commands. DOM tests simulate permission responses; they do not replace a physical-webcam or rendered-browser check.

Squat entry simplification was informed by [Gym-AI-Trainer](https://github.com/gopalpatil15/Gym-AI-Trainer/blob/02b0e9572d3ae8f314cbebcb5147ae44e4d4cfd7/exercises/squat.py): smoothed pose measurements and a persistent bottom candidate. This implementation retains personal calibration and side-view checks; no source code was copied.
