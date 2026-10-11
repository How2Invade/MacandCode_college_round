const v = require('@mediapipe/tasks-vision');
const tess = v.FaceLandmarker.FACE_LANDMARKS_TESSELATION;
const has = (u,v) => tess.some(e => (e.start==u && e.end==v) || (e.start==v && e.end==u));

const leftLow = [50, 117, 118, 119, 120, 100];
const rightLow = [280, 346, 347, 348, 349, 329];

console.log(leftLow.slice(0,-1).every((u,i) => has(u, leftLow[i+1])));
console.log(rightLow.slice(0,-1).every((u,i) => has(u, rightLow[i+1])));
