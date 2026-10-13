# Bystander: demo script and judge Q&A

## The one-liner

When someone collapses, the person next to them has to do two things at once: push hard and fast on the chest, and talk to 911. Bystander does the second one for them, and coaches the first.

## Setup (10 minutes before)

- [ ] Server running with `ANTHROPIC_API_KEY`, the Twilio variables, and `PUBLIC_URL` set to your tunnel. Run `npm run fetch-model` once so pose tracking works on bad Wi-Fi.
- [ ] Teammate's phone is the `BYSTANDER_DISPATCH_NUMBER`. On a Twilio trial, verify it first and practice pressing a key at the trial notice.
- [ ] Laptop open to the dispatcher console link printed by the server, **Go on duty** pressed. This is the backup phone line, and it mirrors the real call's transcript for the room.
- [ ] Demo phone on a tripod, **side-on**, 1.5 to 2 m from a pillow or manikin, at chest height. Open the app over the HTTPS tunnel, allow camera, microphone, and location.
- [ ] In Settings, enter the venue address and your callback number.
- [ ] Do one 30-second *Train now* round to confirm tracking ("Tracking" pill, needle moving).

## The 60 seconds

| Time | What happens | Say |
|---|---|---|
| 0:00 | Judge kneels at the pillow. Tap **Someone collapsed**, then **Yes, start CPR**. | "Someone just collapsed. One tap." |
| 0:05 | Coach starts with the beat; the teammate's phone rings at the same moment. | "Two agents start at once: a coach on the camera, and a caller on the phone." |
| 0:10 | Judge pushes. The rate number goes green; the coach says "Good." | "It's counting their compressions from the video, 112 a minute." |
| 0:20 | Teammate answers on speaker. The AI briefs: demo call, collapsed adult, address, GPS, CPR time, compressions, rate, callback. | "That briefing is live data from this phone, not a script." |
| 0:30 | Teammate asks "Is he breathing?" and then "Tell them help is four minutes out." The answer streams back; the message appears and is spoken on the coach phone. | "The dispatcher can talk to the bystander through the agent." |
| 0:40 | Judge slows down or bends elbows: "Faster." / "Lock your elbows." Tap **AED is here**: the caller tells the dispatcher. | "Real-time corrections, and the caller keeps 911 updated without anyone picking up the phone." |
| 0:50 | Tap **End**. Scorecard: rate, compressions at the right speed, hands-on time, longest pause, elbows, estimated depth. | "Scored against American Heart Association targets. *Train now* is this without the call, so people practice before it's real." |

## If something breaks

| Failure | Backup |
|---|---|
| Twilio or cell signal | Unset the Twilio variables and restart. The call rings the dispatcher console on the laptop, which speaks the briefing and takes questions by voice. |
| Claude slow or down | Nothing to do. The caller falls back to rule-based answers mid-call. |
| Camera or tracking won't lock | Add `?sim` to the URL. A simulated rescuer drives the same pipeline; ↑/↓ changes the rate, `E` bends the elbows. |
| Venue Wi-Fi blocks the CDN | `npm run fetch-model` beforehand. The MediaPipe library is already served from `node_modules`. |

## Judge Q&A

**Can a camera really measure CPR?** Rate and count, yes: they come from the timing of the hands' up-and-down motion, which pose tracking follows well. In tests with a simulated rescuer from 80 to 140 per minute at 12 to 60 frames per second, the measured rate lands within 4 per minute. The next step is validating against a feedback manikin. Elbow lock and shoulder position come from joint angles in a side view. Depth is the hard part from a single camera, so we estimate it with the rescuer's arm as a ruler, label it "est.", and don't grade it.

**Why no heart rate from the camera?** A person in cardiac arrest has no pulse, and compressions would swamp any signal. Showing one would be wrong and dangerous.

**Does it call 911?** Not in this prototype, and it can't by accident. The number comes only from server config, must be a full international number, and short emergency codes are refused even if configured. Every call opens with "This is a training demo call." Real deployment would need emergency-services partnerships (and text-to-911 / NG911 data paths).

**What stops the AI from making things up to a dispatcher?** The opening briefing is a template filled from the record, not generated. Follow-up answers get a fact sheet and an instruction to state only what's in it and say "I don't know" otherwise. If Claude fails or refuses, rule-based answers take over, and those only read from the record.

**How is this different from existing CPR feedback apps?** Pose-based CPR feedback exists. The new part is the second agent: hands-free, real-time communication with the dispatcher, driven by the same live measurements, while the coach keeps the rescuer on pace.

**Why would anyone have it open before an emergency?** *Train now* is a 30-second-to-2-minute CPR practice with a score. That's the habit loop, and it's also how a school, gym, or office would roll it out.

**Privacy?** Video never leaves the phone; pose tracking runs in the browser. The server only receives numbers, location, and the bystander's reports, kept in memory for at most 3 hours.

## What's next

- Dispatcher-assisted CPR protocols: structured handoff fields for CAD systems and NG911.
- Real AED registries in addition to OpenStreetMap, and AED pad-placement coaching from the camera.
- On-device depth from manikin markers or the phone's depth sensor where available.
- Clinical review of every script, and a validation study of rate and form accuracy against a feedback manikin.
