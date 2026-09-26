# RepReady

Brand name and header logo are configured in `src/config.ts`. The mint/cyan athlete-and-dumbbell mark is a scalable SVG in `public/repready-mark.svg`, with a simplified matching browser icon in `public/favicon.svg`.

A local visual form-awareness prototype for Bodyweight Squat, Standing Dumbbell Bicep Curl, and High Plank, each with separate side/front views. React, TypeScript, Vite, and MediaPipe Pose Landmarker. No accounts, saved recordings, or workout history. An optional server-only Gemini adapter can summarize aggregate exercise metrics after End; live coaching stays local.

## Run locally

Node.js 22.12+ and npm:

```sh
npm install
npm run dev
npm test
npm run build
```

In PowerShell, use `npm.cmd` if script execution is restricted. Open Vite's localhost URL. Select an exercise card, then a view in the compact popup. Side View is recommended for squat and plank; Front View is recommended for curl. The recommended option appears first and receives initial keyboard focus. Choosing the view synchronously requests the camera; no extra camera button is needed. Video appears before model loading finishes. The real webcam preview and pose canvas are mirrored together like a selfie mirror; counters, controls and text stay unmirrored. Inference uses the original coordinates, so mirroring does not swap anatomical landmarks or change rep logic. A thin, low-opacity mint oval stays centered while the app selects a target; it fades out over 400 ms after lock. No placement panel or instruction text appears over live video. Pause disables the video track; Back/End stops it. Backgrounding the tab pauses the session.

The existing squat and curl homepage animations are intentionally preserved. High Plank replaces Cable Row with a static supported plank preview, not a push-up.

## Exercise and view checks

- **Squat side:** existing calibrated descent/hold/ascent logic, depth, torso lean, stability and optional heel-lift guidance.
- **Squat front:** separate standing calibration, hip drop and knee-bend sequence; foot-only stance placement, optional projected toe direction, leg symmetry and balance. Knee tracking runs only during recognized descent/hold/ascent once stance is accepted. No side-view depth or torso penalty.
- **Curl side:** stable arms-down start, sustained elbow flexion, top and lowering; upper-arm drift, torso lean and movement control.
- **Curl front:** the same dynamic curl phases with arm symmetry, outward elbow drift and upper-body stability. No leg/ankle framing requirement.
- **Plank side:** stable supported high-plank hold, shoulder-to-ankle body line, high/low hip offset, knee alignment, hand stacking and stability. No rep count.
- **Plank front:** stable supported hold with world-landmark depth evidence, broad shoulder/hand and hip/foot symmetry and balance. If depth evidence is unavailable, no score is shown.

Framing requires one visible camera-facing chain for side views and both chains for front views. Squat needs head evidence (nose or an ear), shoulders, hips, knees and ankles. Heel/toe landmarks enable optional foot checks; their occlusion does not block squat recognition or rep counting. Plank adds arms/wrists and requires feet, but no face. Curl needs head evidence, shoulders, elbows, wrists and hips only. Required landmarks must remain visible for 500 ms. Far-side limb occlusion is permitted in side-view framing, but sufficient shoulder/hip evidence is still needed to confirm camera orientation. Missing required landmarks show neutral framing corners; a visible unrelated pose shows a body-relative mint reference without fault arrows or a score.

All views use smoothed pose geometry, confirmed states, body-normalized distances and independent correction persistence. All active corrections appear together; no live cue labels or focus controls. New view checks are in `src/pose/viewCoach.ts`; existing side squat is in `src/pose/squat.ts`. `src/pose/engine.ts` owns framing, smoothing and routing. `src/components/ViewPicker.tsx` owns pre-camera selection and visual placement.

## Curl calibration and return range

Curl setup averages 1.1 seconds of stable upright, arms-down measurements. Each visible arm stores its elbow angle, wrist/elbow offsets and arm length; side view also stores the shoulder/hip midpoint torso angle and hip position. Front view continues to evaluate outward elbow drift, arm symmetry and sway; side view evaluates torso deviation from that personal baseline, upper-arm drift, forward hip shift and trunk motion. Direction-specific hip feedback is suppressed when facing direction is unclear. Targets assess arm/torso landmarks, not dumbbell presence, spinal curvature, grip or muscle activation.

A rep requires calibrated down ? sustained elbow flexion ? meaningful top ? lowering ? a stable return near the personal down range. Both elbow extension and wrist-to-start distance must pass; front view requires both arms. The return must remain accepted for 130 ms (`EXERCISES.curl.downStableMs`), without reusing the initial calibration's near-zero velocity requirement. This allows controlled repetitions with brief arms-down pauses while still requiring the calibrated elbow and wrist return ranges. Calibration is retained between complete reps. The smoothed top range is configurable: elbow angle at most 85 degrees, at least 75 degrees of bend from the personal baseline, and 100 ms of observed confirmation (`phaseEnd`, `topMinBend`, `topConfirmMs`). A controlled reversal can satisfy this without a deliberate top hold; the previous 65-degree requirement rejected shallower but substantial curls. Static bent arms, small pulses and arm-abduction/lateral-raise motion cannot establish a curl cycle.

If lowering stalls for 450 ms above the accepted range, a confirmed orange forearm and mint calibrated down-position target show the return path. Curling upward again before returning down invalidates that cycle; the downward guidance remains, and another rep cannot begin until a stable down position is reached. Normal controlled lowering is not penalized for still being in progress. Torso/hip and arm-range corrections can appear together and clear independently. Fresh noisy samples cannot erase a required return.

Live scores retain the existing smoothed cadence and Quality Rep threshold. Curl checks are grouped into arm, torso, stability, control, symmetry and return-range categories with configurable weights, so adding a reassuring duplicate metric cannot dilute a fault. A completed rep is counted after the full valid sequence; it additionally becomes a Quality Rep only when its final measured score meets the quality threshold. All new tuning values are in `EXERCISES.curl`; return errors, baseline angle, stall duration, cycle state, return-confirmation duration and the last blocked-cycle reason are also visible in debug metrics. Synthetic tests cover the edge cases; these heuristics still require real-camera tuning. Regression tests exercise repeated front/side curls with natural top reversals and 300 ms arms-down pauses, front/side squats with hidden optional toe landmarks, required-landmark loss mid-cycle, incomplete lowering, and counter persistence across reacquisition. These test derived pose sequences and UI counters, not physical-webcam accuracy.

## Target selection

Real-camera frames pass through a persistent geometric target tracker before exercise analysis. A clear central candidate must persist for 500 ms. Once locked, torso position and scale associate that person across reordered detections; background detections never feed the evaluator or renderer. The corresponding world-landmark index follows the selected image pose. Upper-body-only framing and a hidden far-side torso remain supported.

A missing or ambiguous match immediately clears the skeleton, corrections and score. Brief occlusion retains the lock for up to 900 ms; sustained loss restores the oval with a 400 ms fade and requires fresh acquisition. Overlapping, indistinguishable candidates pause output rather than guessing. A fresh lock starts a fresh exercise evaluator so calibration, scores and unfinished movement cannot carry across people. Anonymous completed/quality rep totals remain visible for the current session across pauses and reacquisition; the new evaluator starts a new movement sequence and contributes only new completed cycles. This is short-term geometry association, not biometric identity recognition. `TARGET` in `src/config.ts` centralizes acquisition, loss, matching and fade thresholds. Synthetic demos bypass target selection.

## Feedback gates and local validation

Front squat keeps three distinct targets. Stance targets ankle separation equal to measured shoulder width (`stanceShoulderTarget=1`), with a 6% entry tolerance and 3% release tolerance to avoid boundary flicker. Hip width remains available as a diagnostic ratio. Wide/narrow stance arrows translate both feet horizontally, without highlighting or moving the knees. Toe-direction guidance requires confident ankle, heel and foot-index landmarks and a sufficiently visible heel-to-toe vector; the projected toe-out band starts at 10–35 degrees with a 20-degree target. These image-plane angles are tuning heuristics, not anatomical angle measurements or universal rules. Unclear/foreshortened foot geometry produces no toe cue. During a recognized squat with accepted stance, knee targets use the ankle and a limited offset in the observed foot direction. All settings are under `FRONT_SQUAT` in `src/config.ts`; stance ratios and available toe angles appear in debug metrics.

Visual coaching and Form Alignment scoring are separate gates. A reliable, plausible setup can receive targets without a percentage or a rep: front squats get stance, foot/knee symmetry and centering feedback; front curls get elbow/hand-path, arm symmetry and stability feedback; side curls get upper-arm, torso and direction-supported backward-forearm feedback; planks get their view-specific hand/body-line or symmetry feedback while a hold is being confirmed. Unclear direction suppresses the optional forearm-path target. Missing required landmarks or an invalid view suppress both gates.

Form Alignment shows **Ready** in a visible pre-movement setup, a real 0-100% value during recognized movement, and **—** when tracking, view, or movement recognition is uncertain. Squat scoring starts during calibrated descent and continues through bottom and ascent. Curl scoring starts after meaningful elbow flexion and hand rise, continuing through top and lowering. Plank scoring starts in a plausible supported position; its timer starts only after the stable hold is confirmed and resets on leaving that state or tracking loss. No plank reps are displayed.

Live scores average recent pose-derived samples and refresh at most every 200 ms (5 Hz), with small changes suppressed. They are not elapsed-time, mock, or random values. Side-squat moving phases assess torso alignment and movement control; bottom/hold quality adds measured depth and hold stability, so normal descent is not penalized as an unstable hold. Existing correction checks and their confirmation cadence remain separate.

Squat and curl display completed **Reps** as the main count and **Quality Reps** alongside it. Only an observed standing/descent/bottom/ascent/standing or arms-down/up/top/down/arms-down sequence can qualify. A controlled squat reversal can establish the bottom without requiring a pause. Final quality averages the time-weighted smoothed scores in each recognized phase (plus bottom metrics for a continuous squat), giving phases equal weight so a long pause cannot mask poor movement. The default `FEEDBACK.qualityRepThreshold` is **82** in `src/config.ts`. Debug mode exposes a runtime numeric threshold control (reset on page reload), completed-cycle count, and final rep quality. Incomplete or low-quality cycles do not increment Quality Reps. Both views of both exercises retain completed-cycle totals even when quality is low or a scoring phase lacks enough data. Only actual scored phases can qualify a Quality Rep. Pausing or sustained target loss cancels the unfinished cycle without erasing completed session totals; incomplete or unrecognized movement never increments either count.

For squat and curl, a brief landmark or matched-target dropout immediately hides scores and corrections while retaining already observed rep evidence for less than `TRACKING.repGraceMs=180` ms. Recovery requires the same locked target, reliable required joints, no stale frame gap above 350 ms, and required-joint travel within `repResumeTravel=0.45` torso lengths. No score samples or transition-confirmation time accumulate during the gap. Longer gaps, ambiguous/reacquired targets, explicit pauses, geometry-source changes and discontinuous body positions cancel the unfinished rep. Plank hold interruption behavior is unchanged. This fixes the prior live path where one low-confidence frame restarted calibration mid-rep.

Regression tests now drive mocked MediaPipe landmark output through the actual camera hook, target selection, evaluator, session totals and rendered counter for front/side squat and curl, at 16:9 aspect. They verify two completed reps across brief joint/target dropouts, no percentage while uncertain, counter persistence after pause/reacquisition, and mirrored video/canvas with readable text. Negative cases cover sustained loss, abrupt reacquisition and an unobserved top/bottom. These fixtures test the application pipeline; they do not validate physical-webcam detection accuracy.

Setup corrections confirm for 200 ms with entry/release hysteresis, independently of the score windows. All confirmed issues remain visible together. Severity affects orange/red color, line/arrow width, opacity and target pulse strength. The detected skeleton remains white. Reference ghosts yield to valid visual coaching so corrected setups show a clean skeleton.

Press D (or use ?debug=1), expand **Local validation**, and choose **Start validation logging**. Browser console entries tagged `[RepReady validation]` contain exercise/view/source, coaching/scoring gates, state, score, issue types/severity and a confidence summary. Logging is opt-in, sampled at most twice per second except for state/issue transitions, and automatically stops when debug mode closes or the session ends. No webcam frames, landmark coordinates or pose objects are logged or uploaded; synthetic sessions are explicitly identified. The normal coaching UI has no validation controls.

## Debug and tuning

Press **D** or add **?debug=1** to show developer diagnostics: required landmark visibility, raw angles, phase, score components, and tracking failure reasons. Synthetic demo controls are available only there; demo sessions are explicitly labelled and use a separate source from the webcam.

Squat hold mode uses `FRAME_INVALID ? CALIBRATING_STANDING ? DESCENDING ? HOLDING ? ASCENDING / EXIT`. Recognized descent, hold and ascent expose live scores; setup guidance remains independent. Before a recognizable setup, a silent body-relative reference trajectory remains visible; during a visible setup, the white skeleton and applicable corrections take over; missing landmarks use neutral reframing. The front-view evaluator is independent of this side-view flow.

Standing calibration averages about 1.5 seconds of stable upright measurements and stores knee/hip angles, ankle-relative hip height, leg length, torso tilt, foot positions and confidence. A hold requires observed downward hip movement and knee bending after that calibration, then meaningful bend/drop with knee-angle and hip-height variation remaining within a bounded 400 ms window. Entry uses accumulated movement from standing rather than requiring simultaneous derivative thresholds. Standing still or starting in a crouch cannot activate a hold. The squat demo includes a longer standing calibration and bottom hold.

Measurements use a three-frame median followed by smoothing before velocity estimation. MediaPipe world coordinates are preferred, with aspect-corrected image coordinates as fallback; source changes discard calibration. Pelvis-centered world hip height is measured relative to the ankle. On hold entry, the last five smoothed frames are averaged. While holding, correction membership is re-evaluated every 600 ms; live scores use the current smoothed measurements at the separate 200 ms display cadence. No timer generates measurements or scores. A stable hold can continue without the old stalled-rep timeout. Recognized ascent keeps its live score; unreliable landmarks or exiting supported movement hide it immediately. Returning close to the calibrated standing knee angle and hip height completes a cycle. Completed reps include lower-quality cycles; only Quality Reps require the final quality threshold. Valid calibration is retained between reps. A normal controlled reversal needs no held bottom.

All hold issues appear simultaneously: depth uses knee bend plus leg-normalized hip drop, torso feedback uses sustained shoulder-to-hip tilt above an absolute 45 degrees from vertical, and stability uses recent hip-height/knee-angle variation. Targets remain anchored to the currently rendered skeleton. Side squat does not evaluate left/right asymmetry, valgus, butt wink, or knee-over-toe position. Torso corrections also appear during a plausible standing setup or calibrated, recognized descent, using smoothed lean without waiting for hold confirmation. Depth and hold-stability corrections remain hold-only; live alignment also covers recognized movement. Unrecognized motion and unreliable tracking produce no fault corrections.

Tune `FEEDBACK` for correction confirmation/hysteresis and score cadence. Tune `EXERCISES.curl`, `EXERCISES.plank`, `FRONT_SQUAT` and `VIEW` for the new views. Their settings include view spread ratios, ready/hold durations, movement confirmation, symmetry, line offsets and stability tolerances. Tune `EXERCISES.squat` in `src/config.ts`, especially:

- `baselineHoldMs` (1500), `startKneeMin`, `startHipMin`: upright calibration.
- `minHipDrop`, `minKneeBend`, `directionHoldMs`: sustained body-relative descent recognition.
- `holdMinKneeBend` (35 degrees), `holdMinHipDrop` (0.14 leg lengths), `holdConfirmMs` (400): hold qualification.
- `holdEvaluationMs` (600), `holdSampleWindow` (5), `holdChange*`, `holdIssueThreshold`: feedback cadence and noise tolerance.
- `holdExit*`, `holdStable*`, `holdMax*`: motion tolerance and instability feedback.
- `depthAngle`, `targetHipDrop`, `maxLean`, and `holdWeights`: prototype quality ranges and weights.

Debug mode shows state, stored baseline values, smoothed measurements, velocities, hold-confirmation duration, last evaluation timestamp, all active corrections, and the reason scoring is unavailable. The expandable thresholds section lists the live configuration. These are adjustable prototype heuristics, not validated medical or universal standards. Front-view judgments are broad visual estimates; perspective, loose clothing and world-depth noise can suppress or distort measurements. They do not diagnose anatomical alignment. The app is not a medical device. Synthetic tests do not establish real-webcam accuracy or distinguish every seated posture from a visually similar squat.

Experimental heel-lift guidance runs during recognized descent and holds. Stand with heels down during calibration: the camera-facing ankle, heel and toe must have confidence at least 0.75 and stable geometry for 650 ms. The check compares toe-relative heel and ankle rise with that personal baseline, normalized by image leg length. A three-frame median and 260 ms confirmation suppress isolated noise; separate entry/release thresholds reduce flicker. Planted toes and plausible foot geometry are required. A detected lift adds an orange foot segment, mint heel target and downward arrow alongside other corrections. Occlusion or unclear geometry immediately hides this optional correction without blocking the other squat checks. This experiment does not change the Form Alignment score. All tuning values use the `heel*` fields in squat configuration; debug mode shows the foot baseline, measured lift and availability reason. A single webcam estimates landmark movement, not actual floor contact; starting on raised heels cannot establish a valid flat-foot reference.

## Squat audit and tuning

All live stance, knee, torso, depth, stability and heel corrections come from local MediaPipe-derived geometry and deterministic state machines. Gemini never decides pose validity, Form Alignment, reps or visual targets. Front-view torso/"back" judgments remain disabled. Side-view torso feedback approximates shoulder-to-hip alignment; it does not measure spinal curvature or diagnose back rounding or injury.

Before this pass, a synthetic sequence of controlled squats with 400 ms standing pauses remained in ASCENDING with zero completed reps. Standing return reused the initial calibration's near-zero knee/hip velocity gate, delaying completion past the next descent. Successful reps also discarded the standing baseline. The revised return uses the personal knee/hip baseline, a short confirmation window, and retains calibration across valid cycles. The same sequence now completes two reps without entering HOLDING. Sustained tracking loss or invalid view still invalidates an unfinished cycle. Very shallow attempts, missing bottom, missing ascent, failure to return and low quality have explicit block/last-failure diagnostics through D or ?debug=1.

Front stance targets ankle separation equal to measured shoulder width (`stanceShoulderTarget=1`), with a small noise tolerance, confirmation and hysteresis. Both shoulders and ankles must meet `stanceVisibility`; uncertain feet produce no stance targets. Narrow targets move feet outward, wide targets inward. Stance corrections never use knee arrows; dynamic knee tracking waits for accepted stance and recognized movement.

These are the exact initial tuning values in `src/config.ts`, also listed in debug mode:

| Check | Side squat (`EXERCISES.squat`) | Front squat (`FRONT_SQUAT`) |
| --- | --- | --- |
| Initial standing calibration | `baselineHoldMs=1500`, knee >=150 degrees, hip >=150 degrees | `baselineMs=1500`, `uprightKnee=155` degrees |
| Descent | `minHipDrop=0.08` leg lengths, `minKneeBend=15` degrees, `minHipBend=8` degrees, `directionHoldMs=130` | `minDrop=0.08`, `kneeBend=12`, same 130 ms descent confirmation |
| Bottom evidence / reversal | `holdMinHipDrop=0.14`, `holdMinKneeBend=35`, `bottomConfirmMs=100` | `bottomDrop=0.14`, `bottomKneeBend=25`, `bottomConfirmMs=100` |
| Ascent | `ascentDrop=0.035` leg lengths, `ascentKneeExtension=5` degrees from measured low point, `ascentConfirmMs=130` | knee extension >5 degrees/s with hip rise, `ascentConfirmMs=130` |
| Standing return | `returnHipDrop=0.05`, `returnKneeTolerance=15` degrees from baseline, `finishHoldMs=130` | `returnDrop=0.04`, `returnKneeTolerance=15`, `returnConfirmMs=130` |
| Side torso approximation | `maxLean=45` degrees from vertical (absolute, not added to the standing baseline), `torsoConfirmMs=200`, `torsoReleaseDegrees=3`, `torsoTargetRatio=0.7` | Not evaluated |
| Stance band | Not evaluated | target=1.0 x shoulder width; `stanceTolerance=0.06` (6% entry deviation), `stanceRelease=0.03` (3% release deviation) shoulder widths; `stanceVisibility=0.65` |

`FEEDBACK.qualityRepThreshold=82` applies to the final locally measured rep score. Stance uses its own 6% entry / 3% release width tolerance and the shared 200 ms correction confirmation; generic severity thresholds do not widen this band. Side torso correction starts after smoothed tilt exceeds 45 degrees for 200 ms, clearing at 42 degrees to prevent boundary flicker. The personal baseline positions the mint torso target inside that limit; it never raises the 45-degree ceiling. An optional held bottom still uses 400 ms confirmation; that is not required for normal rep counting. These values require real-camera tuning; synthetic tests are regression checks, not accuracy validation.

A configured end-session endpoint smoke test used locally derived **synthetic squat aggregates** (no image/landmark payload). The app returned HTTP 200; the server reported `geminiCalled=true`, `source=local`, `reason=timeout` at its 2.5-second deadline. This verifies fallback after an attempted real API call, not a successful Gemini-generated recap or a physical webcam squat. The automated browser connection was unavailable during this pass.

## Optional post-session recap

Ending any real squat, curl, or plank session synchronously stops inference, closes the pose model, detaches the video stream and releases the webcam. The existing coaching screen stays mounted behind a centered, dimmed recap modal. The modal shows "Preparing recap..." while the optional request is pending, then a headline (at most eight words) and up to two tips (at most twelve words each). Missing keys, offline mode, invalid output and timeouts resolve to the deterministic local recap in that same modal; normal users never see an API error. Squat and curl show Total Reps and Quality Reps; plank shows Best Hold and Total Hold Time, never reps. Empty-session totals are visually subdued instead of emphasizing zeros.

Done (or Escape) clears the recap and returns to the clean homepage. Dismissal is available while loading, and late responses cannot reopen the modal or overwrite a new session. No recap card is ever rendered on the homepage. Background controls are inert, keyboard focus stays inside the modal, and scrolling is restored on dismissal. Back, pause and frame updates never request a recap; duplicate End clicks share one action. The client waits at most 3.5 seconds and never retries.

`src/recap/summary.ts` retains only aggregate counters in memory, keyed by selected exercise and view, with no sessionStorage mirror. The generic `/api/session-recap` endpoint accepts only the exact fields and issue categories for that exercise; plank payloads contain hold milliseconds rather than rep counts. Completed and quality reps come from the local evaluator, including totals across target reacquisitions. Valid Form Alignment samples are aggregated at most five times per second for the mean and best score. Squat and curl use locally confirmed scoring phases; plank uses only confirmed HOLDING, excluding setup scores. Plank total and best continuous duration accumulate changes in the local hold timer only between consecutive reliable observations. Pauses, invalid tracking/view, exits, reacquisition, or camera gaps over 350 ms break continuity; gaps are never counted. Ending the session does not extrapolate unobserved time. Confirmed correction episodes count once per issue group; severity is the mean and maximum of episode peaks, capped at 1. Both-arm corrections are grouped to avoid counting each frame or limb as a separate occurrence. Rejected non-curl episodes come from reliable local rejection decisions; uncertain tracking is not classified as a bad movement. Partial-range counts and severity come from locally aborted recognized curl attempts, independently of Gemini. No per-frame assessment or landmark history is retained by the recap collector.

Confirmed squat categories include depth, torso lean, instability, stance-too-wide and stance-too-narrow episodes, toe direction, setup symmetry, hip centering, knee tracking, and heel lift where the selected view supports them. Curl categories retain swing, backward lean, hip drive, elbow drift, incomplete lowering and partial range, plus instability, movement control, torso lean, arm path and symmetry. Plank categories cover hips high/low, body-line deviation, hand placement, symmetry, centering and instability. Categories are derived from the existing confirmed local corrections; the recap adds no new form checks. A scalar sign of the existing plank hip-line offset distinguishes high and low hips without retaining coordinates.

To optionally enable Gemini locally:

1. Copy `.env.example` to `.env.local` (already gitignored).
2. Configure `GEMINI_API_KEY` and, if needed, `GEMINI_MODEL` with a structured-output-capable model available to your project. Never use a `VITE_` prefix for the key.
3. Restart `npm run dev`, or build and run `npm run preview`.

The shared Node-only handler is `server/recap.ts`. `server/viteRecap.ts` attaches it to Vite for development/preview; the standalone production server mounts it directly without Vite middleware. `npm run build` generates the public frontend in `dist/` and the separate server bundle in `dist-server/`. `npm start` serves both the frontend and `/api/session-recap` on `127.0.0.1:${PORT}`, default 3000. Production reads `GEMINI_API_KEY` and optional `GEMINI_MODEL` from the Node process environment only; it does not automatically load `.env.local`. The key is not compiled into either bundle. The Nginx template limits recap requests to 6/minute per client IP with a burst of 5; rejected requests still use the client fallback.

At most one Gemini request is made per End action, after the strict aggregate allowlist validates the payload. Requests contain text JSON only, with a 2.5-second server deadline. The requested JSON has exactly `headline` and `tips`. Gemini may select only short, exercise-specific predefined phrases supported by the measured issue categories; the server and client reject extra fields, long tips, unsupported claims and unknown phrases. Rep counts, hold times and scores always come directly from local metrics. The deterministic fallback ranks confirmed issues by episode count multiplied by mean severity (minimum severity weight 0.1), then count and peak severity for ties. Empty sessions receive neutral exercise-specific text without invented performance claims. No-key and synthetic-demo sessions make no Gemini call. The server does not log or persist summaries, and responses are marked `no-store`.

### Exact Gemini payload audit

Gemini is eligible for **all three real exercises: squat, curl and plank**, once after End only. Missing-key and synthetic-demo sessions make no Gemini call. The browser POSTs a strictly validated `SessionSummary` to `/api/session-recap`; the Node adapter validates it again before building the request. Unknown fields (including nested issue fields) are rejected rather than forwarded.

Common summary fields for every exercise are `exercise` (`squat`, `curl`, `plank`), `view` (`front`, `side`), `source` (`camera` for real requests), `averageAlignment`, `bestAlignment`, `validScoreSamples`, `enoughValidData`, `issues`, and `rejectedMovements`. Alignment values are nullable when no qualifying phase was observed. `enoughValidData` is true only when there are valid score samples plus at least one completed rep (squat/curl) or positive confirmed hold duration (plank). With insufficient movement data, only actually measured setup issues authorize advice; empty sessions receive no generic tips or praise. `rejectedMovements` currently counts locally rejected curl episodes; it stays zero for squat and plank and is not interpreted as evidence about those exercises.

| Exercise | Additional fields | Exact keys within `issues` |
| --- | --- | --- |
| Squat | `completedReps`, `qualityReps` | `shallowDepth`, `torsoLean`, `instability`, `stanceTooWide`, `stanceTooNarrow`, `toeDirection`, `setupSymmetry`, `hipCentering`, `kneeTracking`, `heelLift` |
| Curl | `completedReps`, `qualityReps` | `bodySwing`, `backwardLean`, `hipDrive`, `elbowDrift`, `incompleteLowering`, `partialRange`, `instability`, `control`, `torsoLean`, `armPath`, `armSymmetry` |
| Plank | `totalHoldMs`, `bestHoldMs` (milliseconds; no rep fields) | `hipsHigh`, `hipsLow`, `bodyLineDeviation`, `handPlacement`, `setupSymmetry`, `hipCentering`, `instability` |

Every issue entry contains exactly `count`, `averageSeverity`, `maxSeverity`. Only confirmed local corrections contribute; zero-count categories do not authorize advice.

The **complete Gemini JSON request body** is produced by the shared pure function `createGeminiPayload` in `src/recap/payload.ts`:

- `systemInstruction.parts[0].text`: fixed short-recap/grounding instructions.
- `contents[0].role`: `user`; `contents[0].parts[0].text`: serialized JSON `{summary, allowed}`, where `summary` has exactly the fields above and `allowed` contains the headline for the leading measured issue and tips restricted to the top two measured issue categories. Gemini cannot select torso alignment as the headline unless torso lean leads that same ranking.
- `generationConfig.responseMimeType`: `application/json`; `responseJsonSchema`: the fixed output shape with enums restricted to those allowed phrases; `maxOutputTokens`: `256`.

Press **D** or use **?debug=1** to see the developer-only **Gemini recap payload** section. During coaching it previews the prospective body without sending it. In the recap modal it shows the frozen ended-session body. The preview and server use the identical builder, and tests compare the displayed/buildable JSON with the actual mocked outbound body. The JSON preview alone is not proof of a call. Developer diagnostics now separately report `Gemini called`, `Displayed recap source`, the safe outcome reason, and the ranked issue list. The server returns sanitized outcome headers (`X-Gemini-Called`, `X-Recap-Source`, `X-Recap-Reason`); they never include credentials. If the browser cannot receive the server outcome, call status is explicitly Unknown and the displayed content is local fallback. The preview includes only derived session aggregates plus fixed instructions and phrase/schema metadata; it never displays headers or full Gemini responses.

Webcam frames, video recordings, screenshots, raw MediaPipe landmarks, per-frame pose history and identity/account data are never included in either recap request. API keys are never included in the summary, JSON body, debug preview or browser bundle. **Authentication distinction:** the server necessarily sends the configured key to Google's API in the `x-goog-api-key` authentication header; it does not send the key as model input. That server-only header, its value and full Gemini responses are not logged. `.env.local` stays gitignored. Live MediaPipe tracking, scores, corrections, rep counting and hold timing remain local and independent of Gemini.

API references: [Google's server-side key guidance](https://ai.google.dev/gemini-api/docs/api-key) and [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en). Tests mock Gemini and cover unavailable, slow, malformed and unsafe responses; a real paid API call is not part of the test suite.

## Privacy and delivery

Frames and landmarks stay in browser memory. Session recap counters also live only in memory; when Gemini is configured, only the ended-session aggregate summary is sent through the same-origin server endpoint to Gemini. No frames, images, video, coordinates, identity, or account data are included. Camera startup downloads MediaPipe WASM from jsDelivr and the pose model from Google; Google Fonts provides typography. Those asset requests never contain video or poses. Camera access requires localhost or HTTPS. Self-host these assets for offline camera use.

`npm run build` produces `dist/` plus `dist-server/index.mjs`; keep both directories together for production. Only `dist/` is publicly served. Deploy with the Node server and HTTPS reverse proxy below, rather than a static-only host. There is no database or account service. Rename the brand in `src/config.ts` and metadata in `index.html`.

Tests cover DOM card/retry/debug interactions, camera ownership, framing/recovery, movement gating, metric scores, and canvas arrow/target commands. DOM tests simulate permission responses; they do not replace a physical-webcam or rendered-browser check.

Squat entry simplification was informed by [Gym-AI-Trainer](https://github.com/gopalpatil15/Gym-AI-Trainer/blob/02b0e9572d3ae8f314cbebcb5147ae44e4d4cfd7/exercises/squat.py): smoothed pose measurements and a persistent bottom candidate. This implementation retains personal calibration and side-view checks; no source code was copied.


## Manual Vultr deployment (Ubuntu + systemd + Nginx)

Nothing is deployed automatically. Use your **existing** Ubuntu instance (these commands target Ubuntu 24.04 LTS), an SSH login with sudo, an existing domain/subdomain, and a repository URL accessible from that login. Commit and push this repository's changes from your computer first; never commit/copy `.env.local` to the public build. Node 24 LTS is recommended; the code also supports Node 22.12+. A small VM needs enough free memory for `npm ci` and the Vite build (about 2 GB is a practical starting point).

The request path is `HTTPS browser -> Nginx :443 -> Node 127.0.0.1:3000`. Node serves `dist`, `/health` and `/api/session-recap`. Gemini is optional and receives only the existing allowlisted aggregates after End. Runtime needs no database, Vite process or account system.

### 1. DNS and the Vultr dashboard (manual)

- At the domain's **authoritative DNS provider**, add an **A** record for your chosen hostname pointing to this instance's public IPv4. Use Vultr DNS only if your domain already delegates to it. Add **AAAA** only if the instance's IPv6 and IPv6 firewall are configured; remove a stale AAAA record for this hostname.
- In the existing instance's attached Vultr Firewall group, permit inbound TCP **80 and 443** from the Internet (IPv4, plus IPv6 if used). Do not expose 3000, 5173, or 4173. Preserve your management SSH access, ideally restricted to your own IP. No new instance or cloud resource is required.
- Keep the current SSH session open while changing firewall rules. Only 80/443 need public application access; SSH remains a separate restricted management exception. Review existing firewall rules before removing any rules needed by other applications on the instance.

### 2. SSH, prerequisites and source

Connect from your computer, replacing the login/IP:

```bash
ssh YOUR_SSH_USER@YOUR_VULTR_IP
```

In that Ubuntu SSH shell, set these **non-secret** values. Replace the examples, including the branch if it is not `main`:

```bash
REPO_URL='https://github.com/YOUR_USER/YOUR_REPO.git'
BRANCH='main'
DOMAIN='repready.example.com'
EMAIL='you@example.com'
ADMIN_IP='YOUR_CURRENT_PUBLIC_IP'
SSH_PORT='22'

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git nginx ufw snapd dnsutils
```

Install Node 24 from NodeSource if a supported Node version is not already installed (do not replace an existing runtime used by other applications without checking them):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/repready-node-setup.sh
sudo bash /tmp/repready-node-setup.sh
sudo apt-get install -y nodejs
node --version
npm --version
```

The supplied systemd unit uses `/usr/bin/node`. If you already manage Node at another system path, update `ExecStart` accordingly. Do not point the service at a per-user nvm directory under `/home`: the unit deliberately hides home directories.

For the first installation:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0755 /opt/repready
git clone --branch "$BRANCH" "$REPO_URL" /opt/repready
cd /opt/repready
npm ci
npm test
npm run build
chmod -R a+rX dist dist-server
```

Use an SSH repository URL and your existing deploy credentials if the repository is private; do not put a repository token in these commands. Do not use `npm ci --omit=dev` before building: TypeScript, Vite and esbuild are build dependencies. Runtime uses the compiled server bundle and Node built-ins.

### 3. Server-only environment and persistent process

Create the unprivileged runtime user and a root-only secret file **outside the checkout**:

```bash
id -u repready >/dev/null 2>&1 || sudo useradd --system --user-group --home-dir /opt/repready --no-create-home --shell /usr/sbin/nologin repready
sudo install -d -m 0700 /etc/repready
sudo touch /etc/repready/repready.env
sudo chown root:root /etc/repready/repready.env
sudo chmod 0600 /etc/repready/repready.env
sudoedit /etc/repready/repready.env
```

In the editor, enter these names, then paste your key **there**, not in a shell command, Git, browser source, or a `VITE_` variable:

```dotenv
PORT=3000
GEMINI_API_KEY=
GEMINI_MODEL=
```

Leaving `GEMINI_API_KEY` empty deliberately uses the local fallback. `GEMINI_MODEL` is an actual optional override consumed by the shared handler; leave it blank for the existing default or use a structured-output model enabled for your Google project. systemd reads this file as root and supplies it to Node; the runtime user does not need permission to read the file itself. The template sets `NODE_ENV=production`.

```bash
sudo install -m 0644 deploy/repready.service /etc/systemd/system/repready.service
sudo systemctl daemon-reload
sudo systemctl enable --now repready
sudo systemctl status repready --no-pager
curl --fail http://127.0.0.1:3000/health
sudo ss -ltn '( sport = :3000 )'
```

Expect `{"status":"ok"}` and only `127.0.0.1:3000`. If you change `PORT`, also change both upstream ports in `deploy/nginx.conf` and the health commands. After editing the environment file, use `sudo systemctl restart repready`. Routine diagnostics are `sudo journalctl -u repready -n 50 --no-pager`; the app logs startup/errors only, never keys, authorization headers, request bodies or full Gemini responses. `/health` contains no model, environment or session details.

### 4. Nginx and host firewall

Install the supplied domain-specific reverse proxy; keep existing unrelated sites intact:

```bash
sed "s/REPLACE_WITH_DOMAIN/${DOMAIN}/g" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/repready >/dev/null
sudo ln -sfn /etc/nginx/sites-available/repready /etc/nginx/sites-enabled/repready
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

sudo ufw allow from "$ADMIN_IP" to any port "$SSH_PORT" proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status numbered
```

Stop if `nginx -t` fails. Review UFW's listed rules: existing broad SSH/Node-port allows remain until you remove them. Keep restricted SSH working before removing a broad SSH rule. Match these rules in any attached Vultr firewall; neither firewall should expose the Node port. If UFW was already configured, preserve any necessary management rules before enabling it. Nginx forwards the original hostname so the recap handler's same-origin check works; `/api/session-recap` allows only the existing JSON aggregate schema and an 8 KB body, with no upload endpoint.

### 5. Let's Encrypt and final checks

Wait until DNS resolves to the Vultr instance and HTTP reaches this application:

```bash
dig +short A "$DOMAIN"
dig +short AAAA "$DOMAIN"
curl --fail "http://${DOMAIN}/health"
```

If Certbot is already installed and renewing other sites, use that installation. Otherwise install the recommended snap:

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive -m "$EMAIL"
sudo /snap/bin/certbot renew --dry-run
curl --fail "https://${DOMAIN}/health"
curl -I "http://${DOMAIN}/"
curl -I "https://${DOMAIN}/"
```

Certbot adds the TLS listener/certificate and HTTP-to-HTTPS redirect to the installed Nginx site. Keep port 80 reachable for HTTP certificate renewal. Do not overwrite that Certbot-edited live configuration with the original HTTP template on routine app updates.

### Deployment checklist

- [ ] Both Node health checks return only `{"status":"ok"}`; plain HTTP redirects to HTTPS after certificate setup.
- [ ] `systemctl is-active repready` succeeds; `systemctl is-enabled repready` confirms reboot persistence. Nginx is active and certificate renewal dry-run passes.
- [ ] Node listens on loopback only. Public application ingress is 80/443; management SSH is restricted. No key-bearing files are in `dist` or Git.
- [ ] Visit `https://YOUR_DOMAIN` on your own computer/phone, allow camera permission for **that HTTPS hostname**, and try squat, curl and plank. The raw public-IP HTTP URL is not a valid production webcam test.
- [ ] Check browser DevTools Network: live coaching uploads no frames/images/landmarks. End a real session: exactly one same-origin `POST /api/session-recap`, then the recap modal. Payload is aggregates only; inspect the existing D / `?debug=1` developer preview if needed.
- [ ] With a blank key, End still shows a local recap. With a configured key, debug shows Gemini's safe outcome or a local fallback. No API error appears to normal users. Tests cover offline/slow/invalid Gemini; a model/key failure must not affect live exercise coaching.
- [ ] The server permits outbound HTTPS for Gemini. The browser can fetch the existing MediaPipe assets and fonts. No video is sent in those asset downloads.

### Updates, restarts and rollback

For a normal code update, use a short maintenance window. Build artifacts are replaced in place, so stop the service before rebuilding. Run from `/opt/repready`, with the same deployment login; keep the old commit recorded:

```bash
cd /opt/repready
PREVIOUS_COMMIT=$(git rev-parse HEAD)
printf '%s\n' "$PREVIOUS_COMMIT" | sudo tee /etc/repready/previous-commit >/dev/null
```

Then, using your checked-out deployment branch:

```bash
sudo systemctl stop repready
git pull --ff-only
npm ci
npm test
npm run build
chmod -R a+rX dist dist-server
sudo systemctl start repready
curl --fail http://127.0.0.1:3000/health
```

Stop on any failed command. If an update/build fails, leave the service stopped until the old version is restored. For rollback, restore the recorded commit (it must contain this production server):

```bash
cd /opt/repready
sudo systemctl stop repready
PREVIOUS_COMMIT=$(sudo cat /etc/repready/previous-commit)
git switch --detach "$PREVIOUS_COMMIT"
npm ci
npm run build
chmod -R a+rX dist dist-server
sudo systemctl start repready
curl --fail http://127.0.0.1:3000/health
```

The root-only environment, Nginx TLS configuration and certificates stay in place. Before a later update, switch back to your deployment branch with `git switch main` (or your actual branch). There are no database migrations. A configuration-only key/model change needs only `sudo systemctl restart repready`; do not paste environment output into logs or support requests.

Reference setup: [Node LTS releases](https://nodejs.org/en/about/previous-releases), [NodeSource Ubuntu packages](https://github.com/nodesource/distributions/blob/master/DEV_README.md), [Nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), and [Certbot Nginx instructions](https://certbot.eff.org/instructions?os=snap&ws=nginx).
