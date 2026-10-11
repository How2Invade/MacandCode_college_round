const v = require('@mediapipe/tasks-vision');
const tess = v.FaceLandmarker.FACE_LANDMARKS_TESSELATION;

const adj = Array.from({length: 478}, () => new Set());
for (const e of tess) {
  adj[e.start].add(e.end);
  adj[e.end].add(e.start);
}

function bfsPath(start, end) {
  const dist = Array(478).fill(-1);
  const parent = Array(478).fill(-1);
  const q = [start];
  dist[start] = 0;
  let head = 0;
  while(head < q.length) {
    const u = q[head++];
    if (u === end) break;
    for (const neighbor of adj[u]) {
      if (dist[neighbor] === -1) {
        dist[neighbor] = dist[u] + 1;
        parent[neighbor] = u;
        q.push(neighbor);
      }
    }
  }
  const edges = [];
  let curr = end;
  while(curr !== start && curr !== -1) {
    const p = parent[curr];
    if (p !== -1) edges.push({start: p, end: curr});
    curr = p;
  }
  return edges;
}

const sparseEdges = [];
const addPaths = (pairs) => {
  for (const [s, e] of pairs) {
    sparseEdges.push(...bfsPath(s, e));
  }
};

// Anchors
const noseTip = 4, noseBridge = 168, foreheadCenter = 10, chin = 152;
const leftCheek = 234, rightCheek = 454;
const leftEyeOuter = 130, rightEyeOuter = 359;
const leftCheekbone = 116, rightCheekbone = 345;
const leftJaw = 132, rightJaw = 361;
const leftTemple = 71, rightTemple = 301;
const leftMouthOuter = 61, rightMouthOuter = 291;

const pairs = [
  // Verticals
  [10, 168], [168, 4], [4, 152],
  // Inner cheek loops
  [168, 116], [116, 4], [4, 345], [345, 168],
  // Outer cheek loops
  [71, 234], [234, 132], [132, 152], [152, 361], [361, 454], [454, 301],
  // Eyes to cheeks
  [130, 234], [359, 454],
  // Mouth to cheeks
  [61, 132], [291, 361],
  // Temple to forehead
  [71, 10], [10, 301],
  // Horizontal cross
  [234, 116], [345, 454]
];

addPaths(pairs);
const dedup = Array.from(new Set(sparseEdges.map(e => e.start < e.end ? `${e.start},${e.end}` : `${e.end},${e.start}`))).map(str => {
  const [start, end] = str.split(',').map(Number);
  return {start, end};
});

console.log(JSON.stringify(dedup));
console.log(dedup.length);
