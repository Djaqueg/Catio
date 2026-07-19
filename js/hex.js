const SQRT3 = Math.sqrt(3);

export const HEX_SIZE = 42;

export function axialToPixel(q, r, size = HEX_SIZE) {
  return {
    x: size * (SQRT3 * q + (SQRT3 / 2) * r),
    y: size * ((3 / 2) * r),
  };
}

export function pixelToAxial(x, y, size = HEX_SIZE) {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return axialRound(q, r);
}

function axialRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function axialKey(q, r) {
  return `${q},${r}`;
}

export function parseKey(key) {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexNeighbors(q, r) {
  const dirs = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ];
  return dirs.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

export function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function generateInitialHexes(range) {
  const hexes = new Map();
  for (let q = -range; q <= range; q++) {
    for (let r = -range; r <= range; r++) {
      if (Math.abs(q + r) <= range) {
        hexes.set(axialKey(q, r), { q, r, building: null, level: 1 });
      }
    }
  }
  return hexes;
}

export function getHexCorners(cx, cy, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

export function isAdjacentToOwned(hexKey, hexes) {
  const { q, r } = parseKey(hexKey);
  return hexNeighbors(q, r).some((n) => hexes.has(axialKey(n.q, n.r)));
}

export function findExpandablePositions(hexes) {
  const expandable = new Set();
  hexes.forEach((_, key) => {
    const { q, r } = parseKey(key);
    hexNeighbors(q, r).forEach((n) => {
      const nk = axialKey(n.q, n.r);
      if (!hexes.has(nk)) expandable.add(nk);
    });
  });
  return expandable;
}

export function getTilesInRange(centerKey, hexes, range) {
  const center = parseKey(centerKey);
  const result = [];
  hexes.forEach((hex, key) => {
    if (hexDistance(center, hex) <= range) result.push(key);
  });
  return result;
}
