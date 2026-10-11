const v = require('@mediapipe/tasks-vision');
const tess = v.FaceLandmarker.FACE_LANDMARKS_TESSELATION;
const contours = [
  ...v.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  ...v.FaceLandmarker.FACE_LANDMARKS_LIPS,
  ...v.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...v.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...v.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ...v.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW
];

const edgeStr = (e) => e.start < e.end ? `${e.start},${e.end}` : `${e.end},${e.start}`;
const contourSet = new Set(contours.map(edgeStr));

// deduplicated tessellation
const dedupTess = [];
const seen = new Set();
for (const e of tess) {
  const str = edgeStr(e);
  if (!contourSet.has(str) && !seen.has(str)) {
    seen.add(str);
    dedupTess.push(e);
  }
}

// How to reduce density? Let's just take a subset of triangles.
// A triangle is 3 edges. Let's find all triangles.
const adj = {};
for (const e of dedupTess) {
  if (!adj[e.start]) adj[e.start] = new Set();
  if (!adj[e.end]) adj[e.end] = new Set();
  adj[e.start].add(e.end);
  adj[e.end].add(e.start);
}

const triangles = [];
const triSeen = new Set();
for (const u of Object.keys(adj).map(Number)) {
  for (const v of adj[u]) {
    if (v > u) {
      for (const w of adj[v]) {
        if (w > v && adj[u].has(w)) {
          triangles.push([u, v, w]);
        }
      }
    }
  }
}

// Keep a subset of non-adjacent triangles?
// Or just keep the dedupTess and apply it in the code?
console.log(`Original tessellation edges: ${tess.length}`);
console.log(`Deduplicated tessellation without contours: ${dedupTess.length}`);

const sparse = [];
const usedVertices = new Set();
// A simple way to make it sparse: iterate through dedupTess and only add an edge if neither of its vertices has more than 3 edges in the new sparse graph.
const degree = {};
for (const e of dedupTess) {
  const u = e.start;
  const v = e.end;
  degree[u] = degree[u] || 0;
  degree[v] = degree[v] || 0;
  if (degree[u] < 3 && degree[v] < 3) {
    sparse.push(e);
    degree[u]++;
    degree[v]++;
  }
}
console.log(`Sparse mesh edges: ${sparse.length}`);
