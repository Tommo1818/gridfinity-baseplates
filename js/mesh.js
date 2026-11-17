import { GRIDFINITY_PITCH, TAB_PROTRUSION_MM } from './planner.js';

const ARC_SEGMENTS = 8; // 8 segments per corner -> 36 vertices per cell ring

// Standard Solid (4.65 mm) constants
const STD_H_BOTTOM = 0.7;
const STD_H_VERT = 1.8;
const STD_H_TOP = 2.15;
export const STANDARD_SOCKET_HEIGHT = STD_H_BOTTOM + STD_H_VERT + STD_H_TOP; // 4.65 mm

// Fast Lightweight (4.25 mm) constants
const FAST_H_VERT = 2.5;
const FAST_H_TOP = 1.75;
export const FAST_SOCKET_HEIGHT = FAST_H_VERT + FAST_H_TOP; // 4.25 mm
const FAST_GROOVE_HALF = 1.33; // Leaves 0.82 mm wall on each side of divider
const FAST_GROOVE_WALL_H = 2.16;
const FAST_GROOVE_PEAK_H = 3.49;

// Grid-rim constants (shared with 2D SVG map)
export const RIM_OUTER_WALL = 1.6;
export const RIM_INNER_COLLAR = 1.2;
export const RIM_RIB_THICKNESS = 1.6;
export const MIN_GRID_RIM_PAD = RIM_OUTER_WALL + RIM_INNER_COLLAR + 2.0; // 4.8 mm

// Interlocking dovetail connector constants (0.20 mm lateral & end clearance, 0.10 mm Z clearance)
const TAB_HALF_NECK = 2.2;
const TAB_HALF_TIP = 2.8;
const TAB_HEIGHT = 2.1;
const SLOT_HALF_NECK = 2.4;
const SLOT_HALF_TIP = 3.0;
const SLOT_DEPTH = 1.25;
const SLOT_HEIGHT = 2.2;
const SLOT_ROOF_Z = 3.45; // 2.20 + 1.25 (45 deg self-supporting roof)

function sumArr(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

function buildCellRingRect(xA, xD, yA, yD, r, z) {
  const pts = new Array(36);
  const corners = [
    { x: xD - 4, y: yA + 4, startAngle: -Math.PI / 2 }, // Corner 0: Bottom-Right
    { x: xD - 4, y: yD - 4, startAngle: 0 }, // Corner 1: Top-Right
    { x: xA + 4, y: yD - 4, startAngle: Math.PI / 2 }, // Corner 2: Top-Left
    { x: xA + 4, y: yA + 4, startAngle: Math.PI }, // Corner 3: Bottom-Left
  ];
  let idx = 0;
  for (let c = 0; c < 4; c++) {
    const corner = corners[c];
    for (let s = 0; s <= ARC_SEGMENTS; s++) {
      const a = corner.startAngle + (s / ARC_SEGMENTS) * (Math.PI / 2);
      pts[idx++] = [corner.x + r * Math.cos(a), corner.y + r * Math.sin(a), z];
    }
  }
  return pts;
}

class TriangleCollector {
  constructor() {
    this.coords = [];
  }

  tri(a, b, c) {
    this.coords.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  toBuffers() {
    const triCount = this.coords.length / 9;
    const positions = new Float32Array(this.coords);
    const normals = new Float32Array(this.coords.length);
    let volume6 = 0;

    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i];
      const ay = positions[i + 1];
      const az = positions[i + 2];
      const bx = positions[i + 3];
      const by = positions[i + 4];
      const bz = positions[i + 5];
      const cx = positions[i + 6];
      const cy = positions[i + 7];
      const cz = positions[i + 8];

      volume6 +=
        ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx);

      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;

      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      for (let k = 0; k < 3; k++) {
        normals[i + k * 3] = nx;
        normals[i + k * 3 + 1] = ny;
        normals[i + k * 3 + 2] = nz;
      }
    }

    const volumeMm3 = Math.max(0, volume6 / 6);
    return { positions, normals, triCount, volumeMm3 };
  }
}

function buildAxisOffsets(sizes) {
  const offsets = [0];
  let acc = 0;
  for (const s of sizes) {
    acc += s;
    offsets.push(acc);
  }
  return offsets;
}

function buildGridBreaksFromSizes(sizes) {
  const breaks = [0];
  let acc = 0;
  for (const s of sizes) {
    breaks.push(acc + 4, acc + s - 4, acc + s);
    acc += s;
  }
  return breaks;
}

function buildRimCellSegmentsFromSizes(sizes) {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    const a = acc;
    const b = acc + s;
    const ribA = a + (i === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2);
    const ribB = b - (i === sizes.length - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2);
    segs.push({ a, ribA, ribB, b, cellB: a + 4, cellC: b - 4 });
    acc = b;
  }
  return segs;
}

function emitTopAndOptionalBottomQuad(tc, x0, x1, y0, y1, zTop, solidBottom) {
  tc.quad([x0, y0, zTop], [x1, y0, zTop], [x1, y1, zTop], [x0, y1, zTop]);
  if (!solidBottom) {
    tc.quad([x0, y1, 0], [x1, y1, 0], [x1, y0, 0], [x0, y0, 0]);
  }
}

function emitCutoutPocket(tc, x0, x1, y0, y1, zBot, zTop, solidBottom) {
  tc.quad([x0, y0, zBot], [x0, y1, zBot], [x0, y1, zTop], [x0, y0, zTop]);
  tc.quad([x1, y1, zBot], [x1, y0, zBot], [x1, y0, zTop], [x1, y1, zTop]);
  tc.quad([x1, y0, zBot], [x0, y0, zBot], [x0, y0, zTop], [x1, y0, zTop]);
  tc.quad([x0, y1, zBot], [x1, y1, zBot], [x1, y1, zTop], [x0, y1, zTop]);
  if (solidBottom) {
    tc.quad([x0, y0, zBot], [x1, y0, zBot], [x1, y1, zBot], [x0, y1, zBot]);
  }
}

function dedupLocalPts(pts, eps = 1e-6) {
  const out = [];
  for (const p of pts) {
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < eps) continue;
    }
    out.push(p);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < eps) out.pop();
  }
  return out;
}

function fanLocalPoly(tc, toWorld, localPts, zTop, solidBottom) {
  const ring = dedupLocalPts(localPts);
  if (ring.length < 3) return;

  // Signed area in local (u, v); skip zero-area degenerate slivers
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    area2 += a[0] * b[1] - b[0] * a[1];
    cx += a[0];
    cy += a[1];
  }
  if (Math.abs(area2) < 1e-7) return;

  const hubWorld = toWorld(cx / ring.length, cy / ring.length);
  const worldRing = ring.map(([u, v]) => toWorld(u, v));

  for (let k = 0; k < worldRing.length; k++) {
    const p = worldRing[k];
    const q = worldRing[(k + 1) % worldRing.length];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6) continue;
    tc.tri([hubWorld[0], hubWorld[1], zTop], [p[0], p[1], zTop], [q[0], q[1], zTop]);
    if (!solidBottom) tc.tri([hubWorld[0], hubWorld[1], 0], [q[0], q[1], 0], [p[0], p[1], 0]);
  }
}

function polyArea2D(pts) {
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    a2 += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(a2) / 2;
}

/**
 * Clip a candidate grid-rim pocket rectangle [u0, u1] x [v0, v1] against a corner outer wall
 * rounded with radius `r` at corner `(uMin, vMin)` (in local frame where interior is u >= uMin, v >= vMin).
 * Returns a CCW polygon array of `[u, v]` points, or `null` if no usable pocket remains.
 */
export function clipRectToRoundedWall(u0, u1, v0, v1, uMin, vMin, r) {
  if (u1 - u0 < 2.0 - 1e-6 || v1 - v0 < 2.0 - 1e-6) return null;

  const rIn = r - RIM_OUTER_WALL;
  if (r <= RIM_OUTER_WALL + 0.05) {
    return [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
  }

  const cu = uMin + r;
  const cv = vMin + r;

  // If bottom-left (u0, v0) is already inside the allowed pocket region D, no clipping is needed
  const blOutsideArc =
    u0 < cu - 1e-6 && v0 < cv - 1e-6 && Math.hypot(u0 - cu, v0 - cv) > rIn + 1e-6;
  if (!blOutsideArc) {
    return [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
  }

  // Ensure (u1, v1) has at least 1.8 mm clearance inside D
  if (u1 < cu && v1 < cv) {
    if (rIn - Math.hypot(u1 - cu, v1 - cv) < 1.8) return null;
  } else if (u1 < cu) {
    if (u1 - (uMin + RIM_OUTER_WALL) < 1.8) return null;
  } else if (v1 < cv) {
    if (v1 - (vMin + RIM_OUTER_WALL) < 1.8) return null;
  }

  const arcAng = (u, v) => {
    let a = Math.atan2(v - cv, u - cu);
    if (a < 0) a += 2 * Math.PI;
    return a;
  };

  // Entry point pStart (along left edge u = u0, or top edge v = v1)
  let pStart = null;
  let startOnLeft = false;
  const du0 = cu - u0;
  if (du0 <= rIn + 1e-6) {
    const vAtU0 = cv - Math.sqrt(Math.max(0, rIn * rIn - du0 * du0));
    if (vAtU0 <= v1 - 1e-6) {
      pStart = [u0, Math.max(v0, vAtU0)];
      startOnLeft = true;
    }
  }
  if (!pStart) {
    if (v1 >= cv - 1e-6) return null;
    const dv1 = cv - v1;
    if (dv1 >= rIn - 1e-6) return null;
    const uAtV1 = cu - Math.sqrt(Math.max(0, rIn * rIn - dv1 * dv1));
    if (uAtV1 >= u1 - 1e-6) return null;
    pStart = [Math.max(u0, uAtV1), v1];
    startOnLeft = false;
  }

  // Exit point pEnd (along bottom edge v = v0, or right edge u = u1)
  let pEnd = null;
  let endOnBottom = false;
  const dv0 = cv - v0;
  if (dv0 <= rIn + 1e-6) {
    const uAtV0 = cu - Math.sqrt(Math.max(0, rIn * rIn - dv0 * dv0));
    if (uAtV0 <= u1 - 1e-6) {
      pEnd = [Math.max(u0, uAtV0), v0];
      endOnBottom = true;
    }
  }
  if (!pEnd) {
    if (u1 >= cu - 1e-6) return null;
    const du1 = cu - u1;
    if (du1 >= rIn - 1e-6) return null;
    const vAtU1 = cv - Math.sqrt(Math.max(0, rIn * rIn - du1 * du1));
    if (vAtU1 >= v1 - 1e-6) return null;
    pEnd = [u1, Math.max(v0, vAtU1)];
    endOnBottom = false;
  }

  const aStart = arcAng(pStart[0], pStart[1]);
  const aEnd = arcAng(pEnd[0], pEnd[1]);
  if (aEnd <= aStart + 1e-5) return null;

  const pts = [pStart];
  const nSeg = Math.max(2, Math.ceil(((aEnd - aStart) / (Math.PI / 2)) * ARC_SEGMENTS));
  for (let s = 1; s < nSeg; s++) {
    const a = aStart + (s / nSeg) * (aEnd - aStart);
    pts.push([cu + rIn * Math.cos(a), cv + rIn * Math.sin(a)]);
  }
  pts.push(pEnd);
  if (endOnBottom && pEnd[0] < u1 - 1e-5) pts.push([u1, v0]);
  pts.push([u1, v1]);
  if (startOnLeft && pStart[1] < v1 - 1e-5) pts.push([u0, v1]);

  const clean = dedupLocalPts(pts);
  if (clean.length < 3) return null;

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of clean) {
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (maxU - minU < 2.0 - 1e-5 || maxV - minV < 2.0 - 1e-5 || polyArea2D(clean) < 4.0) {
    return null;
  }
  return clean;
}

function cross2D(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInTri2D(p, a, b, c) {
  if (
    Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-6 ||
    Math.hypot(p[0] - b[0], p[1] - b[1]) < 1e-6 ||
    Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-6
  ) {
    return false;
  }
  return cross2D(a, b, p) >= -1e-8 && cross2D(b, c, p) >= -1e-8 && cross2D(c, a, p) >= -1e-8;
}

/**
 * Triangulate a convex CCW polygon `outerCCW` with a single convex CCW hole `holeCCW` strictly inside it.
 * Returns array of `[p0, p1, p2]` triangles in CCW local coordinates.
 */
function triangulateConvexWithHole(outerCCW, holeCCW) {
  const holeCW = [...holeCCW].reverse();

  // Rightmost vertex M of hole (max u, tie-break min v)
  let mIdx = 0;
  for (let i = 1; i < holeCW.length; i++) {
    if (
      holeCW[i][0] > holeCW[mIdx][0] + 1e-8 ||
      (Math.abs(holeCW[i][0] - holeCW[mIdx][0]) <= 1e-8 && holeCW[i][1] < holeCW[mIdx][1])
    ) {
      mIdx = i;
    }
  }
  const M = holeCW[mIdx];

  // Closest vertex Q of outer with Q.u > M.u
  let qIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < outerCCW.length; i++) {
    if (outerCCW[i][0] <= M[0] + 1e-6) continue;
    const d = Math.hypot(outerCCW[i][0] - M[0], outerCCW[i][1] - M[1]);
    if (d < bestDist) {
      bestDist = d;
      qIdx = i;
    }
  }
  if (qIdx < 0) {
    // Fallback: pick farthest-right outer vertex
    qIdx = 0;
    for (let i = 1; i < outerCCW.length; i++) {
      if (outerCCW[i][0] > outerCCW[qIdx][0]) qIdx = i;
    }
  }
  const Q = outerCCW[qIdx];

  // Combine into single simple polygon with zero-width bridge Q <-> M
  const ring = [];
  for (let i = 0; i <= qIdx; i++) ring.push(outerCCW[i]);
  for (let k = 0; k < holeCW.length; k++) {
    ring.push(holeCW[(mIdx + k) % holeCW.length]);
  }
  ring.push(M, Q);
  for (let i = qIdx + 1; i < outerCCW.length; i++) ring.push(outerCCW[i]);

  // Ear clipping
  const tris = [];
  let minAreaTol = 1e-7;
  let guard = ring.length * ring.length + 20;
  while (ring.length > 3 && guard-- > 0) {
    const len = ring.length;
    let clipped = false;
    for (let i = 0; i < len; i++) {
      const a = ring[(i - 1 + len) % len];
      const b = ring[i];
      const c = ring[(i + 1) % len];
      if (cross2D(a, b, c) <= minAreaTol) continue;
      let hasInside = false;
      for (let j = 0; j < len; j++) {
        if (j === (i - 1 + len) % len || j === i || j === (i + 1) % len) continue;
        if (pointInTri2D(ring[j], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        tris.push([a, b, c]);
        ring.splice(i, 1);
        clipped = true;
        minAreaTol = 1e-7;
        break;
      }
    }
    if (!clipped) {
      if (minAreaTol > 1e-10) {
        minAreaTol = 1e-10;
      } else {
        break;
      }
    }
  }
  if (ring.length === 3 && cross2D(ring[0], ring[1], ring[2]) > 1e-9) {
    tris.push([ring[0], ring[1], ring[2]]);
  }
  return tris;
}

function emitPolyWithOptionalHole(tc, toWorld, outerPts, holePts, zTop, zCutBot, solidBottom) {
  const outer = dedupLocalPts(outerPts);
  if (outer.length < 3 || polyArea2D(outer) < 1e-7) return;

  if (!holePts) {
    fanLocalPoly(tc, toWorld, outer, zTop, solidBottom);
    return;
  }

  const hole = dedupLocalPts(holePts);
  const tris = triangulateConvexWithHole(outer, hole);
  for (const [a, b, c] of tris) {
    const wa = toWorld(a[0], a[1]);
    const wb = toWorld(b[0], b[1]);
    const wc = toWorld(c[0], c[1]);
    tc.tri([wa[0], wa[1], zTop], [wb[0], wb[1], zTop], [wc[0], wc[1], zTop]);
    if (!solidBottom) {
      tc.tri([wa[0], wa[1], 0], [wc[0], wc[1], 0], [wb[0], wb[1], 0]);
    }
  }

  // Inward-facing pocket walls around CCW hole (zCutBot .. zTop)
  const worldHole = hole.map(([u, v]) => toWorld(u, v));
  for (let k = 0; k < worldHole.length; k++) {
    const w0 = worldHole[k];
    const w1 = worldHole[(k + 1) % worldHole.length];
    if (Math.hypot(w0[0] - w1[0], w0[1] - w1[1]) < 1e-6) continue;
    tc.quad([w1[0], w1[1], zCutBot], [w0[0], w0[1], zCutBot], [w0[0], w0[1], zTop], [w1[0], w1[1], zTop]);
  }

  if (solidBottom) {
    let cx = 0;
    let cy = 0;
    for (const [u, v] of hole) {
      cx += u;
      cy += v;
    }
    const hub = toWorld(cx / hole.length, cy / hole.length);
    for (let k = 0; k < worldHole.length; k++) {
      const w0 = worldHole[k];
      const w1 = worldHole[(k + 1) % worldHole.length];
      if (Math.hypot(w0[0] - w1[0], w0[1] - w1[1]) < 1e-6) continue;
      tc.tri([hub[0], hub[1], zCutBot], [w0[0], w0[1], zCutBot], [w1[0], w1[1], zCutBot]);
    }
  }
}

/**
 * Emit a corner rim patch (possibly rounded with radius `rReq > padU` or `rReq > padV`, or with `padV === 0`),
 * together with any clipped end cells up to `(splitV, gridSplitV)` and `(splitU, gridSplitU)`,
 * in a local orientation-preserving `(u, v)` frame whose origin `(0, 0)` is the grid corner.
 *
 * Returns the ordered outer perimeter vertices in world coordinates (CCW around the tile).
 */
function emitGeneralCornerPatch(
  tc,
  {
    toWorld,
    padU,
    padV,
    rReq,
    cutU,
    cutV,
    rimStyle = 'grid',
    hasMidU,
    hasMidV,
    splitV,
    gridSplitV,
    splitU,
    gridSplitU,
    uInnerBreaks,
    vInnerBreaks,
    vSegs = [],
    uSegs = [],
    zTop,
    zCutBot,
    solidBottom,
  }
) {
  const uMin = -padU;
  const vMin = -padV;
  const rMaxGeo = padU + padV + Math.sqrt(2 * padU * padV);
  const r = rReq > 0.05 ? Math.min(rReq, rMaxGeo) : 0;

  const uRimInToOut = cutU ? [0, -RIM_INNER_COLLAR, uMin + RIM_OUTER_WALL, uMin] : [0, uMin];
  const vRimOutToIn = cutV ? [vMin, vMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, 0] : [vMin, 0];

  // Fast exact path for square unrounded corner with no adjacent clipped rim cells
  if (r <= 0.05 && padU > 0 && padV > 0 && gridSplitU <= 1e-6 && gridSplitV <= 1e-6) {
    const uBreaks = cutU ? [uMin, uMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, 0] : [uMin, 0];
    const vBreaks = cutV ? [vMin, vMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, 0] : [vMin, 0];

    for (let i = 0; i < uBreaks.length - 1; i++) {
      for (let j = 0; j < vBreaks.length - 1; j++) {
        if (cutU && cutV && i === 1 && j === 1) {
          const p0 = toWorld(uBreaks[1], vBreaks[1]);
          const p1 = toWorld(uBreaks[2], vBreaks[2]);
          emitCutoutPocket(
            tc,
            Math.min(p0[0], p1[0]),
            Math.max(p0[0], p1[0]),
            Math.min(p0[1], p1[1]),
            Math.max(p0[1], p1[1]),
            zCutBot,
            zTop,
            solidBottom
          );
        } else {
          const a = toWorld(uBreaks[i], vBreaks[j]);
          const b = toWorld(uBreaks[i + 1], vBreaks[j]);
          const c = toWorld(uBreaks[i + 1], vBreaks[j + 1]);
          const d = toWorld(uBreaks[i], vBreaks[j + 1]);
          tc.quad([a[0], a[1], zTop], [b[0], b[1], zTop], [c[0], c[1], zTop], [d[0], d[1], zTop]);
          if (!solidBottom) {
            tc.quad([d[0], d[1], 0], [c[0], c[1], 0], [b[0], b[1], 0], [a[0], a[1], 0]);
          }
        }
      }
    }

    const perim = [];
    for (let j = vBreaks.length - 1; j >= 0; j--) perim.push(toWorld(uMin, vBreaks[j]));
    for (let i = 1; i < uBreaks.length; i++) perim.push(toWorld(uBreaks[i], vMin));
    return perim;
  }

  // Interior inner-edge vertices (excluding endpoints 0 and gridSplit)
  const vStrictInner = vInnerBreaks.filter((v) => v > 1e-6 && v < gridSplitV - 1e-6);
  const uStrictInner = uInnerBreaks.filter((u) => u > 1e-6 && u < gridSplitU - 1e-6);

  // Exact seam vertices along U-rim junction (v = gridSplitV) and V-rim junction (u = gridSplitU)
  const uSeamAt = (vVal) =>
    hasMidU ? uRimInToOut.map((u) => [u, vVal]) : [[0, vVal], [uMin, vVal]];
  const vSeamAt = (uVal) =>
    hasMidV ? vRimOutToIn.map((v) => [uVal, v]) : [[uVal, vMin], [uVal, 0]];

  const clipCornerRect = (u0, u1, v0, v1) =>
    rimStyle === 'grid' ? clipRectToRoundedWall(u0, u1, v0, v1, uMin, vMin, r) : null;

  // Unrounded corner that still absorbs clipped rim cells (or single-side pad boundary)
  if (r <= 0.05) {
    if (padU > 0 && gridSplitV > 1e-6) {
      fanLocalPoly(
        tc,
        toWorld,
        [...uSeamAt(gridSplitV), [uMin, 0], [0, 0], ...vStrictInner.map((v) => [0, v])],
        zTop,
        solidBottom
      );
    }
    if (padU > 0 && padV > 0) {
      const topSeam = hasMidU && gridSplitV <= 1e-6 ? uSeamAt(0) : [[0, 0], [uMin, 0]];
      const rightSeam = hasMidV && gridSplitU <= 1e-6 ? vSeamAt(0) : [[0, vMin], [0, 0]];
      const cHole =
        cutU && cutV ? clipCornerRect(uMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, vMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR) : null;
      emitPolyWithOptionalHole(tc, toWorld, [...topSeam, [uMin, vMin], ...rightSeam], cHole, zTop, zCutBot, solidBottom);
    }
    if (padV > 0 && gridSplitU > 1e-6) {
      const uRev = [...uStrictInner].reverse();
      fanLocalPoly(
        tc,
        toWorld,
        [[0, vMin], ...vSeamAt(gridSplitU), ...uRev.map((u) => [u, 0]), [0, 0]],
        zTop,
        solidBottom
      );
    }
    const perimLocal = [];
    if (padU > 0) {
      if (hasMidU && padV <= 1e-6 && gridSplitV <= 1e-6) {
        for (const p of uSeamAt(0).reverse()) perimLocal.push(p);
      } else {
        perimLocal.push([uMin, splitV]);
      }
    }
    if (padU > 0 && padV > 0) perimLocal.push([uMin, vMin]);
    else if (padU > 0 && !(hasMidU && gridSplitV <= 1e-6)) perimLocal.push([uMin, 0], [0, 0]);

    if (padV > 0) {
      if (hasMidV && padU <= 1e-6 && gridSplitU <= 1e-6) {
        for (const p of [...vSeamAt(0)].reverse()) perimLocal.push(p);
      } else {
        if (padU <= 1e-6) perimLocal.push([0, 0], [0, vMin]);
        perimLocal.push([splitU, vMin]);
      }
    }
    return dedupLocalPts(perimLocal).map(([u, v]) => toWorld(u, v));
  }

  // General rounded corner (r > 0.05, padU > 0 || padV > 0)
  const cu = uMin + r;
  const cv = vMin + r;

  const uOuterAtV = (v) => {
    if (v >= cv - 1e-6) return uMin;
    const dv = cv - v;
    return cu - Math.sqrt(Math.max(0, r * r - dv * dv));
  };

  const vOuterAtU = (u) => {
    if (u >= cu - 1e-6) return vMin;
    const du = cu - u;
    return cv - Math.sqrt(Math.max(0, r * r - du * du));
  };

  const arcItems = [];
  for (let s = 0; s <= ARC_SEGMENTS; s++) {
    const ang = Math.PI + (s / ARC_SEGMENTS) * (Math.PI / 2);
    arcItems.push({ ang, pt: [cu + r * Math.cos(ang), cv + r * Math.sin(ang)], pinned: false });
  }

  const insertArcPoint = (pt) => {
    let ang = Math.atan2(pt[1] - cv, pt[0] - cu);
    if (ang < 0) ang += 2 * Math.PI;
    if (ang < Math.PI - 1e-5 || ang > 1.5 * Math.PI + 1e-5) return;
    ang = Math.max(Math.PI, Math.min(1.5 * Math.PI, ang));
    for (let i = 0; i < arcItems.length; i++) {
      if (Math.hypot(arcItems[i].pt[0] - pt[0], arcItems[i].pt[1] - pt[1]) < 1e-4) {
        arcItems[i] = { ang, pt, pinned: true };
        return;
      }
    }
    arcItems.push({ ang, pt, pinned: true });
  };

  if (padU > 1e-6 && rimStyle === 'grid' && cutU) {
    const uLimit = Math.min(gridSplitV, splitV);
    for (const s of vSegs) {
      if (s.a >= -1e-6 && s.b <= uLimit + 1e-6 && s.b > 1e-6 && s.b < cv - 1e-6) {
        const uVal = uOuterAtV(s.b);
        if (uVal <= 1e-6) insertArcPoint([uVal, s.b]);
      }
    }
  }
  if (padV > 1e-6 && rimStyle === 'grid' && cutV) {
    const vLimit = Math.min(gridSplitU, splitU);
    for (const s of uSegs) {
      if (s.a >= -1e-6 && s.b <= vLimit + 1e-6 && s.b > 1e-6 && s.b < cu - 1e-6) {
        const vVal = vOuterAtU(s.b);
        if (vVal <= 1e-6) insertArcPoint([s.b, vVal]);
      }
    }
  }

  arcItems.sort((a, b) => a.ang - b.ang);
  const arcAngles = arcItems.map((it) => it.ang);
  const arcPts = arcItems.map((it) => it.pt);

  // Helper: slice and emit U-side cells [0 .. gridSplitV] along v with optional rounded-wall-clipped grid pockets
  const emitUSideCells = (vBot, uAtBot, botEdgePrefixPts, topEdgeLimitV, topEdgeLimitWallV, topOuterPtList) => {
    const cellLimit = Math.min(topEdgeLimitV, topEdgeLimitWallV);
    const fullCells =
      rimStyle === 'grid' && cutU
        ? vSegs.filter((s) => s.a >= vBot - 1e-6 && s.b <= cellLimit + 1e-6)
        : [];

    if (fullCells.length === 0) {
      const topPts = hasMidU ? uSeamAt(topEdgeLimitV) : [[0, topEdgeLimitV]];
      fanLocalPoly(
        tc,
        toWorld,
        [...topPts, ...topOuterPtList, ...botEdgePrefixPts, ...vStrictInner.map((v) => [0, v])],
        zTop,
        solidBottom
      );
      return;
    }

    // Emit each full cell strip [s.a, s.b]
    for (let idx = 0; idx < fullCells.length; idx++) {
      const s = fullCells[idx];
      const isBottomStrip = s.a <= 1e-6;
      const isTopFullFlush =
        idx === fullCells.length - 1 && Math.abs(s.b - topEdgeLimitV) <= 1e-6 && Math.abs(s.b - topEdgeLimitWallV) <= 1e-6;

      const uTopOuter = uOuterAtV(s.b);
      const topPts = isTopFullFlush && hasMidU ? uSeamAt(s.b) : [[0, s.b], [uTopOuter, s.b]];
      const leftPts = [];
      for (let k = 0; k < arcPts.length; k++) {
        const pt = arcPts[k];
        if (pt[1] < s.b - 1e-6 && pt[1] > s.a + 1e-6 && arcAngles[k] < (padV <= 1e-6 ? 1.5 * Math.PI + 1e-6 : 2 * Math.PI)) {
          if (pt[0] <= 1e-6) leftPts.push(pt);
        }
      }
      const botPts = isBottomStrip ? botEdgePrefixPts : [[uOuterAtV(s.a), s.a], [0, s.a]];
      const rightInner = vStrictInner
        .filter((v) => v > s.a + 1e-6 && v < s.b - 1e-6)
        .map((v) => [0, v]);

      const hole = clipCornerRect(uMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, s.ribA, s.ribB);
      emitPolyWithOptionalHole(
        tc,
        toWorld,
        [...topPts, ...leftPts, ...botPts, ...rightInner],
        hole,
        zTop,
        zCutBot,
        solidBottom
      );
    }

    // Remaining top sliver above fullCells (only when splitV !== gridSplitV on a multi-rounded 1-cell side)
    const lastV = fullCells[fullCells.length - 1].b;
    if (lastV < topEdgeLimitV - 1e-6 || lastV < topEdgeLimitWallV - 1e-6) {
      const uBotRem = uOuterAtV(lastV);
      const topPts = hasMidU ? uSeamAt(topEdgeLimitV) : [[0, topEdgeLimitV]];
      const remOuter = topOuterPtList.filter((p) => p[1] > lastV + 1e-6);
      const remInner = vStrictInner.filter((v) => v > lastV + 1e-6).map((v) => [0, v]);
      fanLocalPoly(
        tc,
        toWorld,
        [...topPts, ...remOuter, [uBotRem, lastV], [0, lastV], ...remInner],
        zTop,
        solidBottom
      );
    }
  };

  // Case A: Only padU > 0 (padV === 0)
  if (padV <= 1e-6) {
    const outer = [];
    if (splitV > vMin + r + 1e-6) outer.push([uMin, splitV]);
    outer.push(...arcPts, [0, 0]);
    const outerOnlyUpper = [];
    if (splitV > vMin + r + 1e-6) outerOnlyUpper.push([uMin, splitV]);
    for (let s = 0; s < arcPts.length; s++) outerOnlyUpper.push(arcPts[s]);
    emitUSideCells(0, cu, [[cu, 0], [0, 0]], gridSplitV, splitV, outerOnlyUpper);
    return dedupLocalPts(outer).map(([u, v]) => toWorld(u, v));
  }

  // Helper: slice and emit V-side cells [0 .. gridSplitU] along u with optional rounded-wall-clipped grid pockets
  const emitVSideCells = (outerRightPts, rightEdgeLimitU, rightEdgeLimitWallU, botBotPts) => {
    const cellLimit = Math.min(rightEdgeLimitU, rightEdgeLimitWallU);
    const fullCells =
      rimStyle === 'grid' && cutV
        ? uSegs.filter((s) => s.a >= -1e-6 && s.b <= cellLimit + 1e-6)
        : [];

    if (fullCells.length === 0) {
      const uRev = [...uStrictInner].reverse();
      const rightPts = hasMidV ? vSeamAt(rightEdgeLimitU) : [[rightEdgeLimitU, 0]];
      fanLocalPoly(
        tc,
        toWorld,
        [...outerRightPts, ...rightPts, ...uRev.map((u) => [u, 0]), ...(botBotPts.length ? botBotPts : [[0, 0]])],
        zTop,
        solidBottom
      );
      return;
    }

    for (let idx = 0; idx < fullCells.length; idx++) {
      const s = fullCells[idx];
      const isLeftStrip = s.a <= 1e-6;
      const isRightFullFlush =
        idx === fullCells.length - 1 &&
        Math.abs(s.b - rightEdgeLimitU) <= 1e-6 &&
        Math.abs(s.b - rightEdgeLimitWallU) <= 1e-6;

      const vLeftOuter = vOuterAtU(s.a);
      const vRightOuter = vOuterAtU(s.b);
      const leftPts = isLeftStrip ? botBotPts : [[s.a, 0], [s.a, vLeftOuter]];
      const botArcPts = [];
      for (let k = 0; k < arcPts.length; k++) {
        const pt = arcPts[k];
        if (pt[0] > s.a + 1e-6 && pt[0] < s.b - 1e-6 && pt[1] <= 1e-6) {
          botArcPts.push(pt);
        }
      }
      const rightPts = isRightFullFlush && hasMidV ? vSeamAt(s.b) : [[s.b, vRightOuter], [s.b, 0]];
      const uRev = [...uStrictInner]
        .filter((u) => u > s.a + 1e-6 && u < s.b - 1e-6)
        .reverse()
        .map((u) => [u, 0]);

      const hole = clipCornerRect(s.ribA, s.ribB, vMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR);
      emitPolyWithOptionalHole(
        tc,
        toWorld,
        [...leftPts, ...botArcPts, ...rightPts, ...uRev],
        hole,
        zTop,
        zCutBot,
        solidBottom
      );
    }

    const lastU = fullCells[fullCells.length - 1].b;
    if (lastU < rightEdgeLimitU - 1e-6 || lastU < rightEdgeLimitWallU - 1e-6) {
      const vLeftRem = vOuterAtU(lastU);
      const rightPts = hasMidV ? vSeamAt(rightEdgeLimitU) : [[rightEdgeLimitU, 0]];
      const remOuter = outerRightPts.filter((p) => p[0] > lastU + 1e-6);
      const uRev = [...uStrictInner]
        .filter((u) => u > lastU + 1e-6)
        .reverse()
        .map((u) => [u, 0]);
      fanLocalPoly(
        tc,
        toWorld,
        [[lastU, 0], [lastU, vLeftRem], ...remOuter, ...rightPts, ...uRev],
        zTop,
        solidBottom
      );
    }
  };

  // Case B: Only padV > 0 (padU === 0)
  if (padU <= 1e-6) {
    const outer = [[0, 0], ...arcPts];
    if (splitU > uMin + r + 1e-6) outer.push([splitU, vMin]);
    emitVSideCells(outer.slice(2), gridSplitU, splitU, [[0, 0], [0, cv]]);
    return dedupLocalPts(outer).map(([u, v]) => toWorld(u, v));
  }

  // Case C: Both padU > 0 and padV > 0 -> split cleanly into <= 3 convex pieces along v = 0 and u = 0
  let anglePV = cv > 1e-6 ? Math.PI + Math.asin(Math.min(1, cv / r)) : Math.PI;
  let anglePU = cu > 1e-6 ? 1.5 * Math.PI - Math.asin(Math.min(1, cu / r)) : 1.5 * Math.PI;
  if (anglePU < anglePV) {
    const mid = (anglePV + anglePU) / 2;
    anglePV = mid;
    anglePU = mid;
  }

  let pv = cv > 1e-6 ? [Math.min(0, cu - Math.sqrt(Math.max(0, r * r - cv * cv))), 0] : [uMin, 0];
  let pu = cu > 1e-6 ? [0, Math.min(0, cv - Math.sqrt(Math.max(0, r * r - cu * cu)))] : [0, vMin];
  if (Math.hypot(pv[0], pv[1]) < 1e-5 && Math.hypot(pu[0], pu[1]) < 1e-5) {
    pv = [0, 0];
    pu = [0, 0];
  }

  const part1Outer = [];
  if (splitV > vMin + r + 1e-6) part1Outer.push([uMin, splitV]);
  for (let s = 0; s < arcPts.length; s++) {
    if (arcAngles[s] < anglePV - 1e-6) part1Outer.push(arcPts[s]);
  }
  part1Outer.push(pv);

  const part2Arc = [];
  for (let s = 0; s < arcPts.length; s++) {
    if (arcAngles[s] > anglePV + 1e-6 && arcAngles[s] < anglePU - 1e-6) {
      part2Arc.push(arcPts[s]);
    }
  }

  const part3Outer = [pu];
  for (let s = 0; s < arcPts.length; s++) {
    if (arcAngles[s] > anglePU + 1e-6) part3Outer.push(arcPts[s]);
  }
  if (splitU > uMin + r + 1e-6) part3Outer.push([splitU, vMin]);

  // Piece 1: Upper-left arm (u <= 0, v >= 0)
  const hasPiece1 = gridSplitV > 1e-6 || splitV > 1e-6;
  if (hasPiece1) {
    const part1TopArc = part1Outer.slice(0, part1Outer.length - 1);
    emitUSideCells(0, pv[0], [pv, [0, 0]], gridSplitV, splitV, part1TopArc);
  }

  // Piece 2: Corner quadrant (u <= 0, v <= 0)
  const hasPiece3 = gridSplitU > 1e-6 || splitU > 1e-6;
  if (Math.hypot(pv[0] - pu[0], pv[1] - pu[1]) > 1e-5) {
    const p2Start = !hasPiece1 && hasMidU && cv <= 1e-6 ? uSeamAt(0) : [pv];
    const p2End = !hasPiece3 && hasMidV && cu <= 1e-6 ? vSeamAt(0) : [pu, [0, 0]];
    const cHole =
      cutU && cutV ? clipCornerRect(uMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, vMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR) : null;
    emitPolyWithOptionalHole(tc, toWorld, [...p2Start, ...part2Arc, ...p2End], cHole, zTop, zCutBot, solidBottom);
  }

  // Piece 3: Lower-right arm (u >= 0, v <= 0)
  if (hasPiece3) {
    const part3OuterAfterPu = part3Outer.slice(1);
    emitVSideCells(part3OuterAfterPu, gridSplitU, splitU, [[0, 0], pu]);
  }

  return dedupLocalPts([...part1Outer, ...part2Arc, ...part3Outer]).map(([u, v]) => toWorld(u, v));
}

/**
 * Emit a protruding dovetail tab on an outward-facing wall segment along CCW edge `pA -> pB`.
 * `outDir` is unit outward normal in XY, `tanDir` is unit tangent from pA to pB (in XY).
 */
function emitDovetailTab(tc, pA, pB, outDir, tanDir, zTop) {
  const midX = (pA[0] + pB[0]) / 2;
  const midY = (pA[1] + pB[1]) / 2;
  const ox = outDir[0];
  const oy = outDir[1];
  const tx = tanDir[0];
  const ty = tanDir[1];

  const n0 = [midX - tx * TAB_HALF_NECK, midY - ty * TAB_HALF_NECK];
  const n1 = [midX + tx * TAB_HALF_NECK, midY + ty * TAB_HALF_NECK];
  const t0 = [midX - tx * TAB_HALF_TIP + ox * TAB_PROTRUSION_MM, midY - ty * TAB_HALF_TIP + oy * TAB_PROTRUSION_MM];
  const t1 = [midX + tx * TAB_HALF_TIP + ox * TAB_PROTRUSION_MM, midY + ty * TAB_HALF_TIP + oy * TAB_PROTRUSION_MM];

  // Segment [pA .. n0]: single edge [0..zTop] at pA, split at TAB_HEIGHT at n0
  tc.tri([pA[0], pA[1], 0], [n0[0], n0[1], 0], [n0[0], n0[1], TAB_HEIGHT]);
  tc.tri([pA[0], pA[1], 0], [n0[0], n0[1], TAB_HEIGHT], [pA[0], pA[1], zTop]);
  tc.tri([pA[0], pA[1], zTop], [n0[0], n0[1], TAB_HEIGHT], [n0[0], n0[1], zTop]);
  // Segment [n0 .. n1] above tab (z = TAB_HEIGHT .. zTop)
  tc.quad([n0[0], n0[1], TAB_HEIGHT], [n1[0], n1[1], TAB_HEIGHT], [n1[0], n1[1], zTop], [n0[0], n0[1], zTop]);
  // Segment [n1 .. pB]: split at TAB_HEIGHT at n1, single edge [0..zTop] at pB
  tc.tri([n1[0], n1[1], 0], [pB[0], pB[1], 0], [n1[0], n1[1], TAB_HEIGHT]);
  tc.tri([n1[0], n1[1], TAB_HEIGHT], [pB[0], pB[1], 0], [pB[0], pB[1], zTop]);
  tc.tri([n1[0], n1[1], TAB_HEIGHT], [pB[0], pB[1], zTop], [n1[0], n1[1], zTop]);

  // Tab sides (z = 0..TAB_HEIGHT)
  tc.quad([n0[0], n0[1], 0], [t0[0], t0[1], 0], [t0[0], t0[1], TAB_HEIGHT], [n0[0], n0[1], TAB_HEIGHT]);
  tc.quad([t0[0], t0[1], 0], [t1[0], t1[1], 0], [t1[0], t1[1], TAB_HEIGHT], [t0[0], t0[1], TAB_HEIGHT]);
  tc.quad([t1[0], t1[1], 0], [n1[0], n1[1], 0], [n1[0], n1[1], TAB_HEIGHT], [t1[0], t1[1], TAB_HEIGHT]);

  // Tab top (+Z) and bottom (-Z)
  tc.quad([n0[0], n0[1], TAB_HEIGHT], [t0[0], t0[1], TAB_HEIGHT], [t1[0], t1[1], TAB_HEIGHT], [n1[0], n1[1], TAB_HEIGHT]);
  tc.quad([n1[0], n1[1], 0], [t1[0], t1[1], 0], [t0[0], t0[1], 0], [n0[0], n0[1], 0]);
}

/**
 * Emit a 45-deg self-supporting recessed dovetail slot on an outward-facing wall segment `pA -> pB`.
 * Returns the inward slot polyline points [n0, s0, s1, n1] for connecting the z=0 bottom face cleanly.
 */
function emitDovetailSlot(tc, pA, pB, outDir, tanDir, zTop) {
  const midX = (pA[0] + pB[0]) / 2;
  const midY = (pA[1] + pB[1]) / 2;
  const ix = -outDir[0];
  const iy = -outDir[1];
  const tx = tanDir[0];
  const ty = tanDir[1];

  const n0 = [midX - tx * SLOT_HALF_NECK, midY - ty * SLOT_HALF_NECK];
  const n1 = [midX + tx * SLOT_HALF_NECK, midY + ty * SLOT_HALF_NECK];
  const s0 = [midX - tx * SLOT_HALF_TIP + ix * SLOT_DEPTH, midY - ty * SLOT_HALF_TIP + iy * SLOT_DEPTH];
  const s1 = [midX + tx * SLOT_HALF_TIP + ix * SLOT_DEPTH, midY + ty * SLOT_HALF_TIP + iy * SLOT_DEPTH];

  // Segment [pA .. n0]: single edge [0..zTop] at pA, split at SLOT_HEIGHT & SLOT_ROOF_Z at n0
  tc.tri([pA[0], pA[1], 0], [n0[0], n0[1], 0], [n0[0], n0[1], SLOT_HEIGHT]);
  tc.tri([pA[0], pA[1], 0], [n0[0], n0[1], SLOT_HEIGHT], [n0[0], n0[1], SLOT_ROOF_Z]);
  tc.tri([pA[0], pA[1], 0], [n0[0], n0[1], SLOT_ROOF_Z], [pA[0], pA[1], zTop]);
  tc.tri([pA[0], pA[1], zTop], [n0[0], n0[1], SLOT_ROOF_Z], [n0[0], n0[1], zTop]);
  // Segment [n0 .. n1] above slot roof (z = SLOT_ROOF_Z .. zTop)
  tc.quad([n0[0], n0[1], SLOT_ROOF_Z], [n1[0], n1[1], SLOT_ROOF_Z], [n1[0], n1[1], zTop], [n0[0], n0[1], zTop]);
  // Segment [n1 .. pB]: split at SLOT_HEIGHT & SLOT_ROOF_Z at n1, single edge [0..zTop] at pB
  tc.tri([n1[0], n1[1], 0], [pB[0], pB[1], 0], [n1[0], n1[1], SLOT_HEIGHT]);
  tc.tri([n1[0], n1[1], SLOT_HEIGHT], [pB[0], pB[1], 0], [n1[0], n1[1], SLOT_ROOF_Z]);
  tc.tri([n1[0], n1[1], SLOT_ROOF_Z], [pB[0], pB[1], 0], [pB[0], pB[1], zTop]);
  tc.tri([n1[0], n1[1], SLOT_ROOF_Z], [pB[0], pB[1], zTop], [n1[0], n1[1], zTop]);

  // Vertical inner slot walls (z = 0..SLOT_HEIGHT), inward normals
  tc.quad([n0[0], n0[1], 0], [s0[0], s0[1], 0], [s0[0], s0[1], SLOT_HEIGHT], [n0[0], n0[1], SLOT_HEIGHT]);
  tc.quad([s0[0], s0[1], 0], [s1[0], s1[1], 0], [s1[0], s1[1], SLOT_HEIGHT], [s0[0], s0[1], SLOT_HEIGHT]);
  tc.quad([s1[0], s1[1], 0], [n1[0], n1[1], 0], [n1[0], n1[1], SLOT_HEIGHT], [s1[0], s1[1], SLOT_HEIGHT]);

  // Self-supporting 45-deg pitched roof (SLOT_HEIGHT -> SLOT_ROOF_Z), downward-into-slot normals
  tc.quad([s0[0], s0[1], SLOT_HEIGHT], [s1[0], s1[1], SLOT_HEIGHT], [n1[0], n1[1], SLOT_ROOF_Z], [n0[0], n0[1], SLOT_ROOF_Z]);
  tc.tri([n0[0], n0[1], SLOT_HEIGHT], [s0[0], s0[1], SLOT_HEIGHT], [n0[0], n0[1], SLOT_ROOF_Z]);
  tc.tri([s1[0], s1[1], SLOT_HEIGHT], [n1[0], n1[1], SLOT_HEIGHT], [n1[0], n1[1], SLOT_ROOF_Z]);

  return { n0, s0, s1, n1 };
}

function addBorderRimsAndWalls(
  tc,
  {
    spec,
    colOffsets,
    rowOffsets,
    zTop,
    floorH = 0,
    rimStyle = 'grid',
    xsGrid,
    ysGrid,
    bottomSlotLoops,
  }
) {
  const {
    colWidths,
    rowDepths,
    padL = 0,
    padR = 0,
    padB = 0,
    padT = 0,
    rBL = 0,
    rBR = 0,
    rTR = 0,
    rTL = 0,
    connL = 0,
    connR = 0,
    connB = 0,
    connT = 0,
  } = spec;

  const gridW = colOffsets[colOffsets.length - 1];
  const gridD = rowOffsets[rowOffsets.length - 1];
  const xMin = -padL;
  const xMax = gridW + padR;
  const yMin = -padB;
  const yMax = gridD + padT;
  const solidBottom = floorH > 0;
  const zCutBot = solidBottom ? floorH : 0;

  const cutL = rimStyle === 'grid' && padL >= MIN_GRID_RIM_PAD;
  const cutR = rimStyle === 'grid' && padR >= MIN_GRID_RIM_PAD;
  const cutB = rimStyle === 'grid' && padB >= MIN_GRID_RIM_PAD;
  const cutT = rimStyle === 'grid' && padT >= MIN_GRID_RIM_PAD;

  const ySegs = buildRimCellSegmentsFromSizes(rowDepths);
  const xSegs = buildRimCellSegmentsFromSizes(colWidths);

  const clampCornerR = (r, padU, padV, uMax, vMax, padOppU, rOppU, padOppV, rOppV) => {
    if ((padU <= 1e-6 && padV <= 1e-6) || r <= 0.05) return r;
    let eff = Math.min(r, padU + padV + Math.sqrt(2 * padU * padV));
    if (padOppU <= 1e-6 && rOppU <= 0.05) eff = Math.min(eff, padU + uMax);
    if (padOppV <= 1e-6 && rOppV <= 0.05) eff = Math.min(eff, padV + vMax);
    return eff;
  };

  const rBL_eff = clampCornerR(rBL, padL, padB, gridW, gridD, padR, rBR, padT, rTL);
  const rBR_eff = clampCornerR(rBR, padB, padR, gridD, gridW, padT, rTR, padL, rBL);
  const rTR_eff = clampCornerR(rTR, padR, padT, gridW, gridD, padL, rTL, padB, rBR);
  const rTL_eff = clampCornerR(rTL, padT, padL, gridD, gridW, padB, rBL, padR, rTR);

  const computeSideSplits = (segs, span, cutStart, cutEnd, rStart, rEnd, innerBreaks) => {
    const midSegs = [];
    for (const s of segs) {
      if (s.a >= cutStart - 1e-6 && s.b <= cutEnd + 1e-6) midSegs.push(s);
    }
    if (midSegs.length > 0) {
      return {
        midSegs,
        wallStart: midSegs[0].a,
        gridStart: midSegs[0].a,
        wallEnd: midSegs[midSegs.length - 1].b,
        gridEnd: midSegs[midSegs.length - 1].b,
      };
    }
    if (rStart <= 0.05 && rEnd <= 0.05) {
      return { midSegs: segs, wallStart: 0, gridStart: 0, wallEnd: span, gridEnd: span };
    }
    if (rStart > 0.05 && rEnd <= 0.05) {
      return { midSegs: [], wallStart: span, gridStart: span, wallEnd: span, gridEnd: span };
    }
    if (rEnd > 0.05 && rStart <= 0.05) {
      return { midSegs: [], wallStart: 0, gridStart: 0, wallEnd: 0, gridEnd: 0 };
    }
    const cs = Math.min(span, Math.max(0, cutStart));
    const ce = Math.max(cs, Math.min(span, cutEnd));
    const wallMid = (cs + ce) / 2;
    const gridMid = innerBreaks[Math.floor(innerBreaks.length / 2)];
    return { midSegs: [], wallStart: wallMid, gridStart: gridMid, wallEnd: wallMid, gridEnd: gridMid };
  };

  const splitL =
    padL > 0
      ? computeSideSplits(
          ySegs,
          gridD,
          rBL_eff > 0.05 ? Math.max(0, yMin + rBL_eff) : 0,
          rTL_eff > 0.05 ? Math.min(gridD, yMax - rTL_eff) : gridD,
          rBL_eff,
          rTL_eff,
          ysGrid
        )
      : { midSegs: [], wallStart: 0, gridStart: 0, wallEnd: gridD, gridEnd: gridD };

  const splitR =
    padR > 0
      ? computeSideSplits(
          ySegs,
          gridD,
          rBR_eff > 0.05 ? Math.max(0, yMin + rBR_eff) : 0,
          rTR_eff > 0.05 ? Math.min(gridD, yMax - rTR_eff) : gridD,
          rBR_eff,
          rTR_eff,
          ysGrid
        )
      : { midSegs: [], wallStart: 0, gridStart: 0, wallEnd: gridD, gridEnd: gridD };

  const splitB =
    padB > 0
      ? computeSideSplits(
          xSegs,
          gridW,
          rBL_eff > 0.05 ? Math.max(0, xMin + rBL_eff) : 0,
          rBR_eff > 0.05 ? Math.min(gridW, xMax - rBR_eff) : gridW,
          rBL_eff,
          rBR_eff,
          xsGrid
        )
      : { midSegs: [], wallStart: 0, gridStart: 0, wallEnd: gridW, gridEnd: gridW };

  const splitT =
    padT > 0
      ? computeSideSplits(
          xSegs,
          gridW,
          rTL_eff > 0.05 ? Math.max(0, xMin + rTL_eff) : 0,
          rTR_eff > 0.05 ? Math.min(gridW, xMax - rTR_eff) : gridW,
          rTL_eff,
          rTR_eff,
          xsGrid
        )
      : { midSegs: [], wallStart: 0, gridStart: 0, wallEnd: gridW, gridEnd: gridW };

  // Left rim: [xMin, 0] x [splitL.gridStart, splitL.gridEnd]
  if (padL > 0 && splitL.midSegs.length > 0) {
    if (!cutL) {
      for (const s of splitL.midSegs) {
        for (const [ya, yb] of [
          [s.a, s.cellB],
          [s.cellB, s.cellC],
          [s.cellC, s.b],
        ]) {
          emitTopAndOptionalBottomQuad(tc, xMin, 0, ya, yb, zTop, solidBottom);
        }
      }
    } else {
      const x1 = xMin + RIM_OUTER_WALL;
      const x2 = -RIM_INNER_COLLAR;
      for (const s of splitL.midSegs) {
        emitTopAndOptionalBottomQuad(tc, xMin, x1, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, xMin, x1, s.ribA, s.ribB, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, xMin, x1, s.ribB, s.b, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.ribB, s.b, zTop, solidBottom);
        emitCutoutPocket(tc, x1, x2, s.ribA, s.ribB, zCutBot, zTop, solidBottom);
        tc.quad([x2, s.a, zTop], [0, s.a, zTop], [0, s.cellB, zTop], [x2, s.ribA, zTop]);
        tc.quad([x2, s.ribA, zTop], [0, s.cellB, zTop], [0, s.cellC, zTop], [x2, s.ribB, zTop]);
        tc.quad([x2, s.ribB, zTop], [0, s.cellC, zTop], [0, s.b, zTop], [x2, s.b, zTop]);
        if (!solidBottom) {
          tc.quad([x2, s.ribA, 0], [0, s.cellB, 0], [0, s.a, 0], [x2, s.a, 0]);
          tc.quad([x2, s.ribB, 0], [0, s.cellC, 0], [0, s.cellB, 0], [x2, s.ribA, 0]);
          tc.quad([x2, s.b, 0], [0, s.b, 0], [0, s.cellC, 0], [x2, s.ribB, 0]);
        }
      }
    }
  }

  // Right rim: [gridW, xMax] x [splitR.gridStart, splitR.gridEnd]
  if (padR > 0 && splitR.midSegs.length > 0) {
    if (!cutR) {
      for (const s of splitR.midSegs) {
        for (const [ya, yb] of [
          [s.a, s.cellB],
          [s.cellB, s.cellC],
          [s.cellC, s.b],
        ]) {
          emitTopAndOptionalBottomQuad(tc, gridW, xMax, ya, yb, zTop, solidBottom);
        }
      }
    } else {
      const x1 = gridW + RIM_INNER_COLLAR;
      const x2 = xMax - RIM_OUTER_WALL;
      for (const s of splitR.midSegs) {
        emitTopAndOptionalBottomQuad(tc, x2, xMax, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x2, xMax, s.ribA, s.ribB, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x2, xMax, s.ribB, s.b, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.ribB, s.b, zTop, solidBottom);
        emitCutoutPocket(tc, x1, x2, s.ribA, s.ribB, zCutBot, zTop, solidBottom);
        tc.quad([gridW, s.a, zTop], [x1, s.a, zTop], [x1, s.ribA, zTop], [gridW, s.cellB, zTop]);
        tc.quad([gridW, s.cellB, zTop], [x1, s.ribA, zTop], [x1, s.ribB, zTop], [gridW, s.cellC, zTop]);
        tc.quad([gridW, s.cellC, zTop], [x1, s.ribB, zTop], [x1, s.b, zTop], [gridW, s.b, zTop]);
        if (!solidBottom) {
          tc.quad([gridW, s.cellB, 0], [x1, s.ribA, 0], [x1, s.a, 0], [gridW, s.a, 0]);
          tc.quad([gridW, s.cellC, 0], [x1, s.ribB, 0], [x1, s.ribA, 0], [gridW, s.cellB, 0]);
          tc.quad([gridW, s.b, 0], [x1, s.b, 0], [x1, s.ribB, 0], [gridW, s.cellC, 0]);
        }
      }
    }
  }

  // Bottom rim: [splitB.gridStart, splitB.gridEnd] x [yMin, 0]
  if (padB > 0 && splitB.midSegs.length > 0) {
    if (!cutB) {
      for (const s of splitB.midSegs) {
        for (const [xa, xb] of [
          [s.a, s.cellB],
          [s.cellB, s.cellC],
          [s.cellC, s.b],
        ]) {
          emitTopAndOptionalBottomQuad(tc, xa, xb, yMin, 0, zTop, solidBottom);
        }
      }
    } else {
      const y1 = yMin + RIM_OUTER_WALL;
      const y2 = -RIM_INNER_COLLAR;
      for (const s of splitB.midSegs) {
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, yMin, y1, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribA, s.ribB, yMin, y1, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, yMin, y1, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, y1, y2, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, y1, y2, zTop, solidBottom);
        emitCutoutPocket(tc, s.ribA, s.ribB, y1, y2, zCutBot, zTop, solidBottom);
        tc.quad([s.a, y2, zTop], [s.ribA, y2, zTop], [s.cellB, 0, zTop], [s.a, 0, zTop]);
        tc.quad([s.ribA, y2, zTop], [s.ribB, y2, zTop], [s.cellC, 0, zTop], [s.cellB, 0, zTop]);
        tc.quad([s.ribB, y2, zTop], [s.b, y2, zTop], [s.b, 0, zTop], [s.cellC, 0, zTop]);
        if (!solidBottom) {
          tc.quad([s.a, 0, 0], [s.cellB, 0, 0], [s.ribA, y2, 0], [s.a, y2, 0]);
          tc.quad([s.cellB, 0, 0], [s.cellC, 0, 0], [s.ribB, y2, 0], [s.ribA, y2, 0]);
          tc.quad([s.cellC, 0, 0], [s.b, 0, 0], [s.b, y2, 0], [s.ribB, y2, 0]);
        }
      }
    }
  }

  // Top rim: [splitT.gridStart, splitT.gridEnd] x [gridD, yMax]
  if (padT > 0 && splitT.midSegs.length > 0) {
    if (!cutT) {
      for (const s of splitT.midSegs) {
        for (const [xa, xb] of [
          [s.a, s.cellB],
          [s.cellB, s.cellC],
          [s.cellC, s.b],
        ]) {
          emitTopAndOptionalBottomQuad(tc, xa, xb, gridD, yMax, zTop, solidBottom);
        }
      }
    } else {
      const y1 = gridD + RIM_INNER_COLLAR;
      const y2 = yMax - RIM_OUTER_WALL;
      for (const s of splitT.midSegs) {
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, y2, yMax, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribA, s.ribB, y2, yMax, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, y2, yMax, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, y1, y2, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, y1, y2, zTop, solidBottom);
        emitCutoutPocket(tc, s.ribA, s.ribB, y1, y2, zCutBot, zTop, solidBottom);
        tc.quad([s.a, gridD, zTop], [s.cellB, gridD, zTop], [s.ribA, y1, zTop], [s.a, y1, zTop]);
        tc.quad([s.cellB, gridD, zTop], [s.cellC, gridD, zTop], [s.ribB, y1, zTop], [s.ribA, y1, zTop]);
        tc.quad([s.cellC, gridD, zTop], [s.b, gridD, zTop], [s.b, y1, zTop], [s.ribB, y1, zTop]);
        if (!solidBottom) {
          tc.quad([s.a, y1, 0], [s.ribA, y1, 0], [s.cellB, gridD, 0], [s.a, gridD, 0]);
          tc.quad([s.ribA, y1, 0], [s.ribB, y1, 0], [s.cellC, gridD, 0], [s.cellB, gridD, 0]);
          tc.quad([s.ribB, y1, 0], [s.b, y1, 0], [s.b, gridD, 0], [s.cellC, gridD, 0]);
        }
      }
    }
  }

  // 4 Corner rim patches (+ any clipped adjacent rim ends)
  const xsGridRev = [...xsGrid].reverse().map((x) => gridW - x);
  const ysGridRev = [...ysGrid].reverse().map((y) => gridD - y);
  const revSegs = (segs, span) =>
    [...segs].reverse().map((s) => ({
      a: span - s.b,
      ribA: span - s.ribB,
      ribB: span - s.ribA,
      b: span - s.a,
      cellB: span - s.cellC,
      cellC: span - s.cellB,
    }));
  const xSegsRev = revSegs(xSegs, gridW);
  const ySegsRev = revSegs(ySegs, gridD);

  const cornerPerims = { BL: null, BR: null, TR: null, TL: null };

  if (padL > 0 || padB > 0) {
    cornerPerims.BL = emitGeneralCornerPatch(tc, {
      toWorld: (u, v) => [u, v],
      padU: padL,
      padV: padB,
      rReq: rBL_eff,
      cutU: cutL,
      cutV: cutB,
      rimStyle,
      hasMidU: splitL.midSegs.length > 0,
      hasMidV: splitB.midSegs.length > 0,
      splitV: splitL.wallStart,
      gridSplitV: splitL.gridStart,
      splitU: splitB.wallStart,
      gridSplitU: splitB.gridStart,
      uInnerBreaks: xsGrid,
      vInnerBreaks: ysGrid,
      uSegs: xSegs,
      vSegs: ySegs,
      zTop,
      zCutBot,
      solidBottom,
    });
  }

  if (padB > 0 || padR > 0) {
    cornerPerims.BR = emitGeneralCornerPatch(tc, {
      toWorld: (u, v) => [gridW - v, u],
      padU: padB,
      padV: padR,
      rReq: rBR_eff,
      cutU: cutB,
      cutV: cutR,
      rimStyle,
      hasMidU: splitB.midSegs.length > 0,
      hasMidV: splitR.midSegs.length > 0,
      splitV: padB > 0 ? gridW - splitB.wallEnd : 0,
      gridSplitV: padB > 0 ? gridW - splitB.gridEnd : 0,
      splitU: splitR.wallStart,
      gridSplitU: splitR.gridStart,
      uInnerBreaks: ysGrid,
      vInnerBreaks: xsGridRev,
      uSegs: ySegs,
      vSegs: xSegsRev,
      zTop,
      zCutBot,
      solidBottom,
    });
  }

  if (padR > 0 || padT > 0) {
    cornerPerims.TR = emitGeneralCornerPatch(tc, {
      toWorld: (u, v) => [gridW - u, gridD - v],
      padU: padR,
      padV: padT,
      rReq: rTR_eff,
      cutU: cutR,
      cutV: cutT,
      rimStyle,
      hasMidU: splitR.midSegs.length > 0,
      hasMidV: splitT.midSegs.length > 0,
      splitV: padR > 0 ? gridD - splitR.wallEnd : 0,
      gridSplitV: padR > 0 ? gridD - splitR.gridEnd : 0,
      splitU: padT > 0 ? gridW - splitT.wallEnd : 0,
      gridSplitU: padT > 0 ? gridW - splitT.gridEnd : 0,
      uInnerBreaks: xsGridRev,
      vInnerBreaks: ysGridRev,
      uSegs: xSegsRev,
      vSegs: ySegsRev,
      zTop,
      zCutBot,
      solidBottom,
    });
  }

  if (padT > 0 || padL > 0) {
    cornerPerims.TL = emitGeneralCornerPatch(tc, {
      toWorld: (u, v) => [v, gridD - u],
      padU: padT,
      padV: padL,
      rReq: rTL_eff,
      cutU: cutT,
      cutV: cutL,
      rimStyle,
      hasMidU: splitT.midSegs.length > 0,
      hasMidV: splitL.midSegs.length > 0,
      splitV: splitT.wallStart,
      gridSplitV: splitT.gridStart,
      splitU: padL > 0 ? gridD - splitL.wallEnd : 0,
      gridSplitU: padL > 0 ? gridD - splitL.gridEnd : 0,
      uInnerBreaks: ysGridRev,
      vInnerBreaks: xsGrid,
      uSegs: ySegsRev,
      vSegs: xSegs,
      zTop,
      zCutBot,
      solidBottom,
    });
  }

  // Build ordered outer perimeter edges around the entire tile in CCW order
  const sideOuterBreaks = (midSegs, isCut) => {
    if (midSegs.length === 0) return [];
    const pts = [midSegs[0].a];
    for (const s of midSegs) {
      if (isCut) pts.push(s.ribA, s.ribB, s.b);
      else pts.push(s.cellB, s.cellC, s.b);
    }
    return pts;
  };

  const xsBotRim = padB > 0 ? sideOuterBreaks(splitB.midSegs, cutB) : xsGrid;
  const xsTopRim = padT > 0 ? sideOuterBreaks(splitT.midSegs, cutT) : xsGrid;
  const ysLeftRim = padL > 0 ? sideOuterBreaks(splitL.midSegs, cutL) : ysGrid;
  const ysRightRim = padR > 0 ? sideOuterBreaks(splitR.midSegs, cutR) : ysGrid;

  const perimVerts = [];
  const pushPt = (p) => {
    if (perimVerts.length > 0) {
      const prev = perimVerts[perimVerts.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1e-6) return;
    }
    perimVerts.push(p);
  };

  // Helper: add outer unpadded cell corner arc if pad==0 on both adjacent sides and rCorner > 0
  const unpaddedCornerArc = (type, r) => {
    if (r <= 0.05) return null;
    const effR = Math.min(r, 4);
    const pts = [];
    if (type === 'BL') {
      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        const a = Math.PI + (s / ARC_SEGMENTS) * (Math.PI / 2);
        pts.push([effR + effR * Math.cos(a), effR + effR * Math.sin(a)]);
      }
    } else if (type === 'BR') {
      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        const a = -Math.PI / 2 + (s / ARC_SEGMENTS) * (Math.PI / 2);
        pts.push([gridW - effR + effR * Math.cos(a), effR + effR * Math.sin(a)]);
      }
    } else if (type === 'TR') {
      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        const a = (s / ARC_SEGMENTS) * (Math.PI / 2);
        pts.push([gridW - effR + effR * Math.cos(a), gridD - effR + effR * Math.sin(a)]);
      }
    } else {
      for (let s = 0; s <= ARC_SEGMENTS; s++) {
        const a = Math.PI / 2 + (s / ARC_SEGMENTS) * (Math.PI / 2);
        pts.push([effR + effR * Math.cos(a), gridD - effR + effR * Math.sin(a)]);
      }
    }
    return pts;
  };

  const uArcBL = padL === 0 && padB === 0 ? unpaddedCornerArc('BL', rBL) : null;
  const uArcBR = padR === 0 && padB === 0 ? unpaddedCornerArc('BR', rBR) : null;
  const uArcTR = padR === 0 && padT === 0 ? unpaddedCornerArc('TR', rTR) : null;
  const uArcTL = padL === 0 && padT === 0 ? unpaddedCornerArc('TL', rTL) : null;

  // 1. BL corner
  if (cornerPerims.BL) {
    for (const p of cornerPerims.BL) pushPt(p);
  } else if (uArcBL) {
    for (const p of uArcBL) pushPt(p);
  }

  // 2. Bottom edge [0..gridW] at yMin
  for (let i = 0; i < xsBotRim.length; i++) {
    if (uArcBL && xsBotRim[i] < Math.min(rBL, 4) - 1e-6) continue;
    if (uArcBR && xsBotRim[i] > gridW - Math.min(rBR, 4) + 1e-6) continue;
    pushPt([xsBotRim[i], yMin]);
  }

  // 3. BR corner
  if (cornerPerims.BR) {
    for (const p of cornerPerims.BR) pushPt(p);
  } else if (uArcBR) {
    for (const p of uArcBR) pushPt(p);
  }

  // 4. Right edge [0..gridD] at xMax
  for (let j = 0; j < ysRightRim.length; j++) {
    if (uArcBR && ysRightRim[j] < Math.min(rBR, 4) - 1e-6) continue;
    if (uArcTR && ysRightRim[j] > gridD - Math.min(rTR, 4) + 1e-6) continue;
    pushPt([xMax, ysRightRim[j]]);
  }

  // 5. TR corner
  if (cornerPerims.TR) {
    for (const p of cornerPerims.TR) pushPt(p);
  } else if (uArcTR) {
    for (const p of uArcTR) pushPt(p);
  }

  // 6. Top edge [gridW..0] at yMax
  for (let i = xsTopRim.length - 1; i >= 0; i--) {
    if (uArcTR && xsTopRim[i] > gridW - Math.min(rTR, 4) + 1e-6) continue;
    if (uArcTL && xsTopRim[i] < Math.min(rTL, 4) - 1e-6) continue;
    pushPt([xsTopRim[i], yMax]);
  }

  // 7. TL corner
  if (cornerPerims.TL) {
    for (const p of cornerPerims.TL) pushPt(p);
  } else if (uArcTL) {
    for (const p of uArcTL) pushPt(p);
  }

  // 8. Left edge [gridD..0] at xMin
  for (let j = ysLeftRim.length - 1; j >= 0; j--) {
    if (uArcTL && ysLeftRim[j] > gridD - Math.min(rTL, 4) + 1e-6) continue;
    if (uArcBL && ysLeftRim[j] < Math.min(rBL, 4) - 1e-6) continue;
    pushPt([xMin, ysLeftRim[j]]);
  }

  if (perimVerts.length > 1) {
    const first = perimVerts[0];
    const last = perimVerts[perimVerts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
      perimVerts.pop();
    }
  }

  // Identify which cell-edge mid-segments carry interlocking tabs or slots
  const checkEdgeConnector = (pA, pB) => {
    const dx = pB[0] - pA[0];
    const dy = pB[1] - pA[1];
    const len = Math.hypot(dx, dy);
    if (len < 10) return null; // Only straight cell mid-segments (>= 13 mm) carry tabs/slots

    const inXGrid =
      pA[0] >= -1e-5 && pB[0] >= -1e-5 && pA[0] <= gridW + 1e-5 && pB[0] <= gridW + 1e-5;
    const inYGrid =
      pA[1] >= -1e-5 && pB[1] >= -1e-5 && pA[1] <= gridD + 1e-5 && pB[1] <= gridD + 1e-5;

    if (padB === 0 && inXGrid && Math.abs(pA[1] - yMin) < 1e-5 && Math.abs(pB[1] - yMin) < 1e-5 && dx > 0 && connB) {
      return { kind: connB, outDir: [0, -1], tanDir: [1, 0], side: 'B' };
    }
    if (padR === 0 && inYGrid && Math.abs(pA[0] - xMax) < 1e-5 && Math.abs(pB[0] - xMax) < 1e-5 && dy > 0 && connR) {
      return { kind: connR, outDir: [1, 0], tanDir: [0, 1], side: 'R' };
    }
    if (padT === 0 && inXGrid && Math.abs(pA[1] - yMax) < 1e-5 && Math.abs(pB[1] - yMax) < 1e-5 && dx < 0 && connT) {
      return { kind: connT, outDir: [0, 1], tanDir: [-1, 0], side: 'T' };
    }
    if (padL === 0 && inYGrid && Math.abs(pA[0] - xMin) < 1e-5 && Math.abs(pB[0] - xMin) < 1e-5 && dy < 0 && connL) {
      return { kind: connL, outDir: [-1, 0], tanDir: [0, -1], side: 'L' };
    }
    return null;
  };

  // Emit outer walls + build solidBottom perimeter loop (including tab/slot detours)
  const solidBottomPoly = [];
  for (let k = 0; k < perimVerts.length; k++) {
    const pA = perimVerts[k];
    const pB = perimVerts[(k + 1) % perimVerts.length];
    const conn = checkEdgeConnector(pA, pB);

    if (!conn) {
      tc.quad([pA[0], pA[1], 0], [pB[0], pB[1], 0], [pB[0], pB[1], zTop], [pA[0], pA[1], zTop]);
      solidBottomPoly.push(pA);
    } else if (conn.kind === 'tab') {
      emitDovetailTab(tc, pA, pB, conn.outDir, conn.tanDir, zTop);
      const midX = (pA[0] + pB[0]) / 2;
      const midY = (pA[1] + pB[1]) / 2;
      const n0 = [midX - conn.tanDir[0] * TAB_HALF_NECK, midY - conn.tanDir[1] * TAB_HALF_NECK];
      const n1 = [midX + conn.tanDir[0] * TAB_HALF_NECK, midY + conn.tanDir[1] * TAB_HALF_NECK];
      // For solidBottom fan, the tab has its own bottom quad; the main bottom fan steps pA -> n0 -> n1 -> pB
      solidBottomPoly.push(pA, n0, n1);
    } else {
      const slotPts = emitDovetailSlot(tc, pA, pB, conn.outDir, conn.tanDir, zTop);
      solidBottomPoly.push(pA, slotPts.n0, slotPts.s0, slotPts.s1, slotPts.n1);
      bottomSlotLoops.push({ side: conn.side, pA, pB, ...slotPts });
    }
  }

  if (solidBottom) {
    const center = [(xMin + xMax) / 2, (yMin + yMax) / 2, 0];
    for (let k = 0; k < solidBottomPoly.length; k++) {
      const pA = solidBottomPoly[k];
      const pB = solidBottomPoly[(k + 1) % solidBottomPoly.length];
      tc.tri(center, [pB[0], pB[1], 0], [pA[0], pA[1], 0]);
    }
  }
}

/**
 * Emit an unpadded outer cell corner on zTop (and optional z=0) supporting corner rounding rCorner <= 4.
 */
function emitCellCornerTopAndBottom(tc, cornerType, cellBounds, rRing, zVal, rCorner, isBottom, innerEdgeSplit = null) {
  const { xA, xB, xC, xD, yA, yB, yC, yD } = cellBounds;
  const effR = Math.min(rCorner, 4);

  const configs = {
    BR: { vx: xD, vy: yA, start: 0, pStart: [xC, yA], pEnd: [xD, yB], arcStart: -Math.PI / 2, acx: xD - effR, acy: yA + effR },
    TR: { vx: xD, vy: yD, start: 9, pStart: [xD, yC], pEnd: [xC, yD], arcStart: 0, acx: xD - effR, acy: yD - effR },
    TL: { vx: xA, vy: yD, start: 18, pStart: [xB, yD], pEnd: [xA, yC], arcStart: Math.PI / 2, acx: xA + effR, acy: yD - effR },
    BL: { vx: xA, vy: yA, start: 27, pStart: [xA, yB], pEnd: [xB, yA], arcStart: Math.PI, acx: xA + effR, acy: yA + effR },
  };
  const c = configs[cornerType];

  if (effR <= 0.05) {
    const v = [c.vx, c.vy, zVal];
    for (let s = 0; s < ARC_SEGMENTS; s++) {
      const a = rRing[c.start + s];
      const b = rRing[c.start + s + 1];
      if (isBottom) tc.tri(v, a, b);
      else tc.tri(v, b, a);
    }
    return { pStart: c.pStart, pEnd: c.pEnd, v };
  }

  // Rounded outer cell corner: bridge outer arc (9 pts) <-> inner pocket arc (9 pts)
  for (let s = 0; s < ARC_SEGMENTS; s++) {
    const a0 = c.arcStart + (s / ARC_SEGMENTS) * (Math.PI / 2);
    const a1 = c.arcStart + ((s + 1) / ARC_SEGMENTS) * (Math.PI / 2);
    const o0 = [c.acx + effR * Math.cos(a0), c.acy + effR * Math.sin(a0), zVal];
    const o1 = [c.acx + effR * Math.cos(a1), c.acy + effR * Math.sin(a1), zVal];
    const i0 = rRing[c.start + s];
    const i1 = rRing[c.start + s + 1];
    if (Math.hypot(o0[0] - i0[0], o0[1] - i0[1]) < 1e-5 && Math.hypot(o1[0] - i1[0], o1[1] - i1[1]) < 1e-5) {
      continue;
    }
    if (isBottom) {
      tc.quad(o0, i0, i1, o1);
    } else {
      tc.quad(o0, o1, i1, i0);
    }
  }
  return {
    pStart: c.pStart,
    pEnd: c.pEnd,
    arcFirst: [c.acx + effR * Math.cos(c.arcStart), c.acy + effR * Math.sin(c.arcStart), zVal],
    arcLast: [c.acx + effR * Math.cos(c.arcStart + Math.PI / 2), c.acy + effR * Math.sin(c.arcStart + Math.PI / 2), zVal],
  };
}

function emitBottomStraightWithConnector(tc, pOutA, pOutB, pInB, pInA, connType, outDir, tanDir) {
  if (!connType) {
    tc.quad([pOutA[0], pOutA[1], 0], [pInA[0], pInA[1], 0], [pInB[0], pInB[1], 0], [pOutB[0], pOutB[1], 0]);
    return;
  }
  const midX = (pOutA[0] + pOutB[0]) / 2;
  const midY = (pOutA[1] + pOutB[1]) / 2;
  if (connType === 'tab') {
    const n0 = [midX - tanDir[0] * TAB_HALF_NECK, midY - tanDir[1] * TAB_HALF_NECK, 0];
    const n1 = [midX + tanDir[0] * TAB_HALF_NECK, midY + tanDir[1] * TAB_HALF_NECK, 0];
    tc.tri([pOutA[0], pOutA[1], 0], [pInA[0], pInA[1], 0], n0);
    tc.tri(n0, [pInA[0], pInA[1], 0], n1);
    tc.tri(n1, [pInA[0], pInA[1], 0], [pInB[0], pInB[1], 0]);
    tc.tri(n1, [pInB[0], pInB[1], 0], [pOutB[0], pOutB[1], 0]);
    return;
  }
  // 'slot': step inward around slot polygon
  const ix = -outDir[0];
  const iy = -outDir[1];
  const n0 = [midX - tanDir[0] * SLOT_HALF_NECK, midY - tyVal(tanDir, SLOT_HALF_NECK), 0];
  const n1 = [midX + tanDir[0] * SLOT_HALF_NECK, midY + tyVal(tanDir, SLOT_HALF_NECK), 0];
  const s0 = [midX - tanDir[0] * SLOT_HALF_TIP + ix * SLOT_DEPTH, midY - tyVal(tanDir, SLOT_HALF_TIP) + iy * SLOT_DEPTH, 0];
  const s1 = [midX + tanDir[0] * SLOT_HALF_TIP + ix * SLOT_DEPTH, midY + tyVal(tanDir, SLOT_HALF_TIP) + iy * SLOT_DEPTH, 0];

  tc.tri([pOutA[0], pOutA[1], 0], [pInA[0], pInA[1], 0], n0);
  tc.tri(n0, [pInA[0], pInA[1], 0], s0);
  tc.tri(s0, [pInA[0], pInA[1], 0], [pInB[0], pInB[1], 0]);
  tc.tri(s0, [pInB[0], pInB[1], 0], s1);
  tc.tri(s1, [pInB[0], pInB[1], 0], n1);
  tc.tri(n1, [pInB[0], pInB[1], 0], [pOutB[0], pOutB[1], 0]);
}

function tyVal(tanDir, dist) {
  return tanDir[1] * dist;
}

function buildStandardMesh(tc, spec, floorH, rimStyle) {
  const {
    colWidths,
    rowDepths,
    padL = 0,
    padR = 0,
    padB = 0,
    padT = 0,
    rBL = 0,
    rBR = 0,
    rTR = 0,
    rTL = 0,
    connL = 0,
    connR = 0,
    connB = 0,
    connT = 0,
  } = spec;

  const nx = colWidths.length;
  const ny = rowDepths.length;
  const colOffsets = buildAxisOffsets(colWidths);
  const rowOffsets = buildAxisOffsets(rowDepths);
  const xsGrid = buildGridBreaksFromSizes(colWidths);
  const ysGrid = buildGridBreaksFromSizes(rowDepths);

  const z0 = floorH;
  const z1 = floorH + STD_H_BOTTOM;
  const z2 = floorH + STD_H_BOTTOM + STD_H_VERT;
  const z3 = floorH + STANDARD_SOCKET_HEIGHT;

  for (let iy = 0; iy < ny; iy++) {
    const yA = rowOffsets[iy];
    const yD = rowOffsets[iy + 1];
    const yB = yA + 4;
    const yC = yD - 4;
    const cy = (yA + yD) / 2;

    for (let ix = 0; ix < nx; ix++) {
      const xA = colOffsets[ix];
      const xD = colOffsets[ix + 1];
      const xB = xA + 4;
      const xC = xD - 4;
      const cx = (xA + xD) / 2;

      const ring0 = buildCellRingRect(xA, xD, yA, yD, 1.15, z0);
      const ring1 = buildCellRingRect(xA, xD, yA, yD, 1.85, z1);
      const ring2 = buildCellRingRect(xA, xD, yA, yD, 1.85, z2);
      const ring3 = buildCellRingRect(xA, xD, yA, yD, 4.0, z3);

      const rings = [ring0, ring1, ring2, ring3];
      const cB = iy === 0 && padB === 0 ? connB : 0;
      const cR = ix === nx - 1 && padR === 0 ? connR : 0;
      const cT = iy === ny - 1 && padT === 0 ? connT : 0;
      const cL = ix === 0 && padL === 0 ? connL : 0;
      const bevelConnForK = (k) => {
        if (k === 35) return { conn: cB, tan: [1, 0], pA: [xB, yA, z3], pB: [xC, yA, z3] };
        if (k === 8) return { conn: cR, tan: [0, 1], pA: [xD, yB, z3], pB: [xD, yC, z3] };
        if (k === 17) return { conn: cT, tan: [-1, 0], pA: [xC, yD, z3], pB: [xB, yD, z3] };
        if (k === 26) return { conn: cL, tan: [0, -1], pA: [xA, yC, z3], pB: [xA, yB, z3] };
        return null;
      };

      for (let m = 0; m < 3; m++) {
        const low = rings[m];
        const high = rings[m + 1];
        for (let k = 0; k < 36; k++) {
          const kNext = (k + 1) % 36;
          const bc = m === 2 ? bevelConnForK(k) : null;
          if (!bc || !bc.conn) {
            tc.quad(low[k], high[k], high[kNext], low[kNext]);
          } else {
            const hHalf = bc.conn === 'tab' ? TAB_HALF_NECK : SLOT_HALF_NECK;
            const midX = (bc.pA[0] + bc.pB[0]) / 2;
            const midY = (bc.pA[1] + bc.pB[1]) / 2;
            const n0 = [midX - bc.tan[0] * hHalf, midY - bc.tan[1] * hHalf, z3];
            const n1 = [midX + bc.tan[0] * hHalf, midY + bc.tan[1] * hHalf, z3];
            tc.tri(low[k], high[k], n0);
            tc.tri(low[k], n0, n1);
            tc.tri(low[k], n1, low[kNext]);
            tc.tri(low[kNext], n1, high[kNext]);
          }
        }
      }

      const cellBounds = { xA, xB, xC, xD, yA, yB, yC, yD };
      const crBR = ix === nx - 1 && iy === 0 && padR === 0 && padB === 0 ? rBR : 0;
      const crTR = ix === nx - 1 && iy === ny - 1 && padR === 0 && padT === 0 ? rTR : 0;
      const crTL = ix === 0 && iy === ny - 1 && padL === 0 && padT === 0 ? rTL : 0;
      const crBL = ix === 0 && iy === 0 && padL === 0 && padB === 0 ? rBL : 0;

      // Top spandrels (note: for rounded outer cell corners, R3 = 4.0 meets effR <= 4.0!)
      const topR = (r) => (r > 0.05 ? Math.min(r, 4) : 0);
      emitCellCornerTopAndBottom(tc, 'BR', cellBounds, ring3, z3, topR(crBR), false);
      emitCellCornerTopAndBottom(tc, 'TR', cellBounds, ring3, z3, topR(crTR), false);
      emitCellCornerTopAndBottom(tc, 'TL', cellBounds, ring3, z3, topR(crTL), false);
      emitCellCornerTopAndBottom(tc, 'BL', cellBounds, ring3, z3, topR(crBL), false);

      if (floorH === 0) {
        emitCellCornerTopAndBottom(tc, 'BR', cellBounds, ring0, 0, crBR, true);
        emitCellCornerTopAndBottom(tc, 'TR', cellBounds, ring0, 0, crTR, true);
        emitCellCornerTopAndBottom(tc, 'TL', cellBounds, ring0, 0, crTL, true);
        emitCellCornerTopAndBottom(tc, 'BL', cellBounds, ring0, 0, crBL, true);

        const botSideConn = (side, rA, rB) => {
          const effA = topR(rA);
          const effB = topR(rB);
          if (side === 'B') {
            const p0 = effA > 0.05 ? [xA + effA, yA, 0] : [xA, yA, 0];
            const p1 = effB > 0.05 ? [xD - effB, yA, 0] : [xD, yA, 0];
            if (effA <= 0.05) tc.tri(p0, ring0[35], [xB, yA, 0]);
            else tc.quad([xA + effA, yA, 0], [xB, yA, 0], ring0[35], [xA + effA, yA + effA * 0, 0]); // handled below
            if (effB <= 0.05) tc.tri([xC, yA, 0], ring0[0], p1);
          }
        };
        // Clean corner wing triangles on z=0
        const bL_r = topR(crBL);
        const bR_r = topR(crBR);
        const tR_r = topR(crTR);
        const tL_r = topR(crTL);

        // Bottom wings
        if (bR_r > 0.05) {
          if (bR_r < 3.99) {
            tc.tri([xC, yA, 0], ring0[0], [xD - bR_r, yA, 0]);
            tc.tri([xD, yA + bR_r, 0], ring0[8], [xD, yB, 0]);
          }
        } else {
          tc.tri([xC, yA, 0], ring0[0], [xD, yA, 0]);
          tc.tri([xD, yA, 0], ring0[8], [xD, yB, 0]);
        }
        if (tR_r > 0.05) {
          if (tR_r < 3.99) {
            tc.tri([xD, yC, 0], ring0[9], [xD, yD - tR_r, 0]);
            tc.tri([xD - tR_r, yD, 0], ring0[17], [xC, yD, 0]);
          }
        } else {
          tc.tri([xD, yC, 0], ring0[9], [xD, yD, 0]);
          tc.tri([xD, yD, 0], ring0[17], [xC, yD, 0]);
        }
        if (tL_r > 0.05) {
          if (tL_r < 3.99) {
            tc.tri([xB, yD, 0], ring0[18], [xA + tL_r, yD, 0]);
            tc.tri([xA, yD - tL_r, 0], ring0[26], [xA, yC, 0]);
          }
        } else {
          tc.tri([xB, yD, 0], ring0[18], [xA, yD, 0]);
          tc.tri([xA, yD, 0], ring0[26], [xA, yC, 0]);
        }
        if (bL_r > 0.05) {
          if (bL_r < 3.99) {
            tc.tri([xA, yB, 0], ring0[27], [xA, yA + bL_r, 0]);
            tc.tri([xA + bL_r, yA, 0], ring0[35], [xB, yA, 0]);
          }
        } else {
          tc.tri([xA, yB, 0], ring0[27], [xA, yA, 0]);
          tc.tri([xA, yA, 0], ring0[35], [xB, yA, 0]);
        }

        // Bottom straight edge quads (with connector splits when outer tile seam has tab/slot)
        const cB = iy === 0 && padB === 0 ? connB : 0;
        const cR = ix === nx - 1 && padR === 0 ? connR : 0;
        const cT = iy === ny - 1 && padT === 0 ? connT : 0;
        const cL = ix === 0 && padL === 0 ? connL : 0;

        emitBottomStraightWithConnector(tc, [xB, yA], [xC, yA], ring0[0], ring0[35], cB, [0, -1], [1, 0]);
        emitBottomStraightWithConnector(tc, [xD, yB], [xD, yC], ring0[9], ring0[8], cR, [1, 0], [0, 1]);
        emitBottomStraightWithConnector(tc, [xC, yD], [xB, yD], ring0[18], ring0[17], cT, [0, 1], [-1, 0]);
        emitBottomStraightWithConnector(tc, [xA, yC], [xA, yB], ring0[27], ring0[26], cL, [-1, 0], [0, -1]);
      } else {
        const center = [cx, cy, z0];
        for (let k = 0; k < 36; k++) {
          tc.tri(center, ring0[k], ring0[(k + 1) % 36]);
        }
      }
    }
  }

  addBorderRimsAndWalls(tc, {
    spec,
    colOffsets,
    rowOffsets,
    zTop: z3,
    floorH,
    rimStyle,
    xsGrid,
    ysGrid,
    bottomSlotLoops: [],
  });
  return z3;
}

function buildFastLightweightMesh(tc, spec, rimStyle) {
  const {
    colWidths,
    rowDepths,
    padL = 0,
    padR = 0,
    padB = 0,
    padT = 0,
    rBL = 0,
    rBR = 0,
    rTR = 0,
    rTL = 0,
    connL = 0,
    connR = 0,
    connB = 0,
    connT = 0,
  } = spec;

  const nx = colWidths.length;
  const ny = rowDepths.length;
  const colOffsets = buildAxisOffsets(colWidths);
  const rowOffsets = buildAxisOffsets(rowDepths);
  const xsGrid = buildGridBreaksFromSizes(colWidths);
  const ysGrid = buildGridBreaksFromSizes(rowDepths);
  const zTop = FAST_SOCKET_HEIGHT; // 4.25 mm

  for (let iy = 0; iy < ny; iy++) {
    const yA = rowOffsets[iy];
    const yD = rowOffsets[iy + 1];
    const yB = yA + 4;
    const yC = yD - 4;

    for (let ix = 0; ix < nx; ix++) {
      const xA = colOffsets[ix];
      const xD = colOffsets[ix + 1];
      const xB = xA + 4;
      const xC = xD - 4;

      const ring0 = buildCellRingRect(xA, xD, yA, yD, 1.85, 0);
      const ring1 = buildCellRingRect(xA, xD, yA, yD, 1.85, FAST_H_VERT);
      const ring2 = buildCellRingRect(xA, xD, yA, yD, 3.6, zTop);

      const rings = [ring0, ring1, ring2];
      for (let m = 0; m < 2; m++) {
        const low = rings[m];
        const high = rings[m + 1];
        for (let k = 0; k < 36; k++) {
          const kNext = (k + 1) % 36;
          tc.quad(low[k], high[k], high[kNext], low[kNext]);
        }
      }

      const crBR = ix === nx - 1 && iy === 0 && padR === 0 && padB === 0 ? rBR : 0;
      const crTR = ix === nx - 1 && iy === ny - 1 && padR === 0 && padT === 0 ? rTR : 0;
      const crTL = ix === 0 && iy === ny - 1 && padL === 0 && padT === 0 ? rTL : 0;
      const crBL = ix === 0 && iy === 0 && padL === 0 && padB === 0 ? rBL : 0;
      const effR = (r) => (r > 0.05 ? Math.min(r, 4) : 0);

      // Top face (z = zTop): 0.40 mm flat lip + corner spandrels (or rounded outer arcs)
      const emitFastTopCorner = (type, r, start, pStart, pEnd, vCorner, arcStart, acx, acy) => {
        const er = effR(r);
        if (er <= 0.05) {
          for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vCorner, ring2[start + s + 1], ring2[start + s]);
          tc.tri(pStart, vCorner, ring2[start]);
          tc.tri(vCorner, pEnd, ring2[start + 8]);
          return;
        }
        // Rounded outer corner arc at er <= 4.0
        for (let s = 0; s < ARC_SEGMENTS; s++) {
          const a0 = arcStart + (s / ARC_SEGMENTS) * (Math.PI / 2);
          const a1 = arcStart + ((s + 1) / ARC_SEGMENTS) * (Math.PI / 2);
          const o0 = [acx + er * Math.cos(a0), acy + er * Math.sin(a0), zTop];
          const o1 = [acx + er * Math.cos(a1), acy + er * Math.sin(a1), zTop];
          tc.quad(o0, o1, ring2[start + s + 1], ring2[start + s]);
        }
        const arcFirst = [acx + er * Math.cos(arcStart), acy + er * Math.sin(arcStart), zTop];
        const arcLast = [acx + er * Math.cos(arcStart + Math.PI / 2), acy + er * Math.sin(arcStart + Math.PI / 2), zTop];
        if (er < 3.99) {
          tc.tri(pStart, arcFirst, ring2[start]);
          tc.tri(arcLast, pEnd, ring2[start + 8]);
        }
      };

      emitFastTopCorner('BR', crBR, 0, [xC, yA, zTop], [xD, yB, zTop], [xD, yA, zTop], -Math.PI / 2, xD - effR(crBR), yA + effR(crBR));
      emitFastTopCorner('TR', crTR, 9, [xD, yC, zTop], [xC, yD, zTop], [xD, yD, zTop], 0, xD - effR(crTR), yD - effR(crTR));
      emitFastTopCorner('TL', crTL, 18, [xB, yD, zTop], [xA, yC, zTop], [xA, yD, zTop], Math.PI / 2, xA + effR(crTL), yD - effR(crTL));
      emitFastTopCorner('BL', crBL, 27, [xA, yB, zTop], [xB, yA, zTop], [xA, yA, zTop], Math.PI, xA + effR(crBL), yA + effR(crBL));

      // 4 straight 0.40 mm top lip quads (split at tab/slot neck when outer edge carries a connector)
      const emitTopLip = (pA, pB, inA, inB, conn, tanDir) => {
        if (!conn) {
          tc.quad([pA[0], pA[1], zTop], [pB[0], pB[1], zTop], inB, inA);
          return;
        }
        const hHalf = conn === 'tab' ? TAB_HALF_NECK : SLOT_HALF_NECK;
        const midX = (pA[0] + pB[0]) / 2;
        const midY = (pA[1] + pB[1]) / 2;
        const n0 = [midX - tanDir[0] * hHalf, midY - tanDir[1] * hHalf, zTop];
        const n1 = [midX + tanDir[0] * hHalf, midY + tanDir[1] * hHalf, zTop];
        tc.tri([pA[0], pA[1], zTop], n0, inA);
        tc.tri(n0, n1, inA);
        tc.tri(n1, inB, inA);
        tc.tri(n1, [pB[0], pB[1], zTop], inB);
      };

      const cB = iy === 0 && padB === 0 ? connB : 0;
      const cR = ix === nx - 1 && padR === 0 ? connR : 0;
      const cT = iy === ny - 1 && padT === 0 ? connT : 0;
      const cL = ix === 0 && padL === 0 ? connL : 0;

      emitTopLip([xB, yA], [xC, yA], ring2[35], ring2[0], cB, [1, 0]);
      emitTopLip([xD, yB], [xD, yC], ring2[8], ring2[9], cR, [0, 1]);
      emitTopLip([xC, yD], [xB, yD], ring2[17], ring2[18], cT, [-1, 0]);
      emitTopLip([xA, yC], [xA, yB], ring2[26], ring2[27], cL, [0, -1]);

      // Bottom face (z = 0)
      const hasBottomNeighbor = iy > 0;
      const hasRightNeighbor = ix < nx - 1;
      const hasTopNeighbor = iy < ny - 1;
      const hasLeftNeighbor = ix > 0;

      const emitFastBotCorner = (r, start, vCorner, arcStart, acx, acy, pStart, pEnd, hasPrevN, prevGroovePt, hasNextN, nextGroovePt) => {
        const er = effR(r);
        if (er <= 0.05) {
          for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vCorner, ring0[start + s], ring0[start + s + 1]);
          if (hasPrevN) {
            tc.tri(pStart, prevGroovePt, vCorner);
            tc.tri(prevGroovePt, ring0[start], vCorner);
          } else {
            tc.tri(pStart, ring0[start], vCorner);
          }
          if (hasNextN) {
            tc.tri(vCorner, ring0[start + 8], nextGroovePt);
            tc.tri(vCorner, nextGroovePt, pEnd);
          } else {
            tc.tri(vCorner, ring0[start + 8], pEnd);
          }
          return;
        }
        // Rounded outer corner on z=0
        for (let s = 0; s < ARC_SEGMENTS; s++) {
          const a0 = arcStart + (s / ARC_SEGMENTS) * (Math.PI / 2);
          const a1 = arcStart + ((s + 1) / ARC_SEGMENTS) * (Math.PI / 2);
          const o0 = [acx + er * Math.cos(a0), acy + er * Math.sin(a0), 0];
          const o1 = [acx + er * Math.cos(a1), acy + er * Math.sin(a1), 0];
          tc.quad(o0, ring0[start + s], ring0[start + s + 1], o1);
        }
        const arcFirst = [acx + er * Math.cos(arcStart), acy + er * Math.sin(arcStart), 0];
        const arcLast = [acx + er * Math.cos(arcStart + Math.PI / 2), acy + er * Math.sin(arcStart + Math.PI / 2), 0];
        if (hasPrevN) {
          tc.tri(pStart, prevGroovePt, arcFirst);
          tc.tri(prevGroovePt, ring0[start], arcFirst);
        } else if (er < 3.99) {
          tc.tri(pStart, ring0[start], arcFirst);
        }
        if (hasNextN) {
          tc.tri(arcLast, ring0[start + 8], nextGroovePt);
          tc.tri(arcLast, nextGroovePt, pEnd);
        } else if (er < 3.99) {
          tc.tri(arcLast, ring0[start + 8], pEnd);
        }
      };

      emitFastBotCorner(
        crBR, 0, [xD, yA, 0], -Math.PI / 2, xD - effR(crBR), yA + effR(crBR),
        [xC, yA, 0], [xD, yB, 0],
        hasBottomNeighbor, [xC, yA + FAST_GROOVE_HALF, 0],
        hasRightNeighbor, [xD - FAST_GROOVE_HALF, yB, 0]
      );
      emitFastBotCorner(
        crTR, 9, [xD, yD, 0], 0, xD - effR(crTR), yD - effR(crTR),
        [xD, yC, 0], [xC, yD, 0],
        hasRightNeighbor, [xD - FAST_GROOVE_HALF, yC, 0],
        hasTopNeighbor, [xC, yD - FAST_GROOVE_HALF, 0]
      );
      emitFastBotCorner(
        crTL, 18, [xA, yD, 0], Math.PI / 2, xA + effR(crTL), yD - effR(crTL),
        [xB, yD, 0], [xA, yC, 0],
        hasTopNeighbor, [xB, yD - FAST_GROOVE_HALF, 0],
        hasLeftNeighbor, [xA + FAST_GROOVE_HALF, yC, 0]
      );
      emitFastBotCorner(
        crBL, 27, [xA, yA, 0], Math.PI, xA + effR(crBL), yA + effR(crBL),
        [xA, yB, 0], [xB, yA, 0],
        hasLeftNeighbor, [xA + FAST_GROOVE_HALF, yB, 0],
        hasBottomNeighbor, [xB, yA + FAST_GROOVE_HALF, 0]
      );

      // Straight bottom edges (with groove offsets inside, or connectors on outer tile edges)
      if (hasBottomNeighbor) {
        const yGroove = yA + FAST_GROOVE_HALF;
        tc.quad([xB, yGroove, 0], ring0[35], ring0[0], [xC, yGroove, 0]);
      } else {
        emitBottomStraightWithConnector(tc, [xB, yA], [xC, yA], ring0[0], ring0[35], cB, [0, -1], [1, 0]);
      }

      if (hasRightNeighbor) {
        const xGroove = xD - FAST_GROOVE_HALF;
        tc.quad([xGroove, yB, 0], ring0[8], ring0[9], [xGroove, yC, 0]);
      } else {
        emitBottomStraightWithConnector(tc, [xD, yB], [xD, yC], ring0[9], ring0[8], cR, [1, 0], [0, 1]);
      }

      if (hasTopNeighbor) {
        const yGroove = yD - FAST_GROOVE_HALF;
        tc.quad([xC, yGroove, 0], ring0[17], ring0[18], [xB, yGroove, 0]);
      } else {
        emitBottomStraightWithConnector(tc, [xC, yD], [xB, yD], ring0[18], ring0[17], cT, [0, 1], [-1, 0]);
      }

      if (hasLeftNeighbor) {
        const xGroove = xA + FAST_GROOVE_HALF;
        tc.quad([xGroove, yC, 0], ring0[26], ring0[27], [xGroove, yB, 0]);
      } else {
        emitBottomStraightWithConnector(tc, [xA, yC], [xA, yB], ring0[27], ring0[26], cL, [-1, 0], [0, -1]);
      }
    }
  }

  // Hollow 45 deg gable channels under interior vertical dividers
  for (let ix = 1; ix < nx; ix++) {
    const xDiv = colOffsets[ix];
    const xL = xDiv - FAST_GROOVE_HALF;
    const xR = xDiv + FAST_GROOVE_HALF;
    for (let iy = 0; iy < ny; iy++) {
      const ya = rowOffsets[iy] + 4;
      const yb = rowOffsets[iy + 1] - 4;
      tc.quad([xL, ya, 0], [xL, yb, 0], [xL, yb, FAST_GROOVE_WALL_H], [xL, ya, FAST_GROOVE_WALL_H]);
      tc.quad([xL, ya, FAST_GROOVE_WALL_H], [xL, yb, FAST_GROOVE_WALL_H], [xDiv, yb, FAST_GROOVE_PEAK_H], [xDiv, ya, FAST_GROOVE_PEAK_H]);
      tc.quad([xDiv, ya, FAST_GROOVE_PEAK_H], [xDiv, yb, FAST_GROOVE_PEAK_H], [xR, yb, FAST_GROOVE_WALL_H], [xR, ya, FAST_GROOVE_WALL_H]);
      tc.quad([xR, ya, FAST_GROOVE_WALL_H], [xR, yb, FAST_GROOVE_WALL_H], [xR, yb, 0], [xR, ya, 0]);

      tc.tri([xL, ya, 0], [xL, ya, FAST_GROOVE_WALL_H], [xDiv, ya, 0]);
      tc.tri([xDiv, ya, 0], [xL, ya, FAST_GROOVE_WALL_H], [xDiv, ya, FAST_GROOVE_PEAK_H]);
      tc.tri([xDiv, ya, 0], [xDiv, ya, FAST_GROOVE_PEAK_H], [xR, ya, FAST_GROOVE_WALL_H]);
      tc.tri([xDiv, ya, 0], [xR, ya, FAST_GROOVE_WALL_H], [xR, ya, 0]);

      tc.tri([xR, yb, 0], [xR, yb, FAST_GROOVE_WALL_H], [xDiv, yb, 0]);
      tc.tri([xDiv, yb, 0], [xR, yb, FAST_GROOVE_WALL_H], [xDiv, yb, FAST_GROOVE_PEAK_H]);
      tc.tri([xDiv, yb, 0], [xDiv, yb, FAST_GROOVE_PEAK_H], [xL, yb, FAST_GROOVE_WALL_H]);
      tc.tri([xDiv, yb, 0], [xL, yb, FAST_GROOVE_WALL_H], [xL, yb, 0]);
    }
  }

  // Hollow 45 deg gable channels under interior horizontal dividers
  for (let iy = 1; iy < ny; iy++) {
    const yDiv = rowOffsets[iy];
    const yB = yDiv - FAST_GROOVE_HALF;
    const yT = yDiv + FAST_GROOVE_HALF;
    for (let ix = 0; ix < nx; ix++) {
      const xa = colOffsets[ix] + 4;
      const xb = colOffsets[ix + 1] - 4;
      tc.quad([xb, yB, 0], [xa, yB, 0], [xa, yB, FAST_GROOVE_WALL_H], [xb, yB, FAST_GROOVE_WALL_H]);
      tc.quad([xb, yB, FAST_GROOVE_WALL_H], [xa, yB, FAST_GROOVE_WALL_H], [xa, yDiv, FAST_GROOVE_PEAK_H], [xb, yDiv, FAST_GROOVE_PEAK_H]);
      tc.quad([xb, yDiv, FAST_GROOVE_PEAK_H], [xa, yDiv, FAST_GROOVE_PEAK_H], [xa, yT, FAST_GROOVE_WALL_H], [xb, yT, FAST_GROOVE_WALL_H]);
      tc.quad([xb, yT, FAST_GROOVE_WALL_H], [xa, yT, FAST_GROOVE_WALL_H], [xa, yT, 0], [xb, yT, 0]);

      tc.tri([xa, yT, 0], [xa, yT, FAST_GROOVE_WALL_H], [xa, yDiv, 0]);
      tc.tri([xa, yDiv, 0], [xa, yT, FAST_GROOVE_WALL_H], [xa, yDiv, FAST_GROOVE_PEAK_H]);
      tc.tri([xa, yDiv, 0], [xa, yDiv, FAST_GROOVE_PEAK_H], [xa, yB, FAST_GROOVE_WALL_H]);
      tc.tri([xa, yDiv, 0], [xa, yB, FAST_GROOVE_WALL_H], [xa, yB, 0]);

      tc.tri([xb, yB, 0], [xb, yB, FAST_GROOVE_WALL_H], [xb, yDiv, 0]);
      tc.tri([xb, yDiv, 0], [xb, yB, FAST_GROOVE_WALL_H], [xb, yDiv, FAST_GROOVE_PEAK_H]);
      tc.tri([xb, yDiv, 0], [xb, yDiv, FAST_GROOVE_PEAK_H], [xb, yT, FAST_GROOVE_WALL_H]);
      tc.tri([xb, yDiv, 0], [xb, yT, FAST_GROOVE_WALL_H], [xb, yT, 0]);
    }
  }

  addBorderRimsAndWalls(tc, {
    spec,
    colOffsets,
    rowOffsets,
    zTop,
    floorH: 0,
    rimStyle,
    xsGrid,
    ysGrid,
    bottomSlotLoops: [],
  });
  return zTop;
}

/**
 * Generate a 100% watertight, 2-manifold triangle mesh for a Gridfinity baseplate tile.
 * Coordinates are centered in XY around (0, 0) with Z starting at 0.
 */
export function generateTileMesh(spec, options = {}) {
  const opts = typeof options === 'number' ? { style: 'solid', floorThicknessMm: options } : options;
  const style = opts.style || 'fast';
  const floorH = Math.max(0, opts.floorThicknessMm || 0);
  const rimStyle = opts.rimStyle || 'grid';

  const colWidths = spec.colWidths || new Array(spec.nx).fill(GRIDFINITY_PITCH);
  const rowDepths = spec.rowDepths || new Array(spec.ny).fill(GRIDFINITY_PITCH);
  const fullSpec = { ...spec, colWidths, rowDepths };

  const tc = new TriangleCollector();
  const heightMm =
    style === 'fast'
      ? buildFastLightweightMesh(tc, fullSpec, rimStyle)
      : buildStandardMesh(tc, fullSpec, floorH, rimStyle);

  const gridW = sumArr(colWidths);
  const gridD = sumArr(rowDepths);
  const xMin = -(fullSpec.padL || 0);
  const xMax = gridW + (fullSpec.padR || 0);
  const yMin = -(fullSpec.padB || 0);
  const yMax = gridD + (fullSpec.padT || 0);

  // Center the nominal tile footprint (excluding tab protrusion so drawer grid aligns on pitch)
  const offsetX = -(xMin + xMax) / 2;
  const offsetY = -(yMin + yMax) / 2;
  const { positions, normals, triCount, volumeMm3 } = tc.toBuffers();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += offsetX;
    positions[i + 1] += offsetY;
  }

  const volumeCm3 = volumeMm3 / 1000;
  const estGramsPla = volumeCm3 * 1.24;

  return {
    positions,
    normals,
    triCount,
    volumeMm3,
    volumeCm3,
    estGramsPla,
    widthMm:
      xMax -
      xMin +
      (fullSpec.connL === 'tab' ? TAB_PROTRUSION_MM : 0) +
      (fullSpec.connR === 'tab' ? TAB_PROTRUSION_MM : 0),
    depthMm:
      yMax -
      yMin +
      (fullSpec.connB === 'tab' ? TAB_PROTRUSION_MM : 0) +
      (fullSpec.connT === 'tab' ? TAB_PROTRUSION_MM : 0),
    nominalWidthMm: xMax - xMin,
    nominalDepthMm: yMax - yMin,
    heightMm,
  };
}

/**
 * Encode a mesh (from generateTileMesh) as a standard Binary STL Uint8Array.
 */
export function encodeBinaryStl(mesh, headerText = 'Gridfinity Baseplate Studio') {
  const { positions, normals, triCount } = mesh;
  const byteLength = 84 + triCount * 50;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < Math.min(headerText.length, 79); i++) {
    bytes[i] = headerText.charCodeAt(i) & 0x7f;
  }
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const pIdx = t * 9;
    view.setFloat32(offset, normals[pIdx], true);
    view.setFloat32(offset + 4, normals[pIdx + 1], true);
    view.setFloat32(offset + 8, normals[pIdx + 2], true);
    for (let v = 0; v < 9; v++) {
      view.setFloat32(offset + 12 + v * 4, positions[pIdx + v], true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return bytes;
}
