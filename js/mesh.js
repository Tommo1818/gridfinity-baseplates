import { GRIDFINITY_PITCH } from './planner.js';

const ARC_SEGMENTS = 8; // 8 segments per corner -> 36 vertices per cell ring

// Standard Solid (4.65 mm) constants (Zack Freedman official spec)
const STD_H_BOTTOM = 0.7;
const STD_H_VERT = 1.8;
const STD_H_TOP = 2.15;
export const STANDARD_SOCKET_HEIGHT = STD_H_BOTTOM + STD_H_VERT + STD_H_TOP; // 4.65 mm

// Fast Lightweight (4.25 mm) constants (inspired by Fast 0.8/0.4 lightweight baseplate)
const FAST_H_VERT = 2.5;
const FAST_H_TOP = 1.75;
export const FAST_SOCKET_HEIGHT = FAST_H_VERT + FAST_H_TOP; // 4.25 mm
const FAST_TOP_LIP = 0.4; // 0.40 mm flat lip per cell side (0.80 mm across divider)
const FAST_GROOVE_HALF = 1.33; // Leaves 0.82 mm wall on each side of divider (2.15 - 1.33)
const FAST_GROOVE_WALL_H = 2.16;
const FAST_GROOVE_PEAK_H = 3.49; // 2.16 + 1.33 = 3.49 (exact 45 deg roof)

/**
 * Compute the 36-vertex CCW ring (in XY) for a Gridfinity cell centered at (cx, cy).
 */
function buildCellRing(cx, cy, r, z) {
  const pts = new Array(36);
  const corners = [
    { x: cx + 17, y: cy - 17, startAngle: -Math.PI / 2 }, // Corner 0: Bottom-Right
    { x: cx + 17, y: cy + 17, startAngle: 0 }, // Corner 1: Top-Right
    { x: cx - 17, y: cy + 17, startAngle: Math.PI / 2 }, // Corner 2: Top-Left
    { x: cx - 17, y: cy - 17, startAngle: Math.PI }, // Corner 3: Bottom-Left
  ];
  let idx = 0;
  for (let c = 0; c < 4; c++) {
    const corner = corners[c];
    for (let s = 0; s <= ARC_SEGMENTS; s++) {
      const a = corner.startAngle + (s / ARC_SEGMENTS) * (Math.PI / 2);
      pts[idx++] = [
        corner.x + r * Math.cos(a),
        corner.y + r * Math.sin(a),
        z,
      ];
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

  // Quad in CCW order when viewed from normal side: (a, b, c, d)
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  toBuffers() {
    const triCount = this.coords.length / 9;
    const positions = new Float32Array(this.coords);
    const normals = new Float32Array(this.coords.length);

    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i];
      const ay = positions[i + 1];
      const az = positions[i + 2];
      const ux = positions[i + 3] - ax;
      const uy = positions[i + 4] - ay;
      const uz = positions[i + 5] - az;
      const vx = positions[i + 6] - ax;
      const vy = positions[i + 7] - ay;
      const vz = positions[i + 8] - az;

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

    return { positions, normals, triCount };
  }
}

export const RIM_OUTER_WALL = 1.6;
export const RIM_INNER_COLLAR = 1.2;
export const RIM_RIB_THICKNESS = 1.6;
export const MIN_GRID_RIM_PAD = RIM_OUTER_WALL + RIM_INNER_COLLAR + 2.0; // 4.8 mm

function buildGridBreaks(count) {
  const breaks = [0];
  for (let i = 0; i < count; i++) {
    const base = i * GRIDFINITY_PITCH;
    breaks.push(base + 4, base + 38, base + 42);
  }
  return breaks;
}

function buildRimCellSegments(count) {
  const segs = [];
  for (let i = 0; i < count; i++) {
    const a = i * GRIDFINITY_PITCH;
    const b = a + GRIDFINITY_PITCH;
    const ribA = a + (i === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2);
    const ribB = b - (i === count - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2);
    segs.push({ a, ribA, ribB, b, cellB: a + 4, cellC: a + 38 });
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
  // 4 vertical inner pocket walls (normals pointing inward into cutout)
  // Left wall (x = x0, +X)
  tc.quad([x0, y0, zBot], [x0, y1, zBot], [x0, y1, zTop], [x0, y0, zTop]);
  // Right wall (x = x1, -X)
  tc.quad([x1, y1, zBot], [x1, y0, zBot], [x1, y0, zTop], [x1, y1, zTop]);
  // Bottom wall (y = y0, +Y)
  tc.quad([x1, y0, zBot], [x0, y0, zBot], [x0, y0, zTop], [x1, y0, zTop]);
  // Top wall (y = y1, -Y)
  tc.quad([x0, y1, zBot], [x1, y1, zBot], [x1, y1, zTop], [x0, y1, zTop]);

  if (solidBottom) {
    // Pocket floor at z = zBot (+Z normal)
    tc.quad([x0, y0, zBot], [x1, y0, zBot], [x1, y1, zBot], [x0, y1, zBot]);
  }
}

function addBorderRimsAndWalls(
  tc,
  { nx, ny, padL, padR, padB, padT, zTop, floorH = 0, rimStyle = 'grid', xsGrid, ysGrid }
) {
  const gridW = nx * GRIDFINITY_PITCH;
  const gridD = ny * GRIDFINITY_PITCH;
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

  const ySegs = buildRimCellSegments(ny);
  const xSegs = buildRimCellSegments(nx);

  // Left rim: [xMin, 0] x [0, gridD]
  if (padL > 0) {
    if (!cutL) {
      for (let j = 0; j < ysGrid.length - 1; j++) {
        emitTopAndOptionalBottomQuad(tc, xMin, 0, ysGrid[j], ysGrid[j + 1], zTop, solidBottom);
      }
    } else {
      const x1 = xMin + RIM_OUTER_WALL;
      const x2 = -RIM_INNER_COLLAR;
      for (const s of ySegs) {
        // Outer wall [xMin, x1]
        emitTopAndOptionalBottomQuad(tc, xMin, x1, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, xMin, x1, s.ribA, s.ribB, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, xMin, x1, s.ribB, s.b, zTop, solidBottom);
        // Ribs [x1, x2]
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.ribB, s.b, zTop, solidBottom);
        // Cutout pocket [x1, x2] x [s.ribA, s.ribB]
        emitCutoutPocket(tc, x1, x2, s.ribA, s.ribB, zCutBot, zTop, solidBottom);
        // Inner collar [x2, 0] bridging (s.a, s.ribA, s.ribB, s.b) to (s.a, s.cellB, s.cellC, s.b)
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

  // Right rim: [gridW, xMax] x [0, gridD]
  if (padR > 0) {
    if (!cutR) {
      for (let j = 0; j < ysGrid.length - 1; j++) {
        emitTopAndOptionalBottomQuad(tc, gridW, xMax, ysGrid[j], ysGrid[j + 1], zTop, solidBottom);
      }
    } else {
      const x1 = gridW + RIM_INNER_COLLAR;
      const x2 = xMax - RIM_OUTER_WALL;
      for (const s of ySegs) {
        // Outer wall [x2, xMax]
        emitTopAndOptionalBottomQuad(tc, x2, xMax, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x2, xMax, s.ribA, s.ribB, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x2, xMax, s.ribB, s.b, zTop, solidBottom);
        // Ribs [x1, x2]
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.a, s.ribA, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, x1, x2, s.ribB, s.b, zTop, solidBottom);
        // Cutout pocket
        emitCutoutPocket(tc, x1, x2, s.ribA, s.ribB, zCutBot, zTop, solidBottom);
        // Inner collar [gridW, x1] bridging (s.a, s.cellB, s.cellC, s.b) to (s.a, s.ribA, s.ribB, s.b)
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

  // Bottom rim: [0, gridW] x [yMin, 0]
  if (padB > 0) {
    if (!cutB) {
      for (let i = 0; i < xsGrid.length - 1; i++) {
        emitTopAndOptionalBottomQuad(tc, xsGrid[i], xsGrid[i + 1], yMin, 0, zTop, solidBottom);
      }
    } else {
      const y1 = yMin + RIM_OUTER_WALL;
      const y2 = -RIM_INNER_COLLAR;
      for (const s of xSegs) {
        // Outer wall [yMin, y1]
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, yMin, y1, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribA, s.ribB, yMin, y1, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, yMin, y1, zTop, solidBottom);
        // Ribs [y1, y2]
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, y1, y2, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, y1, y2, zTop, solidBottom);
        // Cutout pocket
        emitCutoutPocket(tc, s.ribA, s.ribB, y1, y2, zCutBot, zTop, solidBottom);
        // Inner collar [y2, 0]
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

  // Top rim: [0, gridW] x [gridD, yMax]
  if (padT > 0) {
    if (!cutT) {
      for (let i = 0; i < xsGrid.length - 1; i++) {
        emitTopAndOptionalBottomQuad(tc, xsGrid[i], xsGrid[i + 1], gridD, yMax, zTop, solidBottom);
      }
    } else {
      const y1 = gridD + RIM_INNER_COLLAR;
      const y2 = yMax - RIM_OUTER_WALL;
      for (const s of xSegs) {
        // Outer wall [y2, yMax]
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, y2, yMax, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribA, s.ribB, y2, yMax, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, y2, yMax, zTop, solidBottom);
        // Ribs [y1, y2]
        emitTopAndOptionalBottomQuad(tc, s.a, s.ribA, y1, y2, zTop, solidBottom);
        emitTopAndOptionalBottomQuad(tc, s.ribB, s.b, y1, y2, zTop, solidBottom);
        // Cutout pocket
        emitCutoutPocket(tc, s.ribA, s.ribB, y1, y2, zCutBot, zTop, solidBottom);
        // Inner collar [gridD, y1]
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

  // 4 Corner rim patches (each uses exact X breaks of Left/Right and Y breaks of Bottom/Top)
  const xBreaksL = cutL ? [xMin, xMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, 0] : [xMin, 0];
  const xBreaksR = cutR ? [gridW, gridW + RIM_INNER_COLLAR, xMax - RIM_OUTER_WALL, xMax] : [gridW, xMax];
  const yBreaksB = cutB ? [yMin, yMin + RIM_OUTER_WALL, -RIM_INNER_COLLAR, 0] : [yMin, 0];
  const yBreaksT = cutT ? [gridD, gridD + RIM_INNER_COLLAR, yMax - RIM_OUTER_WALL, yMax] : [gridD, yMax];

  const cornerConfigs = [
    { cond: padL > 0 && padB > 0, xs: xBreaksL, ys: yBreaksB, canCut: cutL && cutB },
    { cond: padR > 0 && padB > 0, xs: xBreaksR, ys: yBreaksB, canCut: cutR && cutB },
    { cond: padR > 0 && padT > 0, xs: xBreaksR, ys: yBreaksT, canCut: cutR && cutT },
    { cond: padL > 0 && padT > 0, xs: xBreaksL, ys: yBreaksT, canCut: cutL && cutT },
  ];
  for (const cc of cornerConfigs) {
    if (!cc.cond) continue;
    for (let i = 0; i < cc.xs.length - 1; i++) {
      for (let j = 0; j < cc.ys.length - 1; j++) {
        if (cc.canCut && i === 1 && j === 1) {
          emitCutoutPocket(tc, cc.xs[1], cc.xs[2], cc.ys[1], cc.ys[2], zCutBot, zTop, solidBottom);
        } else {
          emitTopAndOptionalBottomQuad(tc, cc.xs[i], cc.xs[i + 1], cc.ys[j], cc.ys[j + 1], zTop, solidBottom);
        }
      }
    }
  }

  // Outer perimeter X/Y break lists matching every corner and rim segment
  const gridRimBreaks = (segs) => {
    const pts = [0];
    for (const s of segs) pts.push(s.ribA, s.ribB, s.b);
    return pts;
  };
  const xsBotRim = cutB ? gridRimBreaks(xSegs) : xsGrid;
  const xsTopRim = cutT ? gridRimBreaks(xSegs) : xsGrid;
  const ysLeftRim = cutL ? gridRimBreaks(ySegs) : ysGrid;
  const ysRightRim = cutR ? gridRimBreaks(ySegs) : ysGrid;

  const perimBotXs = [
    ...(padL > 0 ? xBreaksL.slice(0, -1) : []),
    ...xsBotRim,
    ...(padR > 0 ? xBreaksR.slice(1) : []),
  ];
  const perimTopXs = [
    ...(padL > 0 ? xBreaksL.slice(0, -1) : []),
    ...xsTopRim,
    ...(padR > 0 ? xBreaksR.slice(1) : []),
  ];
  const perimRightYs = [
    ...(padB > 0 ? yBreaksB.slice(0, -1) : []),
    ...ysRightRim,
    ...(padT > 0 ? yBreaksT.slice(1) : []),
  ];
  const perimLeftYs = [
    ...(padB > 0 ? yBreaksB.slice(0, -1) : []),
    ...ysLeftRim,
    ...(padT > 0 ? yBreaksT.slice(1) : []),
  ];

  // Outer vertical walls
  for (let i = 0; i < perimBotXs.length - 1; i++) {
    tc.quad([perimBotXs[i], yMin, 0], [perimBotXs[i + 1], yMin, 0], [perimBotXs[i + 1], yMin, zTop], [perimBotXs[i], yMin, zTop]);
  }
  for (let j = 0; j < perimRightYs.length - 1; j++) {
    tc.quad([xMax, perimRightYs[j], 0], [xMax, perimRightYs[j + 1], 0], [xMax, perimRightYs[j + 1], zTop], [xMax, perimRightYs[j], zTop]);
  }
  for (let i = perimTopXs.length - 1; i > 0; i--) {
    tc.quad([perimTopXs[i], yMax, 0], [perimTopXs[i - 1], yMax, 0], [perimTopXs[i - 1], yMax, zTop], [perimTopXs[i], yMax, zTop]);
  }
  for (let j = perimLeftYs.length - 1; j > 0; j--) {
    tc.quad([xMin, perimLeftYs[j], 0], [xMin, perimLeftYs[j - 1], 0], [xMin, perimLeftYs[j - 1], zTop], [xMin, perimLeftYs[j], zTop]);
  }

  if (solidBottom) {
    const center = [(xMin + xMax) / 2, (yMin + yMax) / 2, 0];
    for (let i = 0; i < perimBotXs.length - 1; i++) {
      tc.tri(center, [perimBotXs[i + 1], yMin, 0], [perimBotXs[i], yMin, 0]);
    }
    for (let j = 0; j < perimRightYs.length - 1; j++) {
      tc.tri(center, [xMax, perimRightYs[j + 1], 0], [xMax, perimRightYs[j], 0]);
    }
    for (let i = perimTopXs.length - 1; i > 0; i--) {
      tc.tri(center, [perimTopXs[i - 1], yMax, 0], [perimTopXs[i], yMax, 0]);
    }
    for (let j = perimLeftYs.length - 1; j > 0; j--) {
      tc.tri(center, [xMin, perimLeftYs[j - 1], 0], [xMin, perimLeftYs[j], 0]);
    }
  }
}

/**
 * Standard Solid (4.65 mm) Gridfinity baseplate mesh.
 */
function buildStandardMesh(tc, spec, floorH, rimStyle) {
  const { nx, ny, padL = 0, padR = 0, padB = 0, padT = 0 } = spec;
  const z0 = floorH;
  const z1 = floorH + STD_H_BOTTOM;
  const z2 = floorH + STD_H_BOTTOM + STD_H_VERT;
  const z3 = floorH + STANDARD_SOCKET_HEIGHT;

  const xsGrid = buildGridBreaks(nx);
  const ysGrid = buildGridBreaks(ny);

  for (let iy = 0; iy < ny; iy++) {
    const yA = iy * GRIDFINITY_PITCH;
    const yB = yA + 4;
    const yC = yA + 38;
    const yD = yA + 42;
    const cy = yA + 21;

    for (let ix = 0; ix < nx; ix++) {
      const xA = ix * GRIDFINITY_PITCH;
      const xB = xA + 4;
      const xC = xA + 38;
      const xD = xA + 42;
      const cx = xA + 21;

      const ring0 = buildCellRing(cx, cy, 1.15, z0);
      const ring1 = buildCellRing(cx, cy, 1.85, z1);
      const ring2 = buildCellRing(cx, cy, 1.85, z2);
      const ring3 = buildCellRing(cx, cy, 4.0, z3);

      const rings = [ring0, ring1, ring2, ring3];
      for (let m = 0; m < 3; m++) {
        const low = rings[m];
        const high = rings[m + 1];
        for (let k = 0; k < 36; k++) {
          const kNext = (k + 1) % 36;
          tc.quad(low[k], high[k], high[kNext], low[kNext]);
        }
      }

      // Top corner spandrels
      const topCorners = [
        { v: [xD, yA, z3], start: 0 },
        { v: [xD, yD, z3], start: 9 },
        { v: [xA, yD, z3], start: 18 },
        { v: [xA, yA, z3], start: 27 },
      ];
      for (const c of topCorners) {
        for (let s = 0; s < ARC_SEGMENTS; s++) {
          tc.tri(c.v, ring3[c.start + s + 1], ring3[c.start + s]);
        }
      }

      if (floorH === 0) {
        const vBR = [xD, yA, 0];
        const vTR = [xD, yD, 0];
        const vTL = [xA, yD, 0];
        const vBL = [xA, yA, 0];

        for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vBR, ring0[s], ring0[s + 1]);
        tc.tri([xC, yA, 0], ring0[0], vBR);
        tc.tri(vBR, ring0[8], [xD, yB, 0]);

        for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vTR, ring0[9 + s], ring0[9 + s + 1]);
        tc.tri([xD, yC, 0], ring0[9], vTR);
        tc.tri(vTR, ring0[17], [xC, yD, 0]);

        for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vTL, ring0[18 + s], ring0[18 + s + 1]);
        tc.tri([xB, yD, 0], ring0[18], vTL);
        tc.tri(vTL, ring0[26], [xA, yC, 0]);

        for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vBL, ring0[27 + s], ring0[27 + s + 1]);
        tc.tri([xA, yB, 0], ring0[27], vBL);
        tc.tri(vBL, ring0[35], [xB, yA, 0]);

        tc.quad([xB, yA, 0], ring0[35], ring0[0], [xC, yA, 0]);
        tc.quad([xD, yB, 0], ring0[8], ring0[9], [xD, yC, 0]);
        tc.quad([xC, yD, 0], ring0[17], ring0[18], [xB, yD, 0]);
        tc.quad([xA, yC, 0], ring0[26], ring0[27], [xA, yB, 0]);
      } else {
        const center = [cx, cy, z0];
        for (let k = 0; k < 36; k++) {
          tc.tri(center, ring0[k], ring0[(k + 1) % 36]);
        }
      }
    }
  }

  addBorderRimsAndWalls(tc, {
    nx,
    ny,
    padL,
    padR,
    padB,
    padT,
    zTop: z3,
    floorH,
    rimStyle,
    xsGrid,
    ysGrid,
  });
  return z3;
}

/**
 * Fast Lightweight (4.25 mm) Gridfinity baseplate mesh.
 * Matches reference 3MF: flat bottom at z=0, vertical 2.50 mm socket wall,
 * 45 deg upper bevel to z=4.25 with 0.40 mm blunted top lip (0.80 mm across dividers),
 * and self-supporting 45 deg hollow underside channels under interior dividers.
 */
function buildFastLightweightMesh(tc, spec, rimStyle) {
  const { nx, ny, padL = 0, padR = 0, padB = 0, padT = 0 } = spec;
  const zTop = FAST_SOCKET_HEIGHT; // 4.25 mm
  const xsGrid = buildGridBreaks(nx);
  const ysGrid = buildGridBreaks(ny);

  // Build each cell's socket wall, top lip, and bottom frame
  for (let iy = 0; iy < ny; iy++) {
    const yA = iy * GRIDFINITY_PITCH;
    const yB = yA + 4;
    const yC = yA + 38;
    const yD = yA + 42;
    const cy = yA + 21;

    for (let ix = 0; ix < nx; ix++) {
      const xA = ix * GRIDFINITY_PITCH;
      const xB = xA + 4;
      const xC = xA + 38;
      const xD = xA + 42;
      const cx = xA + 21;

      const ring0 = buildCellRing(cx, cy, 1.85, 0);
      const ring1 = buildCellRing(cx, cy, 1.85, FAST_H_VERT);
      const ring2 = buildCellRing(cx, cy, 3.6, zTop); // 4.00 - 0.40 = 3.60

      // Socket vertical + 45 deg bevel walls
      const rings = [ring0, ring1, ring2];
      for (let m = 0; m < 2; m++) {
        const low = rings[m];
        const high = rings[m + 1];
        for (let k = 0; k < 36; k++) {
          const kNext = (k + 1) % 36;
          tc.quad(low[k], high[k], high[kNext], low[kNext]);
        }
      }

      // Top face (z = zTop): 0.40 mm flat lip on straight edges + corner spandrels
      const vBRt = [xD, yA, zTop];
      const vTRt = [xD, yD, zTop];
      const vTLt = [xA, yD, zTop];
      const vBLt = [xA, yA, zTop];

      // Bottom-Right corner (0..8)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vBRt, ring2[s + 1], ring2[s]);
      tc.tri([xC, yA, zTop], vBRt, ring2[0]);
      tc.tri(vBRt, [xD, yB, zTop], ring2[8]);
      // Top-Right corner (9..17)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vTRt, ring2[9 + s + 1], ring2[9 + s]);
      tc.tri([xD, yC, zTop], vTRt, ring2[9]);
      tc.tri(vTRt, [xC, yD, zTop], ring2[17]);
      // Top-Left corner (18..26)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vTLt, ring2[18 + s + 1], ring2[18 + s]);
      tc.tri([xB, yD, zTop], vTLt, ring2[18]);
      tc.tri(vTLt, [xA, yC, zTop], ring2[26]);
      // Bottom-Left corner (27..35)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vBLt, ring2[27 + s + 1], ring2[27 + s]);
      tc.tri([xA, yB, zTop], vBLt, ring2[27]);
      tc.tri(vBLt, [xB, yA, zTop], ring2[35]);

      // 4 straight 0.40 mm top lip quads (+Z normal)
      tc.quad([xB, yA, zTop], [xC, yA, zTop], ring2[0], ring2[35]);
      tc.quad([xD, yB, zTop], [xD, yC, zTop], ring2[9], ring2[8]);
      tc.quad([xC, yD, zTop], [xB, yD, zTop], ring2[18], ring2[17]);
      tc.quad([xA, yC, zTop], [xA, yB, zTop], ring2[27], ring2[26]);

      // Bottom face (z = 0, -Z normal):
      // Corners always go to cell boundary; straight segments stay solid unless shared interior divider
      const vBRb = [xD, yA, 0];
      const vTRb = [xD, yD, 0];
      const vTLb = [xA, yD, 0];
      const vBLb = [xA, yA, 0];

      const hasBottomNeighbor = iy > 0;
      const hasRightNeighbor = ix < nx - 1;
      const hasTopNeighbor = iy < ny - 1;
      const hasLeftNeighbor = ix > 0;

      // Corner 0 (Bottom-Right)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vBRb, ring0[s], ring0[s + 1]);
      if (hasBottomNeighbor) {
        const yG = yA + FAST_GROOVE_HALF;
        tc.tri([xC, yA, 0], [xC, yG, 0], vBRb);
        tc.tri([xC, yG, 0], ring0[0], vBRb);
      } else {
        tc.tri([xC, yA, 0], ring0[0], vBRb);
      }
      if (hasRightNeighbor) {
        const xG = xD - FAST_GROOVE_HALF;
        tc.tri(vBRb, ring0[8], [xG, yB, 0]);
        tc.tri(vBRb, [xG, yB, 0], [xD, yB, 0]);
      } else {
        tc.tri(vBRb, ring0[8], [xD, yB, 0]);
      }

      // Corner 1 (Top-Right)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vTRb, ring0[9 + s], ring0[9 + s + 1]);
      if (hasRightNeighbor) {
        const xG = xD - FAST_GROOVE_HALF;
        tc.tri([xD, yC, 0], [xG, yC, 0], vTRb);
        tc.tri([xG, yC, 0], ring0[9], vTRb);
      } else {
        tc.tri([xD, yC, 0], ring0[9], vTRb);
      }
      if (hasTopNeighbor) {
        const yG = yD - FAST_GROOVE_HALF;
        tc.tri(vTRb, ring0[17], [xC, yG, 0]);
        tc.tri(vTRb, [xC, yG, 0], [xC, yD, 0]);
      } else {
        tc.tri(vTRb, ring0[17], [xC, yD, 0]);
      }

      // Corner 2 (Top-Left)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vTLb, ring0[18 + s], ring0[18 + s + 1]);
      if (hasTopNeighbor) {
        const yG = yD - FAST_GROOVE_HALF;
        tc.tri([xB, yD, 0], [xB, yG, 0], vTLb);
        tc.tri([xB, yG, 0], ring0[18], vTLb);
      } else {
        tc.tri([xB, yD, 0], ring0[18], vTLb);
      }
      if (hasLeftNeighbor) {
        const xG = xA + FAST_GROOVE_HALF;
        tc.tri(vTLb, ring0[26], [xG, yC, 0]);
        tc.tri(vTLb, [xG, yC, 0], [xA, yC, 0]);
      } else {
        tc.tri(vTLb, ring0[26], [xA, yC, 0]);
      }

      // Corner 3 (Bottom-Left)
      for (let s = 0; s < ARC_SEGMENTS; s++) tc.tri(vBLb, ring0[27 + s], ring0[27 + s + 1]);
      if (hasLeftNeighbor) {
        const xG = xA + FAST_GROOVE_HALF;
        tc.tri([xA, yB, 0], [xG, yB, 0], vBLb);
        tc.tri([xG, yB, 0], ring0[27], vBLb);
      } else {
        tc.tri([xA, yB, 0], ring0[27], vBLb);
      }
      if (hasBottomNeighbor) {
        const yG = yA + FAST_GROOVE_HALF;
        tc.tri(vBLb, ring0[35], [xB, yG, 0]);
        tc.tri(vBLb, [xB, yG, 0], [xB, yA, 0]);
      } else {
        tc.tri(vBLb, ring0[35], [xB, yA, 0]);
      }

      // Straight bottom edges: if shared with an adjacent cell, stop at groove edge (1.33 mm from divider);
      // if outer edge, emit full foot strip to cell boundary.
      if (hasBottomNeighbor) {
        const yGroove = yA + FAST_GROOVE_HALF;
        tc.quad([xB, yGroove, 0], ring0[35], ring0[0], [xC, yGroove, 0]);
      } else {
        tc.quad([xB, yA, 0], ring0[35], ring0[0], [xC, yA, 0]);
      }

      if (hasRightNeighbor) {
        const xGroove = xD - FAST_GROOVE_HALF;
        tc.quad([xGroove, yB, 0], ring0[8], ring0[9], [xGroove, yC, 0]);
      } else {
        tc.quad([xD, yB, 0], ring0[8], ring0[9], [xD, yC, 0]);
      }

      if (hasTopNeighbor) {
        const yGroove = yD - FAST_GROOVE_HALF;
        tc.quad([xC, yGroove, 0], ring0[17], ring0[18], [xB, yGroove, 0]);
      } else {
        tc.quad([xC, yD, 0], ring0[17], ring0[18], [xB, yD, 0]);
      }

      if (hasLeftNeighbor) {
        const xGroove = xA + FAST_GROOVE_HALF;
        tc.quad([xGroove, yC, 0], ring0[26], ring0[27], [xGroove, yB, 0]);
      } else {
        tc.quad([xA, yC, 0], ring0[26], ring0[27], [xA, yB, 0]);
      }
    }
  }

  // Hollow 45 deg gable channels under interior vertical dividers (between ix and ix+1)
  for (let ix = 1; ix < nx; ix++) {
    const xDiv = ix * GRIDFINITY_PITCH;
    const xL = xDiv - FAST_GROOVE_HALF;
    const xR = xDiv + FAST_GROOVE_HALF;
    for (let iy = 0; iy < ny; iy++) {
      const ya = iy * GRIDFINITY_PITCH + 4;
      const yb = iy * GRIDFINITY_PITCH + 38;
      // Left inner channel wall (+X normal)
      tc.quad([xL, ya, 0], [xL, yb, 0], [xL, yb, FAST_GROOVE_WALL_H], [xL, ya, FAST_GROOVE_WALL_H]);
      // Left 45 deg gable slope
      tc.quad([xL, ya, FAST_GROOVE_WALL_H], [xL, yb, FAST_GROOVE_WALL_H], [xDiv, yb, FAST_GROOVE_PEAK_H], [xDiv, ya, FAST_GROOVE_PEAK_H]);
      // Right 45 deg gable slope
      tc.quad([xDiv, ya, FAST_GROOVE_PEAK_H], [xDiv, yb, FAST_GROOVE_PEAK_H], [xR, yb, FAST_GROOVE_WALL_H], [xR, ya, FAST_GROOVE_WALL_H]);
      // Right inner channel wall (-X normal)
      tc.quad([xR, ya, FAST_GROOVE_WALL_H], [xR, yb, FAST_GROOVE_WALL_H], [xR, yb, 0], [xR, ya, 0]);

      // Start end-cap at y = ya (-Y normal), split at xDiv to match adjacent corner edges
      tc.tri([xL, ya, 0], [xL, ya, FAST_GROOVE_WALL_H], [xDiv, ya, 0]);
      tc.tri([xDiv, ya, 0], [xL, ya, FAST_GROOVE_WALL_H], [xDiv, ya, FAST_GROOVE_PEAK_H]);
      tc.tri([xDiv, ya, 0], [xDiv, ya, FAST_GROOVE_PEAK_H], [xR, ya, FAST_GROOVE_WALL_H]);
      tc.tri([xDiv, ya, 0], [xR, ya, FAST_GROOVE_WALL_H], [xR, ya, 0]);

      // End end-cap at y = yb (+Y normal), split at xDiv to match adjacent corner edges
      tc.tri([xR, yb, 0], [xR, yb, FAST_GROOVE_WALL_H], [xDiv, yb, 0]);
      tc.tri([xDiv, yb, 0], [xR, yb, FAST_GROOVE_WALL_H], [xDiv, yb, FAST_GROOVE_PEAK_H]);
      tc.tri([xDiv, yb, 0], [xDiv, yb, FAST_GROOVE_PEAK_H], [xL, yb, FAST_GROOVE_WALL_H]);
      tc.tri([xDiv, yb, 0], [xL, yb, FAST_GROOVE_WALL_H], [xL, yb, 0]);
    }
  }

  // Hollow 45 deg gable channels under interior horizontal dividers (between iy and iy+1)
  for (let iy = 1; iy < ny; iy++) {
    const yDiv = iy * GRIDFINITY_PITCH;
    const yB = yDiv - FAST_GROOVE_HALF;
    const yT = yDiv + FAST_GROOVE_HALF;
    for (let ix = 0; ix < nx; ix++) {
      const xa = ix * GRIDFINITY_PITCH + 4;
      const xb = ix * GRIDFINITY_PITCH + 38;
      // Bottom inner channel wall (+Y normal)
      tc.quad([xb, yB, 0], [xa, yB, 0], [xa, yB, FAST_GROOVE_WALL_H], [xb, yB, FAST_GROOVE_WALL_H]);
      // Bottom 45 deg gable slope
      tc.quad([xb, yB, FAST_GROOVE_WALL_H], [xa, yB, FAST_GROOVE_WALL_H], [xa, yDiv, FAST_GROOVE_PEAK_H], [xb, yDiv, FAST_GROOVE_PEAK_H]);
      // Top 45 deg gable slope
      tc.quad([xb, yDiv, FAST_GROOVE_PEAK_H], [xa, yDiv, FAST_GROOVE_PEAK_H], [xa, yT, FAST_GROOVE_WALL_H], [xb, yT, FAST_GROOVE_WALL_H]);
      // Top inner channel wall (-Y normal)
      tc.quad([xb, yT, FAST_GROOVE_WALL_H], [xa, yT, FAST_GROOVE_WALL_H], [xa, yT, 0], [xb, yT, 0]);

      // Left end-cap at x = xa (-X normal), split at yDiv
      tc.tri([xa, yT, 0], [xa, yT, FAST_GROOVE_WALL_H], [xa, yDiv, 0]);
      tc.tri([xa, yDiv, 0], [xa, yT, FAST_GROOVE_WALL_H], [xa, yDiv, FAST_GROOVE_PEAK_H]);
      tc.tri([xa, yDiv, 0], [xa, yDiv, FAST_GROOVE_PEAK_H], [xa, yB, FAST_GROOVE_WALL_H]);
      tc.tri([xa, yDiv, 0], [xa, yB, FAST_GROOVE_WALL_H], [xa, yB, 0]);

      // Right end-cap at x = xb (+X normal), split at yDiv
      tc.tri([xb, yB, 0], [xb, yB, FAST_GROOVE_WALL_H], [xb, yDiv, 0]);
      tc.tri([xb, yDiv, 0], [xb, yB, FAST_GROOVE_WALL_H], [xb, yDiv, FAST_GROOVE_PEAK_H]);
      tc.tri([xb, yDiv, 0], [xb, yDiv, FAST_GROOVE_PEAK_H], [xb, yT, FAST_GROOVE_WALL_H]);
      tc.tri([xb, yDiv, 0], [xb, yT, FAST_GROOVE_WALL_H], [xb, yT, 0]);
    }
  }

  addBorderRimsAndWalls(tc, {
    nx,
    ny,
    padL,
    padR,
    padB,
    padT,
    zTop,
    floorH: 0,
    rimStyle,
    xsGrid,
    ysGrid,
  });
  return zTop;
}

/**
 * Generate a 100% watertight, 2-manifold triangle mesh for a Gridfinity baseplate tile.
 * Coordinates are centered in XY around (0, 0) with Z starting at 0.
 * @param {object} spec { nx, ny, padL, padR, padB, padT }
 * @param {object} options { style: 'fast' | 'solid', floorThicknessMm: number, rimStyle: 'grid' | 'solid' }
 */
export function generateTileMesh(spec, options = {}) {
  const opts = typeof options === 'number' ? { style: 'solid', floorThicknessMm: options } : options;
  const style = opts.style || 'fast';
  const floorH = Math.max(0, opts.floorThicknessMm || 0);
  const rimStyle = opts.rimStyle || 'grid';

  const tc = new TriangleCollector();
  const heightMm =
    style === 'fast'
      ? buildFastLightweightMesh(tc, spec, rimStyle)
      : buildStandardMesh(tc, spec, floorH, rimStyle);

  const gridW = spec.nx * GRIDFINITY_PITCH;
  const gridD = spec.ny * GRIDFINITY_PITCH;
  const xMin = -(spec.padL || 0);
  const xMax = gridW + (spec.padR || 0);
  const yMin = -(spec.padB || 0);
  const yMax = gridD + (spec.padT || 0);

  const offsetX = -(xMin + xMax) / 2;
  const offsetY = -(yMin + yMax) / 2;
  const { positions, normals, triCount } = tc.toBuffers();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += offsetX;
    positions[i + 1] += offsetY;
  }

  return {
    positions,
    normals,
    triCount,
    widthMm: xMax - xMin,
    depthMm: yMax - yMin,
    heightMm,
  };
}

/**
 * Encode a mesh (from generateTileMesh) as a standard Binary STL Uint8Array.
 */
export function encodeBinaryStl(mesh, headerText = 'Gridfinity Drawer Generator') {
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
