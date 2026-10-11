const lines = [
  // Forehead arch
  [71, 68, 104, 69, 108, 151, 337, 299, 333, 298, 301],
  // Forehead top edge (near hairline)
  [162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389],
  // Left cheekbone structure
  [116, 143, 227, 234, 127, 162],
  [50, 117, 118, 119, 120, 100],
  // Right cheekbone structure
  [345, 372, 447, 454, 356, 389],
  [280, 346, 347, 348, 349, 329]
];

const edges = [];
for (const line of lines) {
  for (let i = 0; i < line.length - 1; i++) {
    edges.push({ start: line[i], end: line[i+1] });
  }
}
console.log(JSON.stringify(edges));
