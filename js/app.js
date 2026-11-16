import { BAMBU_PRESETS, getPresetById } from './printers.js';
import { GRIDFINITY_PITCH, planDrawerLayout } from './planner.js';
import {
  generateTileMesh,
  encodeBinaryStl,
  RIM_OUTER_WALL,
  RIM_INNER_COLLAR,
  RIM_RIB_THICKNESS,
  MIN_GRID_RIM_PAD,
} from './mesh.js';
import { createZipBlob } from './zip.js';
import { Viewer3D } from './viewer3d.js';

const TILE_COLORS = [
  '#22c55e', // green
  '#38bdf8', // sky
  '#f59e0b', // amber
  '#a78bfa', // violet
  '#fb7185', // rose
  '#2dd4bf', // teal
  '#facc15', // yellow
  '#818cf8', // indigo
  '#fb923c', // orange
  '#e879f9', // fuchsia
];

const UNIT_FACTORS = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

const state = {
  unit: 'mm',
  drawerWidthMm: 400,
  drawerDepthMm: 350,
  clearanceMm: 1,
  marginFill: 'grid', // 'grid' | 'solid' | 'none'
  alignX: 'center', // 'left' | 'center' | 'right'
  alignY: 'center', // 'back' | 'center' | 'front'
  presetId: 'a1-mini',
  bedWidthMm: 180,
  bedDepthMm: 180,
  meshStyle: 'fast', // 'fast' | 'solid' | 'solid-floor'
  viewMode: '2d', // '2d' | '3d-drawer' | '3d-bed'
  selectedModelIndex: 0,
  plan: null,
  modelMeshes: new Map(),
};

// DOM elements
const els = {
  drawerWidth: document.getElementById('drawerWidth'),
  drawerDepth: document.getElementById('drawerDepth'),
  clearanceInput: document.getElementById('clearanceInput'),
  rimHint: document.getElementById('rimHint'),
  printerPreset: document.getElementById('printerPreset'),
  printerNote: document.getElementById('printerNote'),
  bedBadge: document.getElementById('bedBadge'),
  customBedRow: document.getElementById('customBedRow'),
  bedWidth: document.getElementById('bedWidth'),
  bedDepth: document.getElementById('bedDepth'),
  errorBanner: document.getElementById('errorBanner'),
  kpiStrip: document.getElementById('kpiStrip'),
  kpiGrid: document.getElementById('kpiGrid'),
  kpiCells: document.getElementById('kpiCells'),
  kpiTiles: document.getElementById('kpiTiles'),
  kpiUnique: document.getElementById('kpiUnique'),
  kpiSize: document.getElementById('kpiSize'),
  kpiRims: document.getElementById('kpiRims'),
  kpiBed: document.getElementById('kpiBed'),
  kpiMaxTile: document.getElementById('kpiMaxTile'),
  layoutSvg: document.getElementById('layoutSvg'),
  view2dWrap: document.getElementById('view2dWrap'),
  view3dWrap: document.getElementById('view3dWrap'),
  glCanvas: document.getElementById('glCanvas'),
  glCaption: document.getElementById('glCaption'),
  cameraControls: document.getElementById('cameraControls'),
  modelsList: document.getElementById('modelsList'),
  downloadAllBtn: document.getElementById('downloadAllBtn'),
  downloadAllSecondary: document.getElementById('downloadAllSecondary'),
};

const viewer = new Viewer3D(els.glCanvas);

function formatUnitVal(mm, unit) {
  const v = mm / UNIT_FACTORS[unit];
  if (unit === 'mm') return String(Math.round(v * 10) / 10);
  if (unit === 'cm') return String(Math.round(v * 100) / 100);
  return String(Math.round(v * 1000) / 1000);
}

function getMeshOptions() {
  const rimStyle = state.marginFill === 'solid' ? 'solid' : 'grid';
  if (state.meshStyle === 'fast') {
    return { style: 'fast', floorThicknessMm: 0, rimStyle };
  }
  if (state.meshStyle === 'solid-floor') {
    return { style: 'solid', floorThicknessMm: 1.2, rimStyle };
  }
  return { style: 'solid', floorThicknessMm: 0, rimStyle };
}

function initPresets() {
  els.printerPreset.innerHTML = '';
  for (const preset of BAMBU_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent =
      preset.id === 'custom'
        ? preset.name
        : `${preset.name} (${preset.bedX} × ${preset.bedY} mm)`;
    els.printerPreset.appendChild(opt);
  }
  els.printerPreset.value = state.presetId;
  syncPresetUI();
}

function syncPresetUI() {
  const preset = getPresetById(state.presetId);
  const isCustom = preset.id === 'custom';
  els.customBedRow.classList.toggle('hidden', !isCustom);
  if (!isCustom) {
    state.bedWidthMm = preset.bedX;
    state.bedDepthMm = preset.bedY;
    els.bedWidth.value = preset.bedX;
    els.bedDepth.value = preset.bedY;
  }
  els.printerNote.textContent = preset.note;
  els.bedBadge.textContent = `${state.bedWidthMm} × ${state.bedDepthMm} mm`;
}

function recomputeAndRender(resetCamera = false) {
  const meshOpts = getMeshOptions();
  const plan = planDrawerLayout({
    drawerWidthMm: state.drawerWidthMm,
    drawerDepthMm: state.drawerDepthMm,
    bedWidthMm: state.bedWidthMm,
    bedDepthMm: state.bedDepthMm,
    clearanceMm: state.clearanceMm,
    marginFill: state.marginFill,
    alignX: state.alignX,
    alignY: state.alignY,
    floorThicknessMm: meshOpts.floorThicknessMm,
  });

  state.plan = plan;
  state.modelMeshes.clear();

  if (!plan.ok) {
    els.errorBanner.textContent = plan.error;
    els.errorBanner.classList.remove('hidden');
    els.kpiGrid.textContent = '—';
    els.kpiCells.textContent = 'Too small or exceeds bed';
    els.kpiTiles.textContent = '—';
    els.kpiUnique.textContent = '—';
    els.kpiSize.textContent = '—';
    els.kpiRims.textContent = '—';
    els.kpiBed.textContent = `${state.bedWidthMm} × ${state.bedDepthMm} mm`;
    els.kpiMaxTile.textContent = '—';
    els.layoutSvg.innerHTML = '';
    els.modelsList.innerHTML = '';
    els.downloadAllBtn.disabled = true;
    els.downloadAllSecondary.disabled = true;
    viewer.clearScene();
    viewer.render();
    return;
  }

  els.errorBanner.classList.add('hidden');
  els.downloadAllBtn.disabled = false;
  els.downloadAllSecondary.disabled = false;

  if (state.selectedModelIndex >= plan.models.length) {
    state.selectedModelIndex = 0;
  }

  for (const m of plan.models) {
    state.modelMeshes.set(m.key, generateTileMesh(m.spec, meshOpts));
  }

  renderKpis(plan);
  render2DMap(plan);
  renderModelsList(plan);
  update3DView(resetCamera);
}

function renderKpis(plan) {
  els.kpiGrid.textContent = `${plan.cols} × ${plan.rows} units`;
  els.kpiCells.textContent = `${plan.totalCells} cells (${plan.gridWidthMm} × ${plan.gridDepthMm} mm grid)`;

  els.kpiTiles.textContent = `${plan.tiles.length} ${plan.tiles.length === 1 ? 'tile' : 'tiles'}`;
  els.kpiUnique.textContent = `${plan.models.length} unique ${plan.models.length === 1 ? 'STL file' : 'STL files'}`;

  els.kpiSize.textContent = `${plan.totalWidthMm} × ${plan.totalDepthMm} mm`;
  if (plan.fillMargins && (plan.leftoverX > 0.05 || plan.leftoverY > 0.05)) {
    const rimLabel = plan.marginFill === 'grid' ? 'grid rim' : 'solid rim';
    els.kpiRims.textContent = `${rimLabel}: ${plan.padL}/${plan.padR} mm X, ${plan.padB}/${plan.padT} mm Y`;
  } else {
    els.kpiRims.textContent = `Drawer interior: ${Math.round(plan.drawerWidthMm * 10) / 10} × ${Math.round(plan.drawerDepthMm * 10) / 10} mm`;
  }

  els.kpiBed.textContent = `${plan.bedWidthMm} × ${plan.bedDepthMm} mm`;
  const maxW = Math.max(...plan.models.map((m) => m.printWidthMm));
  const maxD = Math.max(...plan.models.map((m) => m.printDepthMm));
  els.kpiMaxTile.textContent = `Largest print: ${maxW} × ${maxD} mm`;
}

function svgEl(tag, attrs = {}, text = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (text) el.textContent = text;
  return el;
}

function render2DMap(plan) {
  const svg = els.layoutSvg;
  svg.innerHTML = '';

  const margin = 44;
  const dw = plan.drawerWidthMm;
  const dd = plan.drawerDepthMm;
  const vbW = dw + margin * 2;
  const vbH = dd + margin * 2;
  svg.setAttribute('viewBox', `${-margin} ${-margin} ${vbW} ${vbH}`);

  // Subtle background grid
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', {
    id: 'bgGrid',
    width: 42,
    height: 42,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.appendChild(
    svgEl('path', {
      d: 'M 42 0 L 0 0 0 42',
      fill: 'none',
      stroke: '#1b2230',
      'stroke-width': Math.max(0.5, dw / 500),
    })
  );
  defs.appendChild(pattern);
  svg.appendChild(defs);

  const strokeScale = Math.max(0.7, Math.max(dw, dd) / 420);

  // Drawer interior rectangle
  svg.appendChild(
    svgEl('rect', {
      x: 0,
      y: 0,
      width: dw,
      height: dd,
      fill: '#0f141d',
      stroke: '#475569',
      'stroke-width': 1.5 * strokeScale,
      'stroke-dasharray': `${5 * strokeScale} ${4 * strokeScale}`,
      rx: 2 * strokeScale,
    })
  );

  // Position assembled tiles inside drawer interior [0..dw, 0..dd]
  const startX = plan.assemblyX ?? (dw - plan.totalWidthMm) / 2;
  const startY = plan.assemblyY ?? (dd - plan.totalDepthMm) / 2;

  for (const tile of plan.tiles) {
    // Note: in SVG Y goes downward; map bottom-up drawer Y to top-down SVG so Row 1 is at bottom or top cleanly.
    // Let's map row 0 (bottom) to bottom of drawer so orientation matches 3D view (+Y = back/top)
    const tx = startX + tile.xMm;
    const ty = dd - startY - tile.yMm - tile.depthMm;
    const color = TILE_COLORS[tile.modelIndex % TILE_COLORS.length];
    const isSelected = tile.modelIndex === state.selectedModelIndex;

    const g = svgEl('g', {
      style: 'cursor: pointer',
      'data-model-index': tile.modelIndex,
    });

    // Tile outer footprint (includes border rim)
    g.appendChild(
      svgEl('rect', {
        x: tx,
        y: ty,
        width: tile.widthMm,
        height: tile.depthMm,
        fill: color,
        'fill-opacity': isSelected ? 0.28 : 0.14,
        stroke: color,
        'stroke-width': (isSelected ? 2.4 : 1.3) * strokeScale,
        rx: 1.5 * strokeScale,
      })
    );

    // Draw individual 42x42 mm Gridfinity pockets inside the tile
    const gridOriginX = tx + tile.spec.padL;
    const gridOriginY = ty + tile.spec.padT;
    for (let cy = 0; cy < tile.spec.ny; cy++) {
      for (let cx = 0; cx < tile.spec.nx; cx++) {
        g.appendChild(
          svgEl('rect', {
            x: gridOriginX + cx * GRIDFINITY_PITCH + 2.15,
            y: gridOriginY + cy * GRIDFINITY_PITCH + 2.15,
            width: GRIDFINITY_PITCH - 4.3,
            height: GRIDFINITY_PITCH - 4.3,
            fill: '#0b0e14',
            'fill-opacity': 0.55,
            stroke: color,
            'stroke-opacity': 0.5,
            'stroke-width': 0.7 * strokeScale,
            rx: 3.5,
          })
        );
      }
    }

    // Draw smaller grid-rim cutouts in 2D map when marginFill === 'grid'
    if (plan.marginFill === 'grid') {
      const drawRimPocket = (px, py, pw, ph) => {
        if (pw <= 0 || ph <= 0) return;
        g.appendChild(
          svgEl('rect', {
            x: px,
            y: py,
            width: pw,
            height: ph,
            fill: '#0b0e14',
            'fill-opacity': 0.55,
            stroke: color,
            'stroke-opacity': 0.45,
            'stroke-width': 0.6 * strokeScale,
            rx: 0.8 * strokeScale,
          })
        );
      };
      const gridW = tile.spec.nx * GRIDFINITY_PITCH;
      const gridD = tile.spec.ny * GRIDFINITY_PITCH;
      const cutL = tile.spec.padL >= MIN_GRID_RIM_PAD;
      const cutR = tile.spec.padR >= MIN_GRID_RIM_PAD;
      const cutT = tile.spec.padT >= MIN_GRID_RIM_PAD; // SVG top corresponds to spec.padT
      const cutB = tile.spec.padB >= MIN_GRID_RIM_PAD; // SVG bottom corresponds to spec.padB

      if (cutL) {
        const px = tx + RIM_OUTER_WALL;
        const pw = tile.spec.padL - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cy = 0; cy < tile.spec.ny; cy++) {
          const ribT = cy === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribB = cy === tile.spec.ny - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          drawRimPocket(px, gridOriginY + cy * GRIDFINITY_PITCH + ribT, pw, GRIDFINITY_PITCH - ribT - ribB);
        }
      }
      if (cutR) {
        const px = gridOriginX + gridW + RIM_INNER_COLLAR;
        const pw = tile.spec.padR - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cy = 0; cy < tile.spec.ny; cy++) {
          const ribT = cy === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribB = cy === tile.spec.ny - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          drawRimPocket(px, gridOriginY + cy * GRIDFINITY_PITCH + ribT, pw, GRIDFINITY_PITCH - ribT - ribB);
        }
      }
      if (cutT) {
        const py = ty + RIM_OUTER_WALL;
        const ph = tile.spec.padT - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cx = 0; cx < tile.spec.nx; cx++) {
          const ribL = cx === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribR = cx === tile.spec.nx - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          drawRimPocket(gridOriginX + cx * GRIDFINITY_PITCH + ribL, py, GRIDFINITY_PITCH - ribL - ribR, ph);
        }
      }
      if (cutB) {
        const py = gridOriginY + gridD + RIM_INNER_COLLAR;
        const ph = tile.spec.padB - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cx = 0; cx < tile.spec.nx; cx++) {
          const ribL = cx === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribR = cx === tile.spec.nx - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          drawRimPocket(gridOriginX + cx * GRIDFINITY_PITCH + ribL, py, GRIDFINITY_PITCH - ribL - ribR, ph);
        }
      }
      if (cutL && cutT) {
        drawRimPocket(
          tx + RIM_OUTER_WALL,
          ty + RIM_OUTER_WALL,
          tile.spec.padL - RIM_OUTER_WALL - RIM_INNER_COLLAR,
          tile.spec.padT - RIM_OUTER_WALL - RIM_INNER_COLLAR
        );
      }
      if (cutR && cutT) {
        drawRimPocket(
          gridOriginX + gridW + RIM_INNER_COLLAR,
          ty + RIM_OUTER_WALL,
          tile.spec.padR - RIM_OUTER_WALL - RIM_INNER_COLLAR,
          tile.spec.padT - RIM_OUTER_WALL - RIM_INNER_COLLAR
        );
      }
      if (cutL && cutB) {
        drawRimPocket(
          tx + RIM_OUTER_WALL,
          gridOriginY + gridD + RIM_INNER_COLLAR,
          tile.spec.padL - RIM_OUTER_WALL - RIM_INNER_COLLAR,
          tile.spec.padB - RIM_OUTER_WALL - RIM_INNER_COLLAR
        );
      }
      if (cutR && cutB) {
        drawRimPocket(
          gridOriginX + gridW + RIM_INNER_COLLAR,
          gridOriginY + gridD + RIM_INNER_COLLAR,
          tile.spec.padR - RIM_OUTER_WALL - RIM_INNER_COLLAR,
          tile.spec.padB - RIM_OUTER_WALL - RIM_INNER_COLLAR
        );
      }
    }

    // Center label
    const centerX = tx + tile.widthMm / 2;
    const centerY = ty + tile.depthMm / 2;
    const fontSize = Math.min(tile.widthMm, tile.depthMm) * 0.19;
    const clampedFont = Math.max(9 * strokeScale, Math.min(18 * strokeScale, fontSize));

    // Pill backing for readability
    const rotDeg = tile.placeRotationCCW * 90;
    const rotSuffix = rotDeg !== 0 ? ` ↻${rotDeg}°` : '';
    const titleText = `Model ${tile.modelLabel}${rotSuffix}`;
    const subText = `${tile.spec.nx}×${tile.spec.ny} · ${tile.widthMm}×${tile.depthMm}`;
    const maxChars = Math.max(titleText.length, subText.length * 0.72);
    const pillW = Math.min(tile.widthMm * 0.92, Math.max(clampedFont * 5.8, clampedFont * maxChars * 0.62));
    const pillH = clampedFont * 2.6;
    g.appendChild(
      svgEl('rect', {
        x: centerX - pillW / 2,
        y: centerY - pillH / 2,
        width: pillW,
        height: pillH,
        rx: 4 * strokeScale,
        fill: '#0b0e14',
        'fill-opacity': 0.88,
        stroke: color,
        'stroke-opacity': 0.65,
        'stroke-width': 0.8 * strokeScale,
      })
    );

    const titleFont = rotSuffix ? clampedFont * 0.9 : clampedFont;
    g.appendChild(
      svgEl(
        'text',
        {
          x: centerX,
          y: centerY - clampedFont * 0.22,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: '#f8fafc',
          'font-size': titleFont,
          'font-weight': '700',
          'font-family': 'Inter, system-ui, sans-serif',
        },
        titleText
      )
    );

    g.appendChild(
      svgEl(
        'text',
        {
          x: centerX,
          y: centerY + clampedFont * 0.76,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: '#9ca3af',
          'font-size': clampedFont * 0.66,
          'font-weight': '600',
          'font-family': 'Inter, system-ui, sans-serif',
        },
        subText
      )
    );

    g.addEventListener('click', () => {
      state.selectedModelIndex = tile.modelIndex;
      render2DMap(plan);
      renderModelsList(plan);
      update3DView(false);
    });

    svg.appendChild(g);
  }

  // Dimension callouts outside the drawer box
  const labelFont = 11 * strokeScale;
  svg.appendChild(
    svgEl(
      'text',
      {
        x: dw / 2,
        y: -14 * strokeScale,
        'text-anchor': 'middle',
        fill: '#cbd5e1',
        'font-size': labelFont,
        'font-weight': '600',
        'font-family': 'Inter, system-ui, sans-serif',
      },
      `Back · Drawer Width: ${Math.round(dw * 10) / 10} mm (${plan.cols} Gridfinity cols)`
    )
  );

  svg.appendChild(
    svgEl(
      'text',
      {
        x: dw / 2,
        y: dd + 18 * strokeScale,
        'text-anchor': 'middle',
        fill: '#94a3b8',
        'font-size': labelFont * 0.9,
        'font-weight': '600',
        'font-family': 'Inter, system-ui, sans-serif',
      },
      'Front of Drawer'
    )
  );

  svg.appendChild(
    svgEl(
      'text',
      {
        x: -16 * strokeScale,
        y: dd / 2,
        'text-anchor': 'middle',
        fill: '#cbd5e1',
        'font-size': labelFont,
        'font-weight': '600',
        'font-family': 'Inter, system-ui, sans-serif',
        transform: `rotate(-90 ${-16 * strokeScale} ${dd / 2})`,
      },
      `Drawer Depth: ${Math.round(dd * 10) / 10} mm (${plan.rows} rows)`
    )
  );
}

function getStlFilename(model) {
  const { nx, ny } = model.spec;
  return `gridfinity_model_${model.label}_${nx}x${ny}_${model.printWidthMm}x${model.printDepthMm}mm_qty${model.count}.stl`;
}

function renderModelsList(plan) {
  els.modelsList.innerHTML = '';

  for (const model of plan.models) {
    const color = TILE_COLORS[model.index % TILE_COLORS.length];
    const mesh = state.modelMeshes.get(model.key);
    const isSelected = model.index === state.selectedModelIndex;

    const placements = plan.tiles
      .filter((t) => t.modelIndex === model.index)
      .map((t) => {
        const rot = t.placeRotationCCW * 90;
        return rot !== 0 ? `${t.id} (↻${rot}°)` : t.id;
      })
      .join(', ');

    const row = document.createElement('div');
    row.className = `model-row${isSelected ? ' selected' : ''}`;

    const main = document.createElement('div');
    main.className = 'model-main';

    const swatch = document.createElement('div');
    swatch.className = 'model-swatch';
    swatch.style.background = color;
    swatch.textContent = model.label;

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'model-title';
    title.innerHTML = `<strong>Model ${model.label}</strong> · ${model.spec.nx} × ${model.spec.ny} grid <span class="qty-pill">Print ×${model.count}</span>`;

    // Check if any tile rotated relative to canonical bed orientation
    const hasRotatedPlacement = plan.tiles.some(
      (t) => t.modelIndex === model.index && t.placeRotationCCW % 2 === 1
    );
    if (hasRotatedPlacement) {
      title.innerHTML += ` <span class="rot-pill">Rotated 90° on bed</span>`;
    }

    const meta = document.createElement('div');
    meta.className = 'model-meta';
    meta.textContent = `Print size: ${model.printWidthMm} × ${model.printDepthMm} × ${mesh.heightMm} mm · Drawer slots: ${placements}`;

    info.appendChild(title);
    info.appendChild(meta);
    main.appendChild(swatch);
    main.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'model-actions';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn btn-outline';
    previewBtn.textContent = 'Preview on Bed';
    previewBtn.addEventListener('click', () => {
      state.selectedModelIndex = model.index;
      setViewMode('3d-bed', true);
      render2DMap(plan);
      renderModelsList(plan);
    });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn btn-primary';
    dlBtn.textContent = 'Download .STL';
    dlBtn.addEventListener('click', () => {
      const stlBytes = encodeBinaryStl(mesh, `Gridfinity Model ${model.label}`);
      triggerDownload(new Blob([stlBytes], { type: 'application/octet-stream' }), getStlFilename(model));
    });

    actions.appendChild(previewBtn);
    actions.appendChild(dlBtn);
    row.appendChild(main);
    row.appendChild(actions);

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      state.selectedModelIndex = model.index;
      render2DMap(plan);
      renderModelsList(plan);
      update3DView(false);
    });

    els.modelsList.appendChild(row);
  }
}

function update3DView(resetCamera = false) {
  const plan = state.plan;
  if (!plan || !plan.ok) return;

  if (!viewer.supported) {
    els.glCaption.textContent = 'WebGL2 is unavailable in this browser. STL downloads still work normally.';
    return;
  }

  if (state.viewMode === '3d-drawer') {
    viewer.resize();
    viewer.setSceneDrawer(plan, state.modelMeshes, TILE_COLORS, state.selectedModelIndex, resetCamera);
    els.glCaption.textContent =
      'Full assembled drawer view · Drag to orbit · Right-drag to pan · Scroll to zoom';
  } else if (state.viewMode === '3d-bed') {
    const model = plan.models[state.selectedModelIndex] || plan.models[0];
    const mesh = state.modelMeshes.get(model.key);
    const color = TILE_COLORS[model.index % TILE_COLORS.length];
    viewer.resize();
    viewer.setSceneSingleBed(
      model,
      mesh,
      plan.bedWidthMm,
      plan.bedDepthMm,
      color,
      resetCamera
    );
    els.glCaption.textContent = `Model ${model.label} (${model.printWidthMm} × ${model.printDepthMm} mm) centered on ${plan.bedWidthMm} × ${plan.bedDepthMm} mm printer bed`;
  }
}

function setViewMode(mode, resetCamera = false) {
  state.viewMode = mode;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  const is3d = mode !== '2d';
  els.view2dWrap.classList.toggle('hidden', is3d);
  els.view3dWrap.classList.toggle('hidden', !is3d);
  els.cameraControls.classList.toggle('hidden', !is3d);

  if (is3d) {
    requestAnimationFrame(() => update3DView(resetCamera));
  }
}

function buildAssemblyGuideText(plan) {
  const lines = [
    'GRIDFINITY DRAWER ASSEMBLY GUIDE',
    '================================',
    `Drawer interior: ${plan.drawerWidthMm} x ${plan.drawerDepthMm} mm (clearance: ${plan.clearanceMm} mm)`,
    `Printer bed:     ${plan.bedWidthMm} x ${plan.bedDepthMm} mm`,
    `Gridfinity grid: ${plan.cols} x ${plan.rows} cells (${plan.totalCells} total cells)`,
    `Assembled size:  ${plan.totalWidthMm} x ${plan.totalDepthMm} mm`,
    '',
    'FILES TO PRINT',
    '--------------',
  ];
  for (const m of plan.models) {
    lines.push(
      `- ${getStlFilename(m)}: Print x${m.count} (${m.spec.nx}x${m.spec.ny} grid, ${m.printWidthMm} x ${m.printDepthMm} mm)`
    );
  }
  lines.push('', 'DRAWER LAYOUT (Bottom-to-Top, Left-to-Right)', '-------------------------------------------');
  for (let r = plan.rowSplits.length - 1; r >= 0; r--) {
    const rowTiles = plan.tiles
      .filter((t) => t.row === r)
      .map((t) => {
        const rot = t.placeRotationCCW * 90;
        return `[${t.id}: Model ${t.modelLabel}${rot ? ` rot ${rot}deg` : ''} (${t.spec.nx}x${t.spec.ny})]`;
      });
    lines.push(`Row ${r + 1}: ` + rowTiles.join('  '));
  }
  return lines.join('\n') + '\n';
}

function downloadAllZip() {
  const plan = state.plan;
  if (!plan || !plan.ok) return;

  const entries = [];
  for (const model of plan.models) {
    const mesh = state.modelMeshes.get(model.key);
    entries.push({
      name: getStlFilename(model),
      data: encodeBinaryStl(mesh, `Gridfinity Model ${model.label}`),
    });
  }
  entries.push({
    name: 'ASSEMBLY_GUIDE.txt',
    data: buildAssemblyGuideText(plan),
  });

  const zipBlob = createZipBlob(entries);
  triggerDownload(zipBlob, `gridfinity_${plan.cols}x${plan.rows}_drawer.zip`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const RIM_HINTS = {
  grid: 'Fills extra space with a smaller open-cell grid border so tiles stay snug while saving filament.',
  solid: 'Fully fills extra space around the outer tiles with a solid flat border rim.',
  none: 'Outputs pure 42 × 42 mm Gridfinity tiles only, leaving any extra drawer margin open.',
};

// Wire events
function bindEvents() {
  // Unit switcher
  document.querySelectorAll('[data-unit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextUnit = btn.dataset.unit;
      if (nextUnit === state.unit) return;
      state.unit = nextUnit;
      document.querySelectorAll('[data-unit]').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.unit-label').forEach((el) => {
        el.textContent = nextUnit;
      });
      els.drawerWidth.value = formatUnitVal(state.drawerWidthMm, nextUnit);
      els.drawerDepth.value = formatUnitVal(state.drawerDepthMm, nextUnit);
      els.clearanceInput.value = formatUnitVal(state.clearanceMm, nextUnit);
    });
  });

  // Leftover space rim mode switcher
  document.querySelectorAll('[data-rim]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextRim = btn.dataset.rim;
      if (nextRim === state.marginFill) return;
      state.marginFill = nextRim;
      document.querySelectorAll('[data-rim]').forEach((b) => b.classList.toggle('active', b === btn));
      els.rimHint.textContent = RIM_HINTS[nextRim];
      recomputeAndRender(true);
    });
  });

  // Grid alignment / weighting (X and Y axes)
  document.querySelectorAll('[data-align-x]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.alignX;
      if (next === state.alignX) return;
      state.alignX = next;
      document.querySelectorAll('[data-align-x]').forEach((b) => b.classList.toggle('active', b === btn));
      recomputeAndRender(true);
    });
  });

  document.querySelectorAll('[data-align-y]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.alignY;
      if (next === state.alignY) return;
      state.alignY = next;
      document.querySelectorAll('[data-align-y]').forEach((b) => b.classList.toggle('active', b === btn));
      recomputeAndRender(true);
    });
  });

  const onDrawerChange = () => {
    const f = UNIT_FACTORS[state.unit];
    const w = parseFloat(els.drawerWidth.value);
    const d = parseFloat(els.drawerDepth.value);
    const c = parseFloat(els.clearanceInput.value);
    if (Number.isFinite(w) && w > 0) state.drawerWidthMm = w * f;
    if (Number.isFinite(d) && d > 0) state.drawerDepthMm = d * f;
    state.clearanceMm = Number.isFinite(c) && c >= 0 ? c * f : 0;
    recomputeAndRender(true);
  };

  els.drawerWidth.addEventListener('input', onDrawerChange);
  els.drawerDepth.addEventListener('input', onDrawerChange);
  els.clearanceInput.addEventListener('input', onDrawerChange);

  els.printerPreset.addEventListener('change', () => {
    state.presetId = els.printerPreset.value;
    syncPresetUI();
    recomputeAndRender(true);
  });

  const onCustomBedChange = () => {
    const bw = parseFloat(els.bedWidth.value);
    const bd = parseFloat(els.bedDepth.value);
    if (Number.isFinite(bw) && bw >= 45) state.bedWidthMm = bw;
    if (Number.isFinite(bd) && bd >= 45) state.bedDepthMm = bd;
    els.bedBadge.textContent = `${state.bedWidthMm} × ${state.bedDepthMm} mm`;
    recomputeAndRender(true);
  };
  els.bedWidth.addEventListener('input', onCustomBedChange);
  els.bedDepth.addEventListener('input', onCustomBedChange);

  document.querySelectorAll('input[name="meshStyle"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        state.meshStyle = radio.value;
        recomputeAndRender(false);
      }
    });
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view, true));
  });

  document.querySelectorAll('[data-cam]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cam = btn.dataset.cam;
      if (cam === 'iso') {
        viewer.yaw = -Math.PI * 0.32;
        viewer.pitch = 0.85;
      } else if (cam === 'top') {
        viewer.yaw = -Math.PI / 2;
        viewer.pitch = 1.54;
      } else if (cam === 'front') {
        viewer.yaw = -Math.PI / 2;
        viewer.pitch = 0.25;
      } else if (cam === 'bottom') {
        viewer.yaw = -Math.PI / 2;
        viewer.pitch = -1.52;
      }
      viewer.render();
    });
  });

  els.downloadAllBtn.addEventListener('click', downloadAllZip);
  els.downloadAllSecondary.addEventListener('click', downloadAllZip);

  window.addEventListener('resize', () => {
    if (state.viewMode !== '2d') viewer.resize();
  });
}

initPresets();
bindEvents();
recomputeAndRender(true);
