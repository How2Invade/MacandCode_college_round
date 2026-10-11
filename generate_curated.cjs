const v = require('@mediapipe/tasks-vision');
const tess = v.FaceLandmarker.FACE_LANDMARKS_TESSELATION;

const selectedVertices = new Set([
  10, 151, 9, 8, 107, 66, 336, 296, 69, 108, 337, 299, 298, 68, 71, 301, 104, 333,
  116, 117, 118, 119, 100, 120, 345, 346, 347, 348, 329, 349, 205, 206, 207, 425, 426, 427, 
  50, 280, 234, 454, 132, 361,
  127, 162, 356, 389,
  143, 372, 230, 450, 227, 447
]);

const sparse = [];
const seen = new Set();
for (const e of tess) {
  if (selectedVertices.has(e.start) && selectedVertices.has(e.end)) {
    const key = e.start < e.end ? `${e.start},${e.end}` : `${e.end},${e.start}`;
    if (!seen.has(key)) {
      seen.add(key);
      sparse.push({start: Math.min(e.start, e.end), end: Math.max(e.start, e.end)});
    }
  }
}
console.log(JSON.stringify(sparse));
