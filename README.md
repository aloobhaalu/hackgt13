# RepReady

Real-time webcam form coaching for bodyweight squats, standing dumbbell curls, and high planks

**Live HTTPS app:** (https://repready.tech/)

RepReady combines local pose tracking, visual correction targets, short live coaching cues, Form Alignment, and an optional post-session recap. Squats and curls have a rep counter, planks have a hold timer.

## Inspiration

In 2024, U.S. emergency departments treated 564,845 injuries involving exercise and exercise equipment. [National Safety Council](https://injuryfacts.nsc.org/home-and-community/safety-topics/sports-and-recreational-injuries/) While not every injury is preventable or caused by form, uncertainty around posture, balance, range of motion, and body positioning is an avoidable barrier for many people.

This felt personal to me. When I have exercised without knowing whether my posture was correct, I have been left wondering whether discomfort was a normal part of working out or a sign that I was doing something incorrectly. That uncertainty can make it easier to avoid the gym altogether or leave a workout worried that something felt wrong. Working out should feel empowering, not intimidating.

## What RepReady does

RepReady makes real-time form guidance more accessible for people exercising independently. It tracks a user’s pose through a webcam and overlays visual targets directly onto their movement, helping them see where their body is aligned and where an adjustment may be needed. It also provides Form Alignment and a short session recap so users can recognize patterns in their movement. For this prototype, RepReady focuses on bodyweight squats, standing dumbbell curls, and high planks — common exercises where form issues can be hard to notice on your own. RepReady is an approachable visual starting point to help people move with more confidence and reduce avoidable form-related risk.

## Process

RepReady was built around the idea that exercise feedback should be easy to understand while someone is actually moving. This project was especially iterative because I wanted the feedback to feel genuinely helpful, not like a score that changed for no clear reason. Using React, TypeScript, Vite, and MediaPipe Pose Landmarker, I created a camera-first web experience with animated exercise previews and visual targets that appear directly over the user’s movement. I built the local logic behind joint angles, torso tilt, hip movement, elbow position, and separate front and side view checks. One of the hardest parts was recognizing real movement instead of a single pose, so I created local state machines for squats and curls that follow the user from the starting position through the movement and back again; this is what allows the app to count completed reps. Testing showed me that overly strict rules made the app frustrating, so I refined calibration timing, allowed natural squat reversals, and separated rep counting from form quality (because an imperfect but recognizable rep should still count :)). I also strengthened the visual contrast of targets and added compact cues for adjustments that are harder to communicate through arrows alone. Finally, I added a Gemini-powered post-session recap that turns derived session metrics into a short, personalized takeaway.

## Challenges

Computer vision was completely new to me, so getting comfortable with MediaPipe and figuring out how its landmarks could become useful exercise feedback took time and more than a few YouTube videos. I am also not a gym expert, so I had to learn about exercise form alongside the technology. At one point during the hackathon, I was genuinely walking around asking people whether I was squatting correctly, whether my feet were positioned properly, and what the movement was actually supposed to look like. If I came to you for help, shout-out to you!

The process was incredibly iterative. Sometimes the app could see my body perfectly but would not count a rep :( other times, it kept asking me to stand tall while I was already mid-squat. I kept testing, adjusting thresholds, changing calibration timing, and returning to the same logic again and again. The hardest part was finding a balance: recognizing a real rep even when someone’s form is imperfect, while avoiding false counts from random movement or a static pose.

## Accomplishments and what I learned

I’m most proud that RepReady became my first solo hackathon project built from scratch and deployed as a live HTTPS web app. Computer vision was completely new territory for me, so learning how MediaPipe tracks body landmarks (and how smoothing, calibration, movement states, and thresholds turn those simple points into useful feedback) was a huge accomplishment. I also learned far more about exercise form than I expected, things like understanding why a stance, torso position, or range of motion is incorrect was necessary before I could build a visual correction for it. That research made the injury-prevention goal feel much more real to me. I’m also pretty sure I have done more squats in the past two days than during the rest of this year combined, so learning the stance properly counts too! Seeing the rep counter finally work and the feedback respond to my actual movements felt especially rewarding, considering how far away that seemed only a day earlier. Beyond the technical work, this project pushed me outside my comfort zone to ask people for feedback and help. I also learned that iteration is not a sign that something is failing but instead how you keep improving an idea until it finally becomes real. 

## What is next for RepReady

- Expand exercise coverage: Add more exercises! I originally considered machine exercises coaching for this prototype, but practical access to equipment and recording space made it unrealistic within one hackathon weekend.
- Explore AR/VR coaching: Extend RepReady into an immersive experience where visual posture targets appear through AR glasses or a VR training environment.
- Improve form evaluation: Continue tuning pose thresholds using more real-world testing across different body types, camera positions, lighting, clothing, and exercise styles.

## Built with

React, TypeScript, Vite, MediaPipe Pose Landmarker, Google Gemini, Node.js, HTML, CSS, Vultr, Ubuntu, Nginx

## Run locally

You need **Node.js 22.12 or newer**, npm, a webcam, and a browser with camera access. An internet connection is needed to load the pose model and runtime assets on first use.

```sh
git clone https://github.com/aloobhaalu/hackgt13.git
cd hackgt13
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173`. Choose an exercise and camera view, allow camera access, and follow the setup feedback. Side view is recommended for squats and planks; front view is recommended for curls. Browser camera access works on localhost during development; the deployed app uses HTTPS.

On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks npm scripts.

### Optional Gemini recap

The app works without an API key and provides a local recap fallback. To enable Gemini during development, copy `.env.example` to `.env.local`, set `GEMINI_API_KEY`, and restart the development server. `GEMINI_MODEL` is an optional override.

The key stays in server-side Node code. Do not prefix it with `VITE_` or commit `.env.local`.

### Check or build

```sh
npm test
npm run build
npm run start
```

The production server serves the built frontend and recap endpoint at `http://127.0.0.1:3000`. It reads server environment variables; it does not automatically load `.env.local`. HTTPS for a public deployment is handled by Nginx.

## Privacy and reliability

- Webcam pose processing, Form Alignment, live feedback, and rep counting run locally in the browser
- Gemini is optional and is requested at most once after a real session ends
- The recap request contains derived aggregate session metrics, never webcam frames, recordings, screenshots, raw landmarks, or identity data
- If Gemini is unavailable, slow, or returns invalid output, the app uses a deterministic local recap
- No database or account is required
