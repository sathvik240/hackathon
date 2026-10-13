// Where landmarks come from: the camera through MediaPipe Pose Landmarker,
// or the simulated rescuer. Both expose frame(now) -> landmarks | null |
// undefined (undefined = no new video frame yet) and a size.

import { simulatedPose } from '../core/sim.js';

const MEDIAPIPE_VERSION = '0.10.35';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let landmarkerPromise = null;

// Prefers the copies served by our own server (works on bad venue Wi-Fi),
// falls back to the CDN.
export function loadLandmarker({ localMediapipe = true, localModel = false } = {}) {
  landmarkerPromise ??= (async () => {
    const bases = localMediapipe ? ['/vendor/mediapipe', CDN] : [CDN];
    let vision = null;
    let base = null;
    for (const candidate of bases) {
      try {
        vision = await import(`${candidate}/vision_bundle.mjs`);
        base = candidate;
        break;
      } catch (err) {
        console.warn('[bystander] could not load MediaPipe from', candidate, err);
      }
    }
    if (!vision) throw new Error('Could not load the pose tracker.');
    const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: localModel ? '/models/pose_landmarker_lite.task' : REMOTE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await vision.PoseLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      console.warn('[bystander] GPU pose tracking failed, using CPU', err);
      return vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
    }
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; });
  return landmarkerPromise;
}

export class CameraSource {
  constructor(video, landmarker) {
    this.video = video;
    this.landmarker = landmarker;
    this.stream = null;
    this.lastTime = -1;
    this.lastStamp = 0;
    this.kind = 'camera';
  }

  async open(facingMode = 'user') {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = this.stream;
    this.video.hidden = false;
    await this.video.play();
    this.facingMode = facingMode;
    return this;
  }

  get size() {
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  frame(now) {
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastTime || !v.videoWidth) return undefined;
    this.lastTime = v.currentTime;
    // MediaPipe needs strictly increasing timestamps.
    const stamp = Math.max(now, this.lastStamp + 1);
    this.lastStamp = stamp;
    const result = this.landmarker.detectForVideo(v, stamp);
    return result?.landmarks?.[0] || null;
  }

  stop() {
    for (const track of this.stream?.getTracks?.() || []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }
}

export class SimSource {
  constructor({ width, height }) {
    this.width = width;
    this.height = height;
    this.kind = 'sim';
    this.opts = { rate: 110, depthCm: 5.5, elbowBend: 0, lean: 5, noise: 0.003 };
    this.phase = 0;
    this.last = null;
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  frame(now) {
    const dt = this.last === null ? 0 : Math.min(100, now - this.last);
    this.last = now;
    this.phase = (this.phase + (dt / 60000) * this.opts.rate) % 1;
    return simulatedPose(now, { ...this.opts, phase: this.phase, width: this.width, height: this.height });
  }

  stop() {}
}
