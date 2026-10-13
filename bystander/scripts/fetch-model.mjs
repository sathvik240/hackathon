// Downloads the MediaPipe pose model into public/models so pose tracking
// works without internet at the venue. The MediaPipe library and its
// WebAssembly files already come from node_modules.
//
//   npm run fetch-model

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const file = path.join(dir, 'pose_landmarker_lite.task');

try {
  const info = await stat(file);
  if (info.size > 1_000_000) {
    console.log(`Already have ${path.relative(process.cwd(), file)} (${(info.size / 1e6).toFixed(1)} MB).`);
    process.exit(0);
  }
} catch {
  // Not downloaded yet.
}

console.log(`Downloading ${URL}`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`Download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer());
await mkdir(dir, { recursive: true });
await writeFile(file, body);
console.log(`Saved ${path.relative(process.cwd(), file)} (${(body.length / 1e6).toFixed(1)} MB).`);
