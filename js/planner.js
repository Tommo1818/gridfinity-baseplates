export const GRIDFINITY_PITCH = 42;

/**
 * Solve an optimal 1D partition of `totalUnits` grid cells into printable segments
 * where segment i has cell count c_i >= 1 and physical length:
 *   c_i * 42 + (i === 0 ? padStart : 0) + (i === k - 1 ? padEnd : 0) <= maxSpanMm
 *
 * Optimizes for:
 *  1. Minimum number of segments
 *  2. Largest minimum cell count (avoids flimsy 1-wide strips when e.g. [3,3,3] beats [4,4,1])
 *  3. Most balanced segment sizes (smallest max - min)
 */
export function solve1DPartition(totalUnits, padStart, padEnd, maxSpanMm) {
  if (totalUnits <= 0) return [];

  // Check if a single piece fits
  if (totalUnits * GRIDFINITY_PITCH + padStart + padEnd <= maxSpanMm + 1e-6) {
    return [totalUnits];
  }

  const maxMiddle = Math.floor((maxSpanMm + 1e-6) / GRIDFINITY_PITCH);
  const maxFirst = Math.floor((maxSpanMm - padStart + 1e-6) / GRIDFINITY_PITCH);
  const maxLast = Math.floor((maxSpanMm - padEnd + 1e-6) / GRIDFINITY_PITCH);

  if (maxMiddle < 1 || maxFirst < 1 || maxLast < 1) {
    return null;
  }

  // BFS/DP to find minimum piece count, then pick best balanced split of length k
  // Since totalUnits is typically <= 40, enumerate valid k starting from lower bound
  const minK = Math.max(2, Math.ceil((totalUnits * GRIDFINITY_PITCH + padStart + padEnd) / maxSpanMm));

  for (let k = minK; k <= totalUnits; k++) {
    // Upper bounds per position 0..k-1
    const caps = new Array(k).fill(maxMiddle);
    caps[0] = maxFirst;
    caps[k - 1] = maxLast;

    const totalCap = caps.reduce((a, b) => a + b, 0);
    if (totalCap < totalUnits) continue;

    // Distribute totalUnits evenly across k slots respecting caps[i]
    // Water-filling / balanced distribution maximizes min(c_i) and minimizes max(c_i) - min(c_i)
    const counts = new Array(k).fill(1);
    let remaining = totalUnits - k;
    if (remaining < 0) continue;

    // Iteratively add 1 to slots that haven't hit cap, prioritizing smallest counts first
    // and preserving left-right symmetry (palindromic splits) when possible.
    while (remaining > 0) {
      let minVal = Infinity;
      const eligible = [];
      for (let i = 0; i < k; i++) {
        if (counts[i] < caps[i]) {
          if (counts[i] < minVal) {
            minVal = counts[i];
            eligible.length = 0;
            eligible.push(i);
          } else if (counts[i] === minVal) {
            eligible.push(i);
          }
        }
      }
      if (eligible.length === 0) break;

      if (remaining >= eligible.length) {
        for (const i of eligible) {
          counts[i]++;
          remaining--;
        }
      } else {
        const eligibleSet = new Set(eligible);
        // If odd remainder and center slot is eligible, give 1 to center first
        if (remaining % 2 === 1 && k % 2 === 1) {
          const mid = (k - 1) / 2;
          if (eligibleSet.has(mid)) {
            counts[mid]++;
            remaining--;
            eligibleSet.delete(mid);
          }
        }
        // Assign remaining in symmetric outer-in pairs
        for (let i = 0; i < Math.floor(k / 2) && remaining >= 2; i++) {
          const j = k - 1 - i;
          if (eligibleSet.has(i) && eligibleSet.has(j)) {
            counts[i]++;
            counts[j]++;
            remaining -= 2;
            eligibleSet.delete(i);
            eligibleSet.delete(j);
          }
        }
        // Any remaining slots sequentially
        for (const i of eligible) {
          if (remaining === 0) break;
          if (eligibleSet.has(i)) {
            counts[i]++;
            remaining--;
          }
        }
      }
    }

    if (remaining === 0) {
      return counts;
    }
  }

  return null;
}

/**
 * Rotate a tile descriptor (nx, ny, padL, padR, padB, padT) by `turns` * 90 deg CCW.
 */
export function rotateTileSpec(spec, turns) {
  const t = ((turns % 4) + 4) % 4;
  let { nx, ny, padL, padR, padB, padT } = spec;
  for (let i = 0; i < t; i++) {
    // 90 deg CCW: (x, y) -> (-y, x)
    // Old Bottom -> New Right? Let's trace:
    // Old Left (x=0) -> New Bottom (y=0)
    // Old Bottom (y=0) -> New Right (x=max)
    // Old Right (x=max) -> New Top (y=max)
    // Old Top (y=max) -> New Left (x=0)
    [nx, ny, padL, padR, padB, padT] = [ny, nx, padT, padB, padL, padR];
  }
  return { nx, ny, padL, padR, padB, padT };
}

function roundRim(v) {
  return Math.round(v * 100) / 100;
}

function tileKey(spec) {
  return `${spec.nx}x${spec.ny}_${roundRim(spec.padL)}_${roundRim(spec.padR)}_${roundRim(spec.padB)}_${roundRim(spec.padT)}`;
}

/**
 * Canonicalize a tile up to 90-degree rotations in XY, choosing an orientation
 * that fits on the printer bed (bedX x bedY).
 */
function canonicalizeForBed(spec, bedX, bedY) {
  const candidates = [];
  for (let turns = 0; turns < 4; turns++) {
    const rot = rotateTileSpec(spec, turns);
    const w = rot.nx * GRIDFINITY_PITCH + rot.padL + rot.padR;
    const d = rot.ny * GRIDFINITY_PITCH + rot.padB + rot.padT;
    const fitsBed = w <= bedX + 1e-6 && d <= bedY + 1e-6;
    candidates.push({ rot, turns, w, d, fitsBed, key: tileKey(rot) });
  }
  // Prefer orientations that fit the bed, then lexicographically smallest key
  const fitting = candidates.filter((c) => c.fitsBed);
  const pool = fitting.length > 0 ? fitting : candidates;
  pool.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const best = pool[0];
  // `placeRotationDeg` is how many degrees CCW to rotate the canonical STL
  // to get back to the drawer's `spec` orientation: (360 - best.turns * 90) % 360
  const placeRotationCCW = (4 - best.turns) % 4;
  return {
    canonical: best.rot,
    key: best.key,
    printWidthMm: roundRim(best.w),
    printDepthMm: roundRim(best.d),
    placeRotationCCW,
  };
}

/**
 * Plan the optimal set of Gridfinity baseplate tiles to fill a drawer.
 */
export function planDrawerLayout({
  drawerWidthMm,
  drawerDepthMm,
  bedWidthMm,
  bedDepthMm,
  clearanceMm = 1,
  marginFill = 'grid', // 'grid' | 'solid' | 'none'
  fillMargins, // legacy boolean fallback
  alignX = 'center', // 'left' | 'center' | 'right'
  alignY = 'center', // 'back' | 'center' | 'front'
  marginAlignment, // legacy fallback
  floorThicknessMm = 0,
}) {
  const effectiveMarginFill =
    typeof fillMargins === 'boolean' ? (fillMargins ? 'solid' : 'none') : marginFill;
  const hasMargins = effectiveMarginFill !== 'none';
  const effAlignX = marginAlignment === 'corner' ? 'left' : alignX;
  const effAlignY = marginAlignment === 'corner' ? 'front' : alignY;
  const effW = Math.max(0, drawerWidthMm - clearanceMm);
  const effD = Math.max(0, drawerDepthMm - clearanceMm);

  const cols = Math.floor((effW + 1e-6) / GRIDFINITY_PITCH);
  const rows = Math.floor((effD + 1e-6) / GRIDFINITY_PITCH);

  if (cols < 1 || rows < 1) {
    return {
      ok: false,
      error: `Drawer interior (${roundRim(effW)} × ${roundRim(effD)} mm after ${clearanceMm} mm clearance) is smaller than one 42 × 42 mm Gridfinity cell.`,
      cols,
      rows,
    };
  }

  const gridWidthMm = cols * GRIDFINITY_PITCH;
  const gridDepthMm = rows * GRIDFINITY_PITCH;
  const leftoverX = Math.max(0, effW - gridWidthMm);
  const leftoverY = Math.max(0, effD - gridDepthMm);

  let padL = 0;
  let padR = 0;
  let padB = 0;
  let padT = 0;

  // Position of the assembled tiles' bottom-left corner inside the drawer interior [0..drawerWidthMm, 0..drawerDepthMm]
  const halfClear = clearanceMm / 2;
  let assemblyX = halfClear;
  let assemblyY = halfClear;

  if (hasMargins) {
    if (effAlignX === 'left') {
      padL = 0;
      padR = roundRim(leftoverX);
    } else if (effAlignX === 'right') {
      padL = roundRim(leftoverX);
      padR = 0;
    } else {
      padL = roundRim(leftoverX / 2);
      padR = roundRim(leftoverX - padL);
    }

    // Y=0 is Front of drawer (bottom of 2D/3D view), Y=max is Back of drawer (top of 2D/3D view)
    if (effAlignY === 'front') {
      padB = 0;
      padT = roundRim(leftoverY);
    } else if (effAlignY === 'back') {
      padB = roundRim(leftoverY);
      padT = 0;
    } else {
      padB = roundRim(leftoverY / 2);
      padT = roundRim(leftoverY - padB);
    }
  } else {
    // No border rim: shift the pure Gridfinity tiles inside the drawer box according to alignX / alignY
    if (effAlignX === 'right') {
      assemblyX = roundRim(halfClear + leftoverX);
    } else if (effAlignX === 'center') {
      assemblyX = roundRim(halfClear + leftoverX / 2);
    }
    if (effAlignY === 'back') {
      assemblyY = roundRim(halfClear + leftoverY);
    } else if (effAlignY === 'center') {
      assemblyY = roundRim(halfClear + leftoverY / 2);
    }
  }

  // Try both bed axis assignments: (maxX=bedWidth, maxY=bedDepth) and (maxX=bedDepth, maxY=bedWidth)
  const bedOrientations = [
    [bedWidthMm, bedDepthMm],
    ...(Math.abs(bedWidthMm - bedDepthMm) > 1e-6 ? [[bedDepthMm, bedWidthMm]] : []),
  ];

  let bestPlan = null;

  for (const [maxSpanX, maxSpanY] of bedOrientations) {
    const colSplits = solve1DPartition(cols, padL, padR, maxSpanX);
    const rowSplits = solve1DPartition(rows, padB, padT, maxSpanY);
    if (!colSplits || !rowSplits) continue;

    const tiles = [];
    const modelMap = new Map();

    let offsetY = 0;
    let gridY = 0;
    for (let r = 0; r < rowSplits.length; r++) {
      const ny = rowSplits[r];
      const tPadB = r === 0 ? padB : 0;
      const tPadT = r === rowSplits.length - 1 ? padT : 0;
      let offsetX = 0;
      let gridX = 0;

      for (let c = 0; c < colSplits.length; c++) {
        const nx = colSplits[c];
        const tPadL = c === 0 ? padL : 0;
        const tPadR = c === colSplits.length - 1 ? padR : 0;

        const spec = {
          nx,
          ny,
          padL: tPadL,
          padR: tPadR,
          padB: tPadB,
          padT: tPadT,
        };

        const widthMm = roundRim(nx * GRIDFINITY_PITCH + tPadL + tPadR);
        const depthMm = roundRim(ny * GRIDFINITY_PITCH + tPadB + tPadT);

        const canon = canonicalizeForBed(spec, bedWidthMm, bedDepthMm);

        if (!modelMap.has(canon.key)) {
          modelMap.set(canon.key, {
            key: canon.key,
            spec: canon.canonical,
            printWidthMm: canon.printWidthMm,
            printDepthMm: canon.printDepthMm,
            floorThicknessMm,
            count: 0,
            tileIds: [],
          });
        }
        const model = modelMap.get(canon.key);
        model.count++;

        const tileId = `R${r + 1}C${c + 1}`;
        model.tileIds.push(tileId);

        tiles.push({
          id: tileId,
          row: r,
          col: c,
          gridX,
          gridY,
          xMm: roundRim(offsetX),
          yMm: roundRim(offsetY),
          widthMm,
          depthMm,
          spec,
          modelKey: canon.key,
          placeRotationCCW: canon.placeRotationCCW,
        });

        offsetX += widthMm;
        gridX += nx;
      }
      offsetY += ny * GRIDFINITY_PITCH + tPadB + tPadT;
      gridY += ny;
    }

    const totalTiles = tiles.length;
    const uniqueCount = modelMap.size;
    const minDim = Math.min(...colSplits, ...rowSplits);
    const score = [totalTiles, uniqueCount, -minDim];

    if (
      !bestPlan ||
      score[0] < bestPlan.score[0] ||
      (score[0] === bestPlan.score[0] && score[1] < bestPlan.score[1]) ||
      (score[0] === bestPlan.score[0] && score[1] === bestPlan.score[1] && score[2] < bestPlan.score[2])
    ) {
      bestPlan = {
        score,
        colSplits,
        rowSplits,
        tiles,
        modelMap,
      };
    }
  }

  if (!bestPlan) {
    return {
      ok: false,
      error: `A single Gridfinity cell with border rim (${roundRim(GRIDFINITY_PITCH + Math.max(padL, padR))} × ${roundRim(GRIDFINITY_PITCH + Math.max(padB, padT))} mm) exceeds the selected printer bed (${bedWidthMm} × ${bedDepthMm} mm). Increase bed size or turn off border rim.`,
      cols,
      rows,
    };
  }

  // Assign friendly model labels A, B, C... sorted by count desc then area desc
  const models = Array.from(bestPlan.modelMap.values());
  models.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const areaA = a.spec.nx * a.spec.ny;
    const areaB = b.spec.nx * b.spec.ny;
    return areaB - areaA;
  });

  const labelFor = (idx) => {
    let s = '';
    let n = idx;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };

  const keyToModel = new Map();
  models.forEach((m, idx) => {
    m.index = idx;
    m.label = labelFor(idx);
    keyToModel.set(m.key, m);
  });

  for (const tile of bestPlan.tiles) {
    const m = keyToModel.get(tile.modelKey);
    tile.modelIndex = m.index;
    tile.modelLabel = m.label;
  }

  const totalWidthMm = roundRim(gridWidthMm + padL + padR);
  const totalDepthMm = roundRim(gridDepthMm + padB + padT);

  return {
    ok: true,
    drawerWidthMm,
    drawerDepthMm,
    clearanceMm,
    effWidthMm: roundRim(effW),
    effDepthMm: roundRim(effD),
    bedWidthMm,
    bedDepthMm,
    marginFill: effectiveMarginFill,
    fillMargins: hasMargins,
    alignX: effAlignX,
    alignY: effAlignY,
    assemblyX,
    assemblyY,
    floorThicknessMm,
    cols,
    rows,
    totalCells: cols * rows,
    gridWidthMm,
    gridDepthMm,
    totalWidthMm,
    totalDepthMm,
    leftoverX: roundRim(leftoverX),
    leftoverY: roundRim(leftoverY),
    padL,
    padR,
    padB,
    padT,
    colSplits: bestPlan.colSplits,
    rowSplits: bestPlan.rowSplits,
    tiles: bestPlan.tiles,
    models,
  };
}
