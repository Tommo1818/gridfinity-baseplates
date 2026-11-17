export const GRIDFINITY_PITCH = 42;
export const HALF_PITCH = 21;
export const TAB_PROTRUSION_MM = 1.05;

function sumArr(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

/**
 * Exact DP partition of `cellSizes` (each 42 or 21 mm) into the fewest contiguous segments
 * such that segment i has physical span:
 *   sum(seg) + (i === 0 ? padStart : 0) + (i === k - 1 ? padEnd : tabOverhang) <= maxSpanMm
 *
 * Optimizes for:
 *  1. Minimum piece count (k)
 *  2. Smallest imbalance (maxCells - minCells) and avoiding 1-cell strips
 *  3. Palindromic symmetry when pads & cell sizes are symmetric
 */
export function solveArrayPartition(cellSizes, padStart, padEnd, maxSpanMm, tabOverhang = 0) {
  const n = cellSizes.length;
  if (n <= 0) return [];

  const totalGrid = sumArr(cellSizes);
  if (totalGrid + padStart + padEnd <= maxSpanMm + 1e-6) {
    return [cellSizes.slice()];
  }

  // Exact DP over prefix 0..n
  const dp = new Array(n + 1).fill(null);
  dp[0] = { count: 0, minCells: Infinity, maxCells: 0, segs: [] };

  for (let i = 1; i <= n; i++) {
    let best = null;
    for (let j = 0; j < i; j++) {
      if (!dp[j]) continue;
      const seg = cellSizes.slice(j, i);
      const segLen = sumArr(seg);
      const leftExtra = j === 0 ? padStart : 0;
      const rightExtra = i === n ? padEnd : tabOverhang;
      if (segLen + leftExtra + rightExtra > maxSpanMm + 1e-6) continue;

      const count = dp[j].count + 1;
      const minCells = Math.min(dp[j].minCells, seg.length);
      const maxCells = Math.max(dp[j].maxCells, seg.length);
      const spread = maxCells - minCells;

      // Also track sum of squared cell counts to favor balanced splits (e.g. [3,3,3] over [4,4,1])
      const prevSegs = dp[j].segs;
      const cand = {
        count,
        minCells,
        maxCells,
        spread,
        sqSum: prevSegs.reduce((a, s) => a + s.length * s.length, 0) + seg.length * seg.length,
        segs: [...prevSegs, seg],
      };

      if (
        !best ||
        cand.count < best.count ||
        (cand.count === best.count && cand.spread < best.spread) ||
        (cand.count === best.count && cand.spread === best.spread && cand.sqSum < best.sqSum)
      ) {
        best = cand;
      }
    }
    dp[i] = best;
  }

  if (!dp[n]) return null;

  const segs = dp[n].segs;
  // If pads and cell sizes are uniform (all 42s) and padStart === padEnd,
  // arrange counts palindromically (e.g. [4, 4, 3] -> [4, 3, 4]) when valid
  const allEqual = cellSizes.every((v) => v === cellSizes[0]);
  if (allEqual && Math.abs(padStart - padEnd) < 1e-4 && segs.length >= 3) {
    const counts = segs.map((s) => s.length).sort((a, b) => b - a);
    const pal = new Array(counts.length);
    let lo = 0;
    let hi = counts.length - 1;
    let idx = 0;
    while (lo <= hi) {
      if (lo === hi) {
        pal[lo] = counts[idx++];
      } else {
        pal[lo] = counts[idx++];
        pal[hi] = counts[idx++];
      }
      lo++;
      hi--;
    }
    const maxFirst = Math.floor((maxSpanMm - padStart - (segs.length > 1 ? tabOverhang : 0) + 1e-6) / cellSizes[0]);
    const maxLast = Math.floor((maxSpanMm - padEnd + 1e-6) / cellSizes[0]);
    if (pal[0] <= maxFirst && pal[pal.length - 1] <= maxLast) {
      return pal.map((c) => new Array(c).fill(cellSizes[0]));
    }
  }

  return segs;
}

/**
 * Legacy helper for numeric uniform splits.
 */
export function solve1DPartition(totalUnits, padStart, padEnd, maxSpanMm) {
  const res = solveArrayPartition(new Array(totalUnits).fill(GRIDFINITY_PITCH), padStart, padEnd, maxSpanMm);
  return res ? res.map((s) => s.length) : null;
}

/**
 * Rotate a tile descriptor by `turns` * 90 deg CCW.
 */
export function rotateTileSpec(spec, turns) {
  const t = ((turns % 4) + 4) % 4;
  let {
    colWidths,
    rowDepths,
    padL,
    padR,
    padB,
    padT,
    rBL = 0,
    rBR = 0,
    rTR = 0,
    rTL = 0,
    connL = 0,
    connR = 0,
    connB = 0,
    connT = 0,
  } = spec;

  for (let i = 0; i < t; i++) {
    // 90 deg CCW: (x, y) -> (-y, x)
    // New colWidths = reversed old rowDepths; New rowDepths = old colWidths
    const nextCols = [...rowDepths].reverse();
    const nextRows = [...colWidths];
    colWidths = nextCols;
    rowDepths = nextRows;

    [padL, padR, padB, padT] = [padT, padB, padL, padR];
    [connL, connR, connB, connT] = [connT, connB, connL, connR];
    // Corners CCW: BL -> BR -> TR -> TL -> BL
    // Old BR -> New BL? Wait: (x, y) -> (-y, x):
    // Old BL (x=0,y=0) -> (0,0)? After shifting to positive box:
    // Old Right (x=max) -> New Top (y=max); Old Bottom (y=0) -> New Right (x=max)
    // So Old BR -> New TR; Old TR -> New TL; Old TL -> New BL; Old BL -> New BR
    [rBL, rBR, rTR, rTL] = [rTL, rBL, rBR, rTR];
  }

  return {
    nx: colWidths.length,
    ny: rowDepths.length,
    colWidths,
    rowDepths,
    padL,
    padR,
    padB,
    padT,
    rBL,
    rBR,
    rTR,
    rTL,
    connL,
    connR,
    connB,
    connT,
  };
}

function roundRim(v) {
  return Math.round(v * 100) / 100;
}

function tileKey(spec) {
  const cw = spec.colWidths.join(',');
  const rd = spec.rowDepths.join(',');
  return [
    cw,
    rd,
    roundRim(spec.padL),
    roundRim(spec.padR),
    roundRim(spec.padB),
    roundRim(spec.padT),
    roundRim(spec.rBL || 0),
    roundRim(spec.rBR || 0),
    roundRim(spec.rTR || 0),
    roundRim(spec.rTL || 0),
    spec.connL || 0,
    spec.connR || 0,
    spec.connB || 0,
    spec.connT || 0,
  ].join('|');
}

function tilePhysicalSize(spec) {
  const gridW = sumArr(spec.colWidths);
  const gridD = sumArr(spec.rowDepths);
  const w =
    gridW +
    spec.padL +
    spec.padR +
    (spec.connL === 'tab' ? TAB_PROTRUSION_MM : 0) +
    (spec.connR === 'tab' ? TAB_PROTRUSION_MM : 0);
  const d =
    gridD +
    spec.padB +
    spec.padT +
    (spec.connB === 'tab' ? TAB_PROTRUSION_MM : 0) +
    (spec.connT === 'tab' ? TAB_PROTRUSION_MM : 0);
  return { w: roundRim(w), d: roundRim(d), gridW, gridD };
}

function canonicalizeForBed(spec, bedX, bedY) {
  const candidates = [];
  for (let turns = 0; turns < 4; turns++) {
    const rot = rotateTileSpec(spec, turns);
    const { w, d } = tilePhysicalSize(rot);
    const fitsBed = w <= bedX + 1e-6 && d <= bedY + 1e-6;
    candidates.push({ rot, turns, w, d, fitsBed, key: tileKey(rot) });
  }
  const fitting = candidates.filter((c) => c.fitsBed);
  const pool = fitting.length > 0 ? fitting : candidates;
  pool.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const best = pool[0];
  const placeRotationCCW = (4 - best.turns) % 4;
  return {
    canonical: best.rot,
    key: best.key,
    printWidthMm: best.w,
    printDepthMm: best.d,
    placeRotationCCW,
  };
}

function cornerFitsRoundedRect(mX, mY, radius) {
  if (radius <= 0.05) return true;
  if (mX <= 1e-6 && mY <= 1e-6) {
    return radius <= 4 + 1e-6;
  }
  const dx = Math.max(0, radius - mX);
  const dy = Math.max(0, radius - mY);
  return Math.hypot(dx, dy) <= radius + 1e-6;
}

function gridFitsRoundedEnvelope({ effW, effD, gridW, gridD, alignX, alignY, cornerRadiusMm }) {
  if (cornerRadiusMm <= 0.05) return true;
  const remX = Math.max(0, effW - gridW);
  const remY = Math.max(0, effD - gridD);

  const mL = alignX === 'left' ? 0 : alignX === 'right' ? remX : remX / 2;
  const mR = alignX === 'left' ? remX : alignX === 'right' ? 0 : remX / 2;
  const mB = alignY === 'front' ? 0 : alignY === 'back' ? remY : remY / 2;
  const mT = alignY === 'front' ? remY : alignY === 'back' ? 0 : remY / 2;

  return (
    cornerFitsRoundedRect(mL, mB, cornerRadiusMm) &&
    cornerFitsRoundedRect(mR, mB, cornerRadiusMm) &&
    cornerFitsRoundedRect(mR, mT, cornerRadiusMm) &&
    cornerFitsRoundedRect(mL, mT, cornerRadiusMm)
  );
}

function findBestGridForRoundedSpace({ effW, effD, maxCols, maxRows, marginFill, alignX, alignY, cornerRadiusMm }) {
  if (cornerRadiusMm <= 0.05) {
    const remX0 = Math.max(0, effW - maxCols * GRIDFINITY_PITCH);
    const remY0 = Math.max(0, effD - maxRows * GRIDFINITY_PITCH);
    return {
      cols: maxCols,
      rows: maxRows,
      hasHalfX: marginFill === 'half' && remX0 >= HALF_PITCH - 1e-6,
      hasHalfY: marginFill === 'half' && remY0 >= HALF_PITCH - 1e-6,
    };
  }

  let best = null;
  const halfCombos =
    marginFill === 'half'
      ? [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]
      : [[0, 0]];

  for (let c = maxCols; c >= 1; c--) {
    for (let r = maxRows; r >= 1; r--) {
      for (const [hx, hy] of halfCombos) {
        const gridW = c * GRIDFINITY_PITCH + hx * HALF_PITCH;
        const gridD = r * GRIDFINITY_PITCH + hy * HALF_PITCH;
        if (gridW > effW + 1e-6 || gridD > effD + 1e-6) continue;
        if (!gridFitsRoundedEnvelope({ effW, effD, gridW, gridD, alignX, alignY, cornerRadiusMm })) {
          continue;
        }
        const fullCells = c * r;
        const area = gridW * gridD;
        const aspectDiff = Math.abs(c - r);
        if (
          !best ||
          fullCells > best.fullCells ||
          (fullCells === best.fullCells && area > best.area + 1e-4) ||
          (fullCells === best.fullCells && Math.abs(area - best.area) <= 1e-4 && aspectDiff < best.aspectDiff)
        ) {
          best = { cols: c, rows: r, hasHalfX: hx === 1, hasHalfY: hy === 1, fullCells, area, aspectDiff };
        }
      }
    }
  }
  return best;
}

function outerCornerRadiusForTile(requestedR, padX, padY) {
  if (requestedR <= 0.05) return 0;
  if (padX <= 1e-6 && padY <= 1e-6) {
    return roundRim(Math.min(requestedR, 4));
  }
  return roundRim(requestedR);
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
  marginFill = 'grid', // 'grid' | 'solid' | 'half' | 'none'
  fillMargins, // legacy boolean fallback
  alignX = 'center', // 'left' | 'center' | 'right'
  alignY = 'center', // 'back' | 'center' | 'front'
  marginAlignment, // legacy fallback
  floorThicknessMm = 0,
  cornerRadiusMm = 0,
  interlocking = false,
}) {
  const effectiveMarginFill =
    typeof fillMargins === 'boolean' ? (fillMargins ? 'solid' : 'none') : marginFill;
  const hasMargins = effectiveMarginFill !== 'none';
  let effAlignX = marginAlignment === 'corner' ? 'left' : alignX;
  let effAlignY = marginAlignment === 'corner' ? 'front' : alignY;
  const effW = Math.max(0, drawerWidthMm - clearanceMm);
  const effD = Math.max(0, drawerDepthMm - clearanceMm);

  const maxCols = Math.floor((effW + 1e-6) / GRIDFINITY_PITCH);
  const maxRows = Math.floor((effD + 1e-6) / GRIDFINITY_PITCH);

  if (maxCols < 1 || maxRows < 1) {
    return {
      ok: false,
      error: `Drawer interior (${roundRim(effW)} × ${roundRim(effD)} mm after ${clearanceMm} mm clearance) is smaller than one 42 × 42 mm Gridfinity cell.`,
      cols: maxCols,
      rows: maxRows,
    };
  }

  const effCornerR = cornerRadiusMm > 0 ? roundRim(Math.min(cornerRadiusMm, effW / 2, effD / 2)) : 0;

  // With rounded drawer corners, edge-aligned grids center on the perpendicular axis so corners don't interfere
  if (effCornerR > 0.05 && effAlignX !== 'center' && effAlignY !== 'center') {
    effAlignX = 'center';
  }

  const fit = findBestGridForRoundedSpace({
    effW,
    effD,
    maxCols,
    maxRows,
    marginFill: effectiveMarginFill,
    alignX: effAlignX,
    alignY: effAlignY,
    cornerRadiusMm: effCornerR,
  });

  if (!fit) {
    return {
      ok: false,
      error: `No Gridfinity grid fits inside ${roundRim(effW)} × ${roundRim(effD)} mm with a ${effCornerR} mm corner radius${effAlignX !== 'center' || effAlignY !== 'center' ? ' and edge alignment' : ''}. Reduce the corner radius or switch alignment to Center.`,
      cols: 0,
      rows: 0,
    };
  }

  const { cols, rows, hasHalfX, hasHalfY } = fit;
  const remX = Math.max(0, effW - cols * GRIDFINITY_PITCH - (hasHalfX ? HALF_PITCH : 0));
  const remY = Math.max(0, effD - rows * GRIDFINITY_PITCH - (hasHalfY ? HALF_PITCH : 0));

  const allColWidths = new Array(cols).fill(GRIDFINITY_PITCH);
  if (hasHalfX) {
    if (effAlignX === 'right') allColWidths.unshift(HALF_PITCH);
    else allColWidths.push(HALF_PITCH);
  }

  const allRowDepths = new Array(rows).fill(GRIDFINITY_PITCH);
  if (hasHalfY) {
    if (effAlignY === 'back') allRowDepths.unshift(HALF_PITCH);
    else allRowDepths.push(HALF_PITCH);
  }

  const gridWidthMm = roundRim(sumArr(allColWidths));
  const gridDepthMm = roundRim(sumArr(allRowDepths));
  const leftoverX = roundRim(remX);
  const leftoverY = roundRim(remY);

  let padL = 0;
  let padR = 0;
  let padB = 0;
  let padT = 0;

  const halfClear = clearanceMm / 2;
  let assemblyX = halfClear;
  let assemblyY = halfClear;

  if (hasMargins) {
    if (effAlignX === 'left') {
      padL = 0;
      padR = leftoverX;
    } else if (effAlignX === 'right') {
      padL = leftoverX;
      padR = 0;
    } else {
      padL = roundRim(leftoverX / 2);
      padR = roundRim(leftoverX - padL);
    }

    if (effAlignY === 'front') {
      padB = 0;
      padT = leftoverY;
    } else if (effAlignY === 'back') {
      padB = leftoverY;
      padT = 0;
    } else {
      padB = roundRim(leftoverY / 2);
      padT = roundRim(leftoverY - padB);
    }
  } else {
    if (effAlignX === 'right') assemblyX = roundRim(halfClear + leftoverX);
    else if (effAlignX === 'center') assemblyX = roundRim(halfClear + leftoverX / 2);
    if (effAlignY === 'back') assemblyY = roundRim(halfClear + leftoverY);
    else if (effAlignY === 'center') assemblyY = roundRim(halfClear + leftoverY / 2);
  }

  const mL = hasMargins ? padL : roundRim(assemblyX - halfClear);
  const mR = hasMargins ? padR : roundRim(leftoverX - mL);
  const mB = hasMargins ? padB : roundRim(assemblyY - halfClear);
  const mT = hasMargins ? padT : roundRim(leftoverY - mB);

  const outerRBL = hasMargins
    ? outerCornerRadiusForTile(effCornerR, padL, padB)
    : mL <= 1e-6 && mB <= 1e-6
      ? outerCornerRadiusForTile(effCornerR, 0, 0)
      : 0;
  const outerRBR = hasMargins
    ? outerCornerRadiusForTile(effCornerR, padR, padB)
    : mR <= 1e-6 && mB <= 1e-6
      ? outerCornerRadiusForTile(effCornerR, 0, 0)
      : 0;
  const outerRTR = hasMargins
    ? outerCornerRadiusForTile(effCornerR, padR, padT)
    : mR <= 1e-6 && mT <= 1e-6
      ? outerCornerRadiusForTile(effCornerR, 0, 0)
      : 0;
  const outerRTL = hasMargins
    ? outerCornerRadiusForTile(effCornerR, padL, padT)
    : mL <= 1e-6 && mT <= 1e-6
      ? outerCornerRadiusForTile(effCornerR, 0, 0)
      : 0;

  const tabOverhang = interlocking ? TAB_PROTRUSION_MM : 0;
  const bedOrientations = [
    [bedWidthMm, bedDepthMm],
    ...(Math.abs(bedWidthMm - bedDepthMm) > 1e-6 ? [[bedDepthMm, bedWidthMm]] : []),
  ];

  let bestPlan = null;

  for (const [maxSpanX, maxSpanY] of bedOrientations) {
    const colSplits = solveArrayPartition(allColWidths, padL, padR, maxSpanX, tabOverhang);
    const rowSplits = solveArrayPartition(allRowDepths, padB, padT, maxSpanY, tabOverhang);
    if (!colSplits || !rowSplits) continue;

    const tiles = [];
    const modelMap = new Map();

    let offsetY = 0;
    let gridY = 0;
    for (let r = 0; r < rowSplits.length; r++) {
      const rowDepths = rowSplits[r];
      const tPadB = r === 0 ? padB : 0;
      const tPadT = r === rowSplits.length - 1 ? padT : 0;
      const connB = interlocking && r > 0 ? 'slot' : 0;
      const connT = interlocking && r < rowSplits.length - 1 ? 'tab' : 0;
      const tileGridD = sumArr(rowDepths);
      let offsetX = 0;
      let gridX = 0;

      for (let c = 0; c < colSplits.length; c++) {
        const colWidths = colSplits[c];
        const tPadL = c === 0 ? padL : 0;
        const tPadR = c === colSplits.length - 1 ? padR : 0;
        const connL = interlocking && c > 0 ? 'slot' : 0;
        const connR = interlocking && c < colSplits.length - 1 ? 'tab' : 0;
        const tileGridW = sumArr(colWidths);

        const spec = {
          nx: colWidths.length,
          ny: rowDepths.length,
          colWidths,
          rowDepths,
          padL: tPadL,
          padR: tPadR,
          padB: tPadB,
          padT: tPadT,
          rBL: r === 0 && c === 0 ? outerRBL : 0,
          rBR: r === 0 && c === colSplits.length - 1 ? outerRBR : 0,
          rTR: r === rowSplits.length - 1 && c === colSplits.length - 1 ? outerRTR : 0,
          rTL: r === rowSplits.length - 1 && c === 0 ? outerRTL : 0,
          connL,
          connR,
          connB,
          connT,
        };

        // Nominal footprint in drawer (without tab overhang which tucks into neighbor slot)
        const widthMm = roundRim(tileGridW + tPadL + tPadR);
        const depthMm = roundRim(tileGridD + tPadB + tPadT);

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
        gridX += colWidths.length;
      }
      offsetY += tileGridD + tPadB + tPadT;
      gridY += rowDepths.length;
    }

    const totalTiles = tiles.length;
    const uniqueCount = modelMap.size;
    const minDim = Math.min(
      ...colSplits.map((s) => s.length),
      ...rowSplits.map((s) => s.length)
    );
    const score = [totalTiles, uniqueCount, -minDim];

    if (
      !bestPlan ||
      score[0] < bestPlan.score[0] ||
      (score[0] === bestPlan.score[0] && score[1] < bestPlan.score[1]) ||
      (score[0] === bestPlan.score[0] && score[1] === bestPlan.score[1] && score[2] < bestPlan.score[2])
    ) {
      bestPlan = {
        score,
        colSplits: colSplits.map((s) => s.length),
        rowSplits: rowSplits.map((s) => s.length),
        tiles,
        modelMap,
      };
    }
  }

  if (!bestPlan) {
    return {
      ok: false,
      error: `A single Gridfinity cell with border rim (${roundRim(GRIDFINITY_PITCH + Math.max(padL, padR) + tabOverhang)} × ${roundRim(GRIDFINITY_PITCH + Math.max(padB, padT) + tabOverhang)} mm) exceeds the selected printer bed (${bedWidthMm} × ${bedDepthMm} mm). Increase bed size or turn off border rim / connectors.`,
      cols,
      rows,
    };
  }

  const models = Array.from(bestPlan.modelMap.values());
  models.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const areaA = sumArr(a.spec.colWidths) * sumArr(a.spec.rowDepths);
    const areaB = sumArr(b.spec.colWidths) * sumArr(b.spec.rowDepths);
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
    cornerRadiusMm,
    interlocking,
    hasHalfX,
    hasHalfY,
    allColWidths,
    allRowDepths,
    floorThicknessMm,
    cols,
    rows,
    totalCells: allColWidths.length * allRowDepths.length,
    gridWidthMm,
    gridDepthMm,
    totalWidthMm,
    totalDepthMm,
    leftoverX,
    leftoverY,
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
