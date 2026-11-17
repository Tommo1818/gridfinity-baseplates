import { BAMBU_PRESETS, getPresetById } from './printers.js';
import { IKEA_DRAWERS, getIkeaDrawerById, searchIkeaDrawers } from './ikea_drawers.js';
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
import {
  createBambu3mfBlob,
  createBatchBambu3mfBlob,
  packInstancesOntoPlates,
} from './threemf.js';
import { Viewer3D } from './viewer3d.js';

const STORAGE_KEY = 'simple_gridfinity_state_v1';
const BATCH_STORAGE_KEY = 'simple_gridfinity_batch_v1';

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
  marginFill: 'grid', // 'grid' | 'half' | 'solid' | 'none'
  alignX: 'center', // 'left' | 'center' | 'right'
  alignY: 'center', // 'back' | 'center' | 'front'
  cornerRadiusMm: 0,
  interlocking: false,
  selectedIkeaId: null,
  presetId: 'a1-mini',
  bedWidthMm: 180,
  bedDepthMm: 180,
  nozzle: '0.4', // '0.4' | '0.8'
  packMultiple: true,
  meshStyle: 'fast', // 'fast' | 'solid' | 'solid-floor'
  viewMode: '2d', // '2d' | '3d-drawer' | '3d-bed'
  selectedModelIndex: 0,
  testBinsMode: false,
  activeBinW: 2,
  activeBinD: 2,
  placedBins: [], // [{ col, row, w, d }]
  savedDrawers: [], // [{ id, name, cols, rows, config }]
  plan: null,
  modelMeshes: new Map(),
};

// DOM elements
const els = {
  ikeaPicker: document.getElementById('ikeaPicker'),
  ikeaSearchInput: document.getElementById('ikeaSearchInput'),
  ikeaClearBtn: document.getElementById('ikeaClearBtn'),
  ikeaToggleBtn: document.getElementById('ikeaToggleBtn'),
  ikeaDropdown: document.getElementById('ikeaDropdown'),
  ikeaSelectedBanner: document.getElementById('ikeaSelectedBanner'),
  ikeaPresetCount: document.getElementById('ikeaPresetCount'),
  drawerWidth: document.getElementById('drawerWidth'),
  drawerDepth: document.getElementById('drawerDepth'),
  clearanceInput: document.getElementById('clearanceInput'),
  cornerRadiusInput: document.getElementById('cornerRadiusInput'),
  interlockingCheck: document.getElementById('interlockingCheck'),
  printerPreset: document.getElementById('printerPreset'),
  printerNote: document.getElementById('printerNote'),
  bedBadge: document.getElementById('bedBadge'),
  customBedRow: document.getElementById('customBedRow'),
  bedWidth: document.getElementById('bedWidth'),
  bedDepth: document.getElementById('bedDepth'),
  packPlatesCheck: document.getElementById('packPlatesCheck'),
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
  kpiFilament: document.getElementById('kpiFilament'),
  kpiVolume: document.getElementById('kpiVolume'),
  layoutSvg: document.getElementById('layoutSvg'),
  map2dCaption: document.getElementById('map2dCaption'),
  testBinsToggle: document.getElementById('testBinsToggle'),
  binPalette: document.getElementById('binPalette'),
  rotateBinBtn: document.getElementById('rotateBinBtn'),
  clearBinsBtn: document.getElementById('clearBinsBtn'),
  view2dWrap: document.getElementById('view2dWrap'),
  view3dWrap: document.getElementById('view3dWrap'),
  glCanvas: document.getElementById('glCanvas'),
  glCaption: document.getElementById('glCaption'),
  cameraControls: document.getElementById('cameraControls'),
  modelsList: document.getElementById('modelsList'),
  shareBtn: document.getElementById('shareBtn'),
  saveDrawerBtn: document.getElementById('saveDrawerBtn'),
  batchBar: document.getElementById('batchBar'),
  batchChips: document.getElementById('batchChips'),
  exportBatch3mfBtn: document.getElementById('exportBatch3mfBtn'),
  exportBatchZipBtn: document.getElementById('exportBatchZipBtn'),
  download3mfBtn: document.getElementById('download3mfBtn'),
  download3mfSecondary: document.getElementById('download3mfSecondary'),
  downloadAllBtn: document.getElementById('downloadAllBtn'),
  downloadAllSecondary: document.getElementById('downloadAllSecondary'),
  visitCountValue: document.getElementById('visitCountValue'),
  visitCountLabel: document.getElementById('visitCountLabel'),
  downloadCountValue: document.getElementById('downloadCountValue'),
  downloadCountLabel: document.getElementById('downloadCountLabel'),
};

const viewer = new Viewer3D(els.glCanvas);

function formatUnitVal(mm, unit) {
  const v = mm / UNIT_FACTORS[unit];
  if (unit === 'mm') return String(Math.round(v * 10) / 10);
  if (unit === 'cm') return String(Math.round(v * 100) / 100);
  return String(Math.round(v * 1000) / 1000);
}

function getMeshOptionsFor(marginFill, meshStyle) {
  const rimStyle = marginFill === 'solid' ? 'solid' : 'grid';
  if (meshStyle === 'fast') {
    return { style: 'fast', floorThicknessMm: 0, rimStyle };
  }
  if (meshStyle === 'solid-floor') {
    return { style: 'solid', floorThicknessMm: 1.2, rimStyle };
  }
  return { style: 'solid', floorThicknessMm: 0, rimStyle };
}

function getMeshOptions() {
  return getMeshOptionsFor(state.marginFill, state.meshStyle);
}

function serializeConfig() {
  const cfg = {
    u: state.unit,
    w: state.drawerWidthMm,
    d: state.drawerDepthMm,
    c: state.clearanceMm,
    m: state.marginFill,
    ax: state.alignX,
    ay: state.alignY,
    cr: state.cornerRadiusMm,
    it: state.interlocking ? 1 : 0,
    p: state.presetId,
    bw: state.bedWidthMm,
    bd: state.bedDepthMm,
    n: state.nozzle,
    pk: state.packMultiple ? 1 : 0,
    s: state.meshStyle,
  };
  if (state.selectedIkeaId) cfg.ik = state.selectedIkeaId;
  return cfg;
}

function syncAllInputsFromState() {
  document.querySelectorAll('[data-unit]').forEach((b) => {
    b.classList.toggle('active', b.dataset.unit === state.unit);
  });
  document.querySelectorAll('.unit-label').forEach((el) => {
    el.textContent = state.unit;
  });
  els.drawerWidth.value = formatUnitVal(state.drawerWidthMm, state.unit);
  els.drawerDepth.value = formatUnitVal(state.drawerDepthMm, state.unit);
  els.clearanceInput.value = formatUnitVal(state.clearanceMm, state.unit);
  els.cornerRadiusInput.value = String(state.cornerRadiusMm);
  els.interlockingCheck.checked = state.interlocking;
  els.packPlatesCheck.checked = state.packMultiple;

  document.querySelectorAll('[data-rim]').forEach((b) => {
    b.classList.toggle('active', b.dataset.rim === state.marginFill);
  });
  document.querySelectorAll('[data-align-x]').forEach((b) => {
    b.classList.toggle('active', b.dataset.alignX === state.alignX);
  });
  document.querySelectorAll('[data-align-y]').forEach((b) => {
    b.classList.toggle('active', b.dataset.alignY === state.alignY);
  });
  document.querySelectorAll('[data-nozzle]').forEach((b) => {
    b.classList.toggle('active', b.dataset.nozzle === state.nozzle);
  });

  els.printerPreset.value = state.presetId;
  syncPresetUI();
  if (state.presetId === 'custom') {
    els.bedWidth.value = String(state.bedWidthMm);
    els.bedDepth.value = String(state.bedDepthMm);
    els.bedBadge.textContent = `${state.bedWidthMm} × ${state.bedDepthMm} mm`;
  }

  document.querySelectorAll('input[name="meshStyle"]').forEach((r) => {
    r.checked = r.value === state.meshStyle;
  });

  if (state.cornerRadiusMm > 0 || state.interlocking) {
    const det = document.querySelector('.more-options');
    if (det) det.open = true;
  }

  syncIkeaSelectedBanner();
}

function applyConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  if (['mm', 'cm', 'in'].includes(cfg.u)) state.unit = cfg.u;
  if (Number.isFinite(+cfg.w) && +cfg.w > 0) state.drawerWidthMm = +cfg.w;
  if (Number.isFinite(+cfg.d) && +cfg.d > 0) state.drawerDepthMm = +cfg.d;
  if (Number.isFinite(+cfg.c) && +cfg.c >= 0) state.clearanceMm = +cfg.c;
  if (['grid', 'half', 'solid', 'none'].includes(cfg.m)) state.marginFill = cfg.m;
  if (['left', 'center', 'right'].includes(cfg.ax)) state.alignX = cfg.ax;
  if (['back', 'center', 'front'].includes(cfg.ay)) state.alignY = cfg.ay;
  if (Number.isFinite(+cfg.cr) && +cfg.cr >= 0) state.cornerRadiusMm = Math.min(50, +cfg.cr);
  if (cfg.it !== undefined) state.interlocking = Boolean(+cfg.it);
  state.selectedIkeaId = typeof cfg.ik === 'string' && getIkeaDrawerById(cfg.ik) ? cfg.ik : null;
  if (typeof cfg.p === 'string' && getPresetById(cfg.p)) state.presetId = cfg.p;
  if (Number.isFinite(+cfg.bw) && +cfg.bw >= 45) state.bedWidthMm = +cfg.bw;
  if (Number.isFinite(+cfg.bd) && +cfg.bd >= 45) state.bedDepthMm = +cfg.bd;
  if (['0.4', '0.8'].includes(cfg.n)) state.nozzle = cfg.n;
  if (cfg.pk !== undefined) state.packMultiple = Boolean(+cfg.pk);
  if (['fast', 'solid', 'solid-floor'].includes(cfg.s)) state.meshStyle = cfg.s;
  syncAllInputsFromState();
}

function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(b64) {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const bin = atob(norm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function restoreSavedState() {
  try {
    const rawBatch = localStorage.getItem(BATCH_STORAGE_KEY);
    if (rawBatch) {
      const parsed = JSON.parse(rawBatch);
      if (Array.isArray(parsed)) state.savedDrawers = parsed;
    }
  } catch {
    // ignore storage failures
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const wParam = params.get('w');
    if (wParam) {
      const cfg = JSON.parse(decodeBase64Url(wParam));
      applyConfig(cfg);
      return;
    }
    const rawState = localStorage.getItem(STORAGE_KEY);
    if (rawState) {
      applyConfig(JSON.parse(rawState));
    }
  } catch {
    // ignore malformed URL/localStorage
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeConfig()));
  } catch {
    // ignore
  }
}

function persistBatch() {
  try {
    localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(state.savedDrawers));
  } catch {
    // ignore
  }
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
  els.printerNote.dataset.tip = preset.note;
  els.bedBadge.textContent = `${state.bedWidthMm} × ${state.bedDepthMm} mm`;
}

function buildDrawerPlanAndMeshes(cfg, overrideBed = null) {
  const meshOpts = getMeshOptionsFor(cfg.m, cfg.s);
  const bedW = overrideBed ? overrideBed.bedWidthMm : cfg.bw;
  const bedD = overrideBed ? overrideBed.bedDepthMm : cfg.bd;
  const plan = planDrawerLayout({
    drawerWidthMm: cfg.w,
    drawerDepthMm: cfg.d,
    bedWidthMm: bedW,
    bedDepthMm: bedD,
    clearanceMm: cfg.c,
    marginFill: cfg.m,
    alignX: cfg.ax,
    alignY: cfg.ay,
    floorThicknessMm: meshOpts.floorThicknessMm,
    cornerRadiusMm: cfg.cr || 0,
    interlocking: Boolean(cfg.it),
  });
  const modelMeshes = new Map();
  if (plan.ok) {
    for (const m of plan.models) {
      modelMeshes.set(m.key, generateTileMesh(m.spec, meshOpts));
    }
  }
  return { plan, modelMeshes };
}

function getPlateCountForPlan(plan, modelMeshes, packMultiple) {
  const instances = [];
  for (const model of plan.models) {
    const mesh = modelMeshes.get(model.key);
    for (let c = 0; c < model.count; c++) {
      instances.push({ w: mesh.widthMm, d: mesh.depthMm, name: model.label });
    }
  }
  return packInstancesOntoPlates(instances, plan.bedWidthMm, plan.bedDepthMm, packMultiple).length;
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
    cornerRadiusMm: state.cornerRadiusMm,
    interlocking: state.interlocking,
  });

  state.plan = plan;
  state.modelMeshes.clear();
  persistState();

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
    els.kpiFilament.textContent = '—';
    els.kpiVolume.textContent = '—';
    els.layoutSvg.innerHTML = '';
    els.modelsList.innerHTML = '';
    els.download3mfBtn.disabled = true;
    els.download3mfSecondary.disabled = true;
    els.downloadAllBtn.disabled = true;
    els.downloadAllSecondary.disabled = true;
    els.saveDrawerBtn.disabled = true;
    viewer.clearScene();
    viewer.render();
    return;
  }

  els.errorBanner.classList.add('hidden');
  els.download3mfBtn.disabled = false;
  els.download3mfSecondary.disabled = false;
  els.downloadAllBtn.disabled = false;
  els.downloadAllSecondary.disabled = false;
  els.saveDrawerBtn.disabled = false;

  if (state.selectedModelIndex >= plan.models.length) {
    state.selectedModelIndex = 0;
  }

  for (const m of plan.models) {
    state.modelMeshes.set(m.key, generateTileMesh(m.spec, meshOpts));
  }

  // Prune any placed virtual bins that no longer fit cleanly on full 42mm cells
  state.placedBins = state.placedBins.filter((b) => canPlaceBinAt(plan, b.col, b.row, b.w, b.d, b));

  renderKpis(plan);
  render2DMap(plan);
  renderModelsList(plan);
  renderBatchBar();
  update3DView(resetCamera);
}

function renderKpis(plan) {
  const halfNote =
    plan.hasHalfX || plan.hasHalfY
      ? ` + half strip${plan.hasHalfX && plan.hasHalfY ? 's' : ''}`
      : '';
  els.kpiGrid.textContent = `${plan.cols} × ${plan.rows} units`;
  els.kpiCells.textContent = `${plan.totalCells} cells${halfNote} (${plan.gridWidthMm} × ${plan.gridDepthMm} mm)`;

  const plateCount = getPlateCountForPlan(plan, state.modelMeshes, state.packMultiple);
  els.kpiTiles.textContent = `${plan.tiles.length} ${plan.tiles.length === 1 ? 'tile' : 'tiles'} (${plateCount} ${plateCount === 1 ? 'plate' : 'plates'})`;
  els.kpiUnique.textContent = `${plan.models.length} unique STL${plan.models.length === 1 ? '' : 's'} · ${state.packMultiple ? 'packed .3mf' : '1 per plate'}`;

  els.kpiSize.textContent = `${plan.totalWidthMm} × ${plan.totalDepthMm} mm`;
  if (plan.fillMargins && (plan.leftoverX > 0.05 || plan.leftoverY > 0.05)) {
    const rimLabel =
      plan.marginFill === 'grid'
        ? 'grid rim'
        : plan.marginFill === 'half'
          ? 'half-grid rim'
          : 'solid rim';
    els.kpiRims.textContent = `${rimLabel}: ${plan.padL}/${plan.padR} mm X, ${plan.padB}/${plan.padT} mm Y`;
  } else {
    els.kpiRims.textContent = `Drawer: ${Math.round(plan.drawerWidthMm * 10) / 10} × ${Math.round(plan.drawerDepthMm * 10) / 10} mm`;
  }

  els.kpiBed.textContent = `${plan.bedWidthMm} × ${plan.bedDepthMm} mm`;
  const maxW = Math.max(...plan.models.map((m) => m.printWidthMm));
  const maxD = Math.max(...plan.models.map((m) => m.printDepthMm));
  els.kpiMaxTile.textContent = `Max print: ${maxW} × ${maxD} mm`;

  let totalGrams = 0;
  let totalCm3 = 0;
  for (const m of plan.models) {
    const mesh = state.modelMeshes.get(m.key);
    totalGrams += mesh.estGramsPla * m.count;
    totalCm3 += mesh.volumeCm3 * m.count;
  }
  els.kpiFilament.textContent = `~${Math.round(totalGrams)} g PLA`;
  els.kpiVolume.textContent = `${totalCm3.toFixed(1)} cm³ solid · ${state.nozzle} mm nozzle`;
}

function svgEl(tag, attrs = {}, text = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (text) el.textContent = text;
  return el;
}

function roundedTileSvgPath(x, y, w, d, rTL, rTR, rBR, rBL) {
  const tl = Math.min(rTL || 0, w / 2, d / 2);
  const tr = Math.min(rTR || 0, w / 2, d / 2);
  const br = Math.min(rBR || 0, w / 2, d / 2);
  const bl = Math.min(rBL || 0, w / 2, d / 2);
  return [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : '',
    `L ${x + w} ${y + d - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${x + w - br} ${y + d}` : '',
    `L ${x + bl} ${y + d}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${y + d - bl}` : '',
    `L ${x} ${y + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

function canPlaceBinAt(plan, col, row, wUnits, dUnits, ignoreBin = null) {
  if (!plan || !plan.ok) return false;
  if (col < 0 || row < 0 || col + wUnits > plan.allColWidths.length || row + dUnits > plan.allRowDepths.length) {
    return false;
  }
  for (let c = col; c < col + wUnits; c++) {
    if (Math.abs(plan.allColWidths[c] - GRIDFINITY_PITCH) > 0.1) return false;
  }
  for (let r = row; r < row + dUnits; r++) {
    if (Math.abs(plan.allRowDepths[r] - GRIDFINITY_PITCH) > 0.1) return false;
  }
  for (const b of state.placedBins) {
    if (b === ignoreBin) continue;
    const overlapX = col < b.col + b.w && col + wUnits > b.col;
    const overlapY = row < b.row + b.d && row + dUnits > b.row;
    if (overlapX && overlapY) return false;
  }
  return true;
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
      rx: Math.max(2 * strokeScale, plan.cornerRadiusMm || 0),
    })
  );

  // Position assembled tiles inside drawer interior [0..dw, 0..dd]
  const startX = plan.assemblyX ?? (dw - plan.totalWidthMm) / 2;
  const startY = plan.assemblyY ?? (dd - plan.totalDepthMm) / 2;

  for (const tile of plan.tiles) {
    const tx = startX + tile.xMm;
    const ty = dd - startY - tile.yMm - tile.depthMm;
    const color = TILE_COLORS[tile.modelIndex % TILE_COLORS.length];
    const isSelected = !state.testBinsMode && tile.modelIndex === state.selectedModelIndex;

    const g = svgEl('g', {
      style: state.testBinsMode ? 'cursor: crosshair' : 'cursor: pointer',
      'data-model-index': tile.modelIndex,
    });

    // Tile outer footprint (honoring rounded outer drawer corners)
    const { rTL, rTR, rBR, rBL } = tile.spec;
    const hasRoundCorner = rTL > 0 || rTR > 0 || rBR > 0 || rBL > 0;
    if (hasRoundCorner) {
      g.appendChild(
        svgEl('path', {
          d: roundedTileSvgPath(tx, ty, tile.widthMm, tile.depthMm, rTL, rTR, rBR, rBL),
          fill: color,
          'fill-opacity': isSelected ? 0.28 : 0.14,
          stroke: color,
          'stroke-width': (isSelected ? 2.4 : 1.3) * strokeScale,
        })
      );
    } else {
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
    }

    // Cumulative cell offsets for variable (42 mm / 21 mm) cell widths & depths
    const colWidths = tile.spec.colWidths || Array(tile.spec.nx).fill(GRIDFINITY_PITCH);
    const rowDepths = tile.spec.rowDepths || Array(tile.spec.ny).fill(GRIDFINITY_PITCH);
    const colOff = [0];
    for (const w of colWidths) colOff.push(colOff[colOff.length - 1] + w);
    const rowOff = [0];
    for (const d of rowDepths) rowOff.push(rowOff[rowOff.length - 1] + d);
    const gridW = colOff[colOff.length - 1];
    const gridD = rowOff[rowOff.length - 1];

    const gridOriginX = tx + tile.spec.padL;
    const gridOriginY = ty + tile.spec.padT;
    const gridOriginBottomY = gridOriginY + gridD;

    // Draw individual Gridfinity pockets (42 mm or 21 mm half-grid)
    for (let cy = 0; cy < rowDepths.length; cy++) {
      const cd = rowDepths[cy];
      const py = gridOriginBottomY - rowOff[cy] - cd + 2.15;
      for (let cx = 0; cx < colWidths.length; cx++) {
        const cw = colWidths[cx];
        const px = gridOriginX + colOff[cx] + 2.15;
        if (cw <= 4.3 || cd <= 4.3) continue;
        g.appendChild(
          svgEl('rect', {
            x: px,
            y: py,
            width: cw - 4.3,
            height: cd - 4.3,
            fill: '#0b0e14',
            'fill-opacity': 0.55,
            stroke: color,
            'stroke-opacity': cw < 30 || cd < 30 ? 0.72 : 0.5,
            'stroke-dasharray': cw < 30 || cd < 30 ? `${2 * strokeScale} ${1.5 * strokeScale}` : 'none',
            'stroke-width': 0.7 * strokeScale,
            rx: 3.0,
          })
        );
      }
    }

    // Draw smaller grid-rim cutouts in 2D map when marginFill === 'grid' or 'half'
    if (plan.marginFill === 'grid' || plan.marginFill === 'half') {
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
      const cutL = tile.spec.padL >= MIN_GRID_RIM_PAD;
      const cutR = tile.spec.padR >= MIN_GRID_RIM_PAD;
      const cutT = tile.spec.padT >= MIN_GRID_RIM_PAD;
      const cutB = tile.spec.padB >= MIN_GRID_RIM_PAD;

      if (cutL) {
        const px = tx + RIM_OUTER_WALL;
        const pw = tile.spec.padL - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cy = 0; cy < rowDepths.length; cy++) {
          const cd = rowDepths[cy];
          const ribT = cy === rowDepths.length - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribB = cy === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const cellTopY = gridOriginBottomY - rowOff[cy] - cd;
          drawRimPocket(px, cellTopY + ribT, pw, cd - ribT - ribB);
        }
      }
      if (cutR) {
        const px = gridOriginX + gridW + RIM_INNER_COLLAR;
        const pw = tile.spec.padR - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cy = 0; cy < rowDepths.length; cy++) {
          const cd = rowDepths[cy];
          const ribT = cy === rowDepths.length - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribB = cy === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const cellTopY = gridOriginBottomY - rowOff[cy] - cd;
          drawRimPocket(px, cellTopY + ribT, pw, cd - ribT - ribB);
        }
      }
      if (cutT) {
        const py = ty + RIM_OUTER_WALL;
        const ph = tile.spec.padT - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cx = 0; cx < colWidths.length; cx++) {
          const cw = colWidths[cx];
          const ribL = cx === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribR = cx === colWidths.length - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          drawRimPocket(gridOriginX + colOff[cx] + ribL, py, cw - ribL - ribR, ph);
        }
      }
      if (cutB) {
        const py = gridOriginBottomY + RIM_INNER_COLLAR;
        const ph = tile.spec.padB - RIM_OUTER_WALL - RIM_INNER_COLLAR;
        for (let cx = 0; cx < colWidths.length; cx++) {
          const cw = colWidths[cx];
          const ribL = cx === 0 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          const ribR = cx === colWidths.length - 1 ? RIM_RIB_THICKNESS : RIM_RIB_THICKNESS / 2;
          drawRimPocket(gridOriginX + colOff[cx] + ribL, py, cw - ribL - ribR, ph);
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
          gridOriginBottomY + RIM_INNER_COLLAR,
          tile.spec.padL - RIM_OUTER_WALL - RIM_INNER_COLLAR,
          tile.spec.padB - RIM_OUTER_WALL - RIM_INNER_COLLAR
        );
      }
      if (cutR && cutB) {
        drawRimPocket(
          gridOriginX + gridW + RIM_INNER_COLLAR,
          gridOriginBottomY + RIM_INNER_COLLAR,
          tile.spec.padR - RIM_OUTER_WALL - RIM_INNER_COLLAR,
          tile.spec.padB - RIM_OUTER_WALL - RIM_INNER_COLLAR
        );
      }
    }

    // Subtle interlocking tab markers along interior seams
    if (plan.interlocking) {
      const tabR = 2.1 * strokeScale;
      if (tile.spec.connR === 'tab') {
        for (let cy = 0; cy < rowDepths.length; cy++) {
          const midY = gridOriginBottomY - (rowOff[cy] + rowDepths[cy] / 2);
          g.appendChild(
            svgEl('circle', {
              cx: tx + tile.widthMm,
              cy: midY,
              r: tabR,
              fill: '#facc15',
              'fill-opacity': 0.85,
            })
          );
        }
      }
      if (tile.spec.connT === 'tab') {
        for (let cx = 0; cx < colWidths.length; cx++) {
          const midX = gridOriginX + colOff[cx] + colWidths[cx] / 2;
          g.appendChild(
            svgEl('circle', {
              cx: midX,
              cy: ty,
              r: tabR,
              fill: '#facc15',
              'fill-opacity': 0.85,
            })
          );
        }
      }
    }

    // Center label (hidden/dimmed when bin testing so bins stay crystal clear)
    if (!state.testBinsMode) {
      const centerX = tx + tile.widthMm / 2;
      const centerY = ty + tile.depthMm / 2;
      const fontSize = Math.min(tile.widthMm, tile.depthMm) * 0.19;
      const clampedFont = Math.max(9 * strokeScale, Math.min(18 * strokeScale, fontSize));

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
    }

    svg.appendChild(g);
  }

  // Interactive 2D Bin Fit Tester overlay
  if (state.testBinsMode) {
    renderBinOverlay(svg, plan, startX, startY, dd, strokeScale);
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

function renderBinOverlay(svg, plan, startX, startY, dd, strokeScale) {
  const allCols = plan.allColWidths;
  const allRows = plan.allRowDepths;
  const colEdges = [0];
  for (const w of allCols) colEdges.push(colEdges[colEdges.length - 1] + w);
  const rowEdges = [0];
  for (const d of allRows) rowEdges.push(rowEdges[rowEdges.length - 1] + d);

  const gridLeftX = startX + plan.padL;
  const gridBottomY = dd - startY - plan.padB;

  // Clickable empty full-unit cells (42 x 42 mm)
  for (let r = 0; r < allRows.length; r++) {
    if (Math.abs(allRows[r] - GRIDFINITY_PITCH) > 0.1) continue;
    for (let c = 0; c < allCols.length; c++) {
      if (Math.abs(allCols[c] - GRIDFINITY_PITCH) > 0.1) continue;
      const cx = gridLeftX + colEdges[c];
      const cy = gridBottomY - rowEdges[r + 1];
      const canFit = canPlaceBinAt(plan, c, r, state.activeBinW, state.activeBinD);

      const hit = svgEl('rect', {
        x: cx + 1.5,
        y: cy + 1.5,
        width: allCols[c] - 3,
        height: allRows[r] - 3,
        fill: canFit ? '#38bdf8' : 'transparent',
        'fill-opacity': 0.05,
        stroke: 'transparent',
        style: canFit ? 'cursor: copy' : 'cursor: not-allowed',
      });
      if (canFit) {
        hit.addEventListener('mouseenter', () => hit.setAttribute('fill-opacity', '0.24'));
        hit.addEventListener('mouseleave', () => hit.setAttribute('fill-opacity', '0.05'));
        hit.addEventListener('click', () => {
          state.placedBins.push({
            col: c,
            row: r,
            w: state.activeBinW,
            d: state.activeBinD,
          });
          render2DMap(plan);
        });
      }
      svg.appendChild(hit);
    }
  }

  // Placed virtual bins
  for (let idx = 0; idx < state.placedBins.length; idx++) {
    const b = state.placedBins[idx];
    const bx = gridLeftX + colEdges[b.col] + 1.2;
    const bw = colEdges[b.col + b.w] - colEdges[b.col] - 2.4;
    const byTop = gridBottomY - rowEdges[b.row + b.d] + 1.2;
    const bd = rowEdges[b.row + b.d] - rowEdges[b.row] - 2.4;

    const bg = svgEl('g', { style: 'cursor: pointer' });
    bg.appendChild(
      svgEl('rect', {
        x: bx,
        y: byTop,
        width: bw,
        height: bd,
        fill: '#38bdf8',
        'fill-opacity': 0.34,
        stroke: '#7dd3fc',
        'stroke-width': 2 * strokeScale,
        rx: 4 * strokeScale,
      })
    );
    const labelSize = Math.max(8.5 * strokeScale, Math.min(15 * strokeScale, Math.min(bw, bd) * 0.25));
    bg.appendChild(
      svgEl(
        'text',
        {
          x: bx + bw / 2,
          y: byTop + bd / 2,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: '#f0f9ff',
          'font-size': labelSize,
          'font-weight': '700',
          'font-family': 'Inter, system-ui, sans-serif',
        },
        `${b.w}×${b.d}`
      )
    );
    bg.addEventListener('click', (e) => {
      e.stopPropagation();
      state.placedBins.splice(idx, 1);
      render2DMap(plan);
    });
    bg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (b.w !== b.d && canPlaceBinAt(plan, b.col, b.row, b.d, b.w, b)) {
        const tmp = b.w;
        b.w = b.d;
        b.d = tmp;
        render2DMap(plan);
      }
    });
    svg.appendChild(bg);
  }
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
    meta.textContent = `Print size: ${model.printWidthMm} × ${model.printDepthMm} × ${mesh.heightMm} mm · ~${mesh.estGramsPla.toFixed(1)} g PLA · Slots: ${placements}`;

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
  els.testBinsToggle.classList.toggle('hidden', is3d);

  if (is3d) {
    requestAnimationFrame(() => update3DView(resetCamera));
  }
}

function buildAssemblyGuideText(plan, modelMeshes = state.modelMeshes) {
  const lines = [
    'GRIDFINITY DRAWER ASSEMBLY GUIDE',
    '================================',
    `Drawer interior: ${plan.drawerWidthMm} x ${plan.drawerDepthMm} mm (clearance: ${plan.clearanceMm} mm)`,
    `Printer bed:     ${plan.bedWidthMm} x ${plan.bedDepthMm} mm`,
    `Gridfinity grid: ${plan.cols} x ${plan.rows} cells (${plan.totalCells} total cells)`,
    `Assembled size:  ${plan.totalWidthMm} x ${plan.totalDepthMm} mm`,
    `Fit options:     leftover=${plan.marginFill}, cornerRadius=${plan.cornerRadiusMm}mm, interlocking=${plan.interlocking ? 'yes' : 'no'}`,
    '',
    'FILES TO PRINT',
    '--------------',
  ];
  let totalGrams = 0;
  for (const m of plan.models) {
    const mesh = modelMeshes.get(m.key);
    const grams = mesh ? mesh.estGramsPla : 0;
    totalGrams += grams * m.count;
    lines.push(
      `- ${getStlFilename(m)}: Print x${m.count} (~${grams.toFixed(1)} g PLA each, ${m.spec.nx}x${m.spec.ny} grid, ${m.printWidthMm} x ${m.printDepthMm} mm)`
    );
  }
  lines.push(`Estimated total PLA: ~${Math.round(totalGrams)} g`);
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

function downloadBambu3mf() {
  const plan = state.plan;
  if (!plan || !plan.ok) return;
  const { blob, plateCount } = createBambu3mfBlob(plan, state.modelMeshes, {
    presetId: state.presetId,
    nozzle: state.nozzle,
    packMultiple: state.packMultiple,
  });
  triggerDownload(
    blob,
    `gridfinity_${plan.cols}x${plan.rows}_bambu_${plateCount}plates_${state.nozzle}mm.3mf`
  );
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
    data: buildAssemblyGuideText(plan, state.modelMeshes),
  });

  const zipBlob = createZipBlob(entries);
  triggerDownload(zipBlob, `gridfinity_${plan.cols}x${plan.rows}_drawer.zip`);
}

function renderBatchBar() {
  const count = state.savedDrawers.length;
  els.batchBar.classList.toggle('hidden', count === 0);
  if (count === 0) {
    els.batchChips.innerHTML = '';
    return;
  }

  els.batchChips.innerHTML = '';
  state.savedDrawers.forEach((item, idx) => {
    const chip = document.createElement('div');
    chip.className = 'batch-chip';
    chip.title = `Load ${item.name} (${item.config.w}×${item.config.d} mm)`;

    const label = document.createElement('span');
    label.textContent = `${item.name} (${item.cols}×${item.rows})`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chip-del';
    del.textContent = '×';
    del.setAttribute('aria-label', `Remove ${item.name}`);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.savedDrawers.splice(idx, 1);
      persistBatch();
      renderBatchBar();
    });

    chip.addEventListener('click', () => {
      applyConfig(item.config);
      recomputeAndRender(true);
    });

    chip.appendChild(label);
    chip.appendChild(del);
    els.batchChips.appendChild(chip);
  });
}

function saveCurrentDrawerToBatch() {
  const plan = state.plan;
  if (!plan || !plan.ok) return;
  const ikea = getIkeaDrawerById(state.selectedIkeaId);
  const defaultName = ikea
    ? `${ikea.shortName} (${Math.round(plan.drawerWidthMm)}x${Math.round(plan.drawerDepthMm)})`
    : `Drawer ${state.savedDrawers.length + 1} (${Math.round(plan.drawerWidthMm)}x${Math.round(plan.drawerDepthMm)})`;
  const entered = window.prompt('Name this drawer (used for batch plate labels):', defaultName);
  if (entered === null) return;
  const cleanName = (entered.trim() || defaultName).slice(0, 36);
  state.savedDrawers.push({
    id: Date.now(),
    name: cleanName,
    cols: plan.cols,
    rows: plan.rows,
    config: serializeConfig(),
  });
  persistBatch();
  renderBatchBar();
}

function downloadBatch3mf() {
  if (state.savedDrawers.length === 0) return;
  const sharedBed = { bedWidthMm: state.bedWidthMm, bedDepthMm: state.bedDepthMm };
  const drawerItems = [];
  for (const item of state.savedDrawers) {
    const { plan, modelMeshes } = buildDrawerPlanAndMeshes(item.config, sharedBed);
    if (!plan.ok) {
      window.alert(`Drawer "${item.name}" does not fit on the selected bed (${plan.error}).`);
      return;
    }
    drawerItems.push({ namePrefix: item.name, plan, modelMeshes });
  }
  const { blob, plateCount } = createBatchBambu3mfBlob(drawerItems, {
    presetId: state.presetId,
    nozzle: state.nozzle,
    packMultiple: state.packMultiple,
    title: `Gridfinity Batch (${drawerItems.length} drawers)`,
  });
  triggerDownload(
    blob,
    `gridfinity_batch_${drawerItems.length}drawers_${plateCount}plates_${state.nozzle}mm.3mf`
  );
}

function downloadBatchZip() {
  if (state.savedDrawers.length === 0) return;
  const sharedBed = { bedWidthMm: state.bedWidthMm, bedDepthMm: state.bedDepthMm };
  const entries = [];
  const summaryLines = ['GRIDFINITY BATCH EXPORT', '=======================', ''];
  state.savedDrawers.forEach((item, idx) => {
    const { plan, modelMeshes } = buildDrawerPlanAndMeshes(item.config, sharedBed);
    if (!plan.ok) return;
    const folder = item.name.replace(/[<>:"/\\|?*]+/g, '_').trim() || `drawer_${idx + 1}`;
    for (const m of plan.models) {
      const mesh = modelMeshes.get(m.key);
      entries.push({
        name: `${folder}/${getStlFilename(m)}`,
        data: encodeBinaryStl(mesh, `${item.name} Model ${m.label}`),
      });
    }
    entries.push({
      name: `${folder}/ASSEMBLY_GUIDE.txt`,
      data: buildAssemblyGuideText(plan, modelMeshes),
    });
    summaryLines.push(`${idx + 1}. ${item.name}: ${plan.cols}x${plan.rows} (${plan.tiles.length} tiles)`);
  });
  entries.push({ name: 'BATCH_SUMMARY.txt', data: summaryLines.join('\n') + '\n' });
  const zipBlob = createZipBlob(entries);
  triggerDownload(zipBlob, `gridfinity_batch_${state.savedDrawers.length}drawers.zip`);
}

function syncBinPaletteUI() {
  els.testBinsToggle.classList.toggle('active', state.testBinsMode);
  els.binPalette.classList.toggle('hidden', !state.testBinsMode);
  els.map2dCaption.textContent = state.testBinsMode
    ? `Click cells to drop a ${state.activeBinW}×${state.activeBinD} bin · Click bin to remove · Right-click or R to rotate`
    : 'Click any tile to inspect its model. Arrows show placement orientation in the drawer.';
  document.querySelectorAll('.bin-size-btn').forEach((btn) => {
    const [w, d] = btn.dataset.binSize.split('x').map(Number);
    const matches =
      (w === state.activeBinW && d === state.activeBinD) ||
      (w === state.activeBinD && d === state.activeBinW);
    btn.classList.toggle('active', matches);
    if (matches) {
      btn.textContent = `${state.activeBinW}×${state.activeBinD}`;
    } else {
      btn.textContent = `${w}×${d}`;
    }
  });
}

const GOATCOUNTER_BASE = 'https://tommo1818.goatcounter.com';
const GOATCOUNTER_VISIT_PATH = '/simple-gridfinity-generator';
const GOATCOUNTER_DOWNLOAD_PATH = '/download';

let footerVisitCount = null;
let footerDownloadCount = null;

function renderFooterCounters() {
  if (els.visitCountValue && els.visitCountLabel) {
    if (footerVisitCount === null) {
      els.visitCountValue.textContent = '—';
      els.visitCountLabel.textContent = 'visits';
    } else {
      els.visitCountValue.textContent = footerVisitCount.toLocaleString();
      els.visitCountLabel.textContent = footerVisitCount === 1 ? 'visit' : 'visits';
    }
  }
  if (els.downloadCountValue && els.downloadCountLabel) {
    if (footerDownloadCount === null) {
      els.downloadCountValue.textContent = '—';
      els.downloadCountLabel.textContent = 'downloads';
    } else {
      els.downloadCountValue.textContent = footerDownloadCount.toLocaleString();
      els.downloadCountLabel.textContent = footerDownloadCount === 1 ? 'download' : 'downloads';
    }
  }
}

async function fetchGoatCounterValue(path) {
  try {
    const url = `${GOATCOUNTER_BASE}/counter/${encodeURIComponent(path)}.json`;
    const res = await fetch(url);
    if (res.status === 404) return 0;
    if (!res.ok) return null;
    const data = await res.json();
    const digits = String(data?.count ?? '0').replace(/[^\d]/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
  } catch {
    return null;
  }
}

async function initFooterCounters() {
  const [visits, downloads] = await Promise.all([
    fetchGoatCounterValue(GOATCOUNTER_VISIT_PATH),
    fetchGoatCounterValue(GOATCOUNTER_DOWNLOAD_PATH),
  ]);
  footerVisitCount = visits;
  footerDownloadCount = downloads;
  renderFooterCounters();
}

function trackDownloadHit(filename) {
  if (window.goatcounter && typeof window.goatcounter.count === 'function') {
    window.goatcounter.count({
      path: GOATCOUNTER_DOWNLOAD_PATH,
      title: filename,
      no_session: true,
    });
  }
  if (footerDownloadCount !== null) {
    footerDownloadCount += 1;
    renderFooterCounters();
  }
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
  trackDownloadHit(filename);
}

// Wire floating tooltips & events
function initTooltips() {
  const tipEl = document.createElement('div');
  tipEl.className = 'floating-tip hidden';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);

  let activeTarget = null;

  const showTip = (target) => {
    const text = target.dataset.tip;
    if (!text) return;
    activeTarget = target;
    tipEl.textContent = text;
    tipEl.classList.remove('hidden');

    const rect = target.getBoundingClientRect();
    const tipRect = tipEl.getBoundingClientRect();
    const margin = 8;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - tipRect.width - margin, left));

    let top = rect.top - tipRect.height - 8;
    if (top < margin) {
      top = rect.bottom + 8;
    }

    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
  };

  const hideTip = () => {
    activeTarget = null;
    tipEl.classList.add('hidden');
  };

  document.querySelectorAll('.tip[data-tip]').forEach((btn) => {
    btn.addEventListener('mouseenter', () => showTip(btn));
    btn.addEventListener('mouseleave', hideTip);
    btn.addEventListener('focus', () => showTip(btn));
    btn.addEventListener('blur', hideTip);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeTarget === btn && !tipEl.classList.contains('hidden')) {
        hideTip();
      } else {
        showTip(btn);
      }
    });
  });

  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}

function formatDimPair(widthMm, depthMm, unit) {
  return `${formatUnitVal(widthMm, unit)} × ${formatUnitVal(depthMm, unit)} ${unit}`;
}

function syncIkeaSelectedBanner() {
  const banner = els.ikeaSelectedBanner;
  if (!banner) return;
  const preset = getIkeaDrawerById(state.selectedIkeaId);
  if (!preset) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  banner.innerHTML = '';
  const top = document.createElement('div');
  top.className = 'ikea-selected-top';

  const title = document.createElement('span');
  title.textContent = `${preset.name} · ${formatDimPair(preset.widthMm, preset.depthMm, state.unit)}`;

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'ikea-banner-clear';
  clearBtn.textContent = '×';
  clearBtn.title = 'Detach preset label (keeps dimensions)';
  clearBtn.setAttribute('aria-label', 'Clear selected IKEA preset');
  clearBtn.addEventListener('click', () => {
    state.selectedIkeaId = null;
    syncIkeaSelectedBanner();
    persistState();
  });

  top.appendChild(title);
  top.appendChild(clearBtn);
  banner.appendChild(top);

  if (preset.note) {
    const note = document.createElement('div');
    note.className = 'ikea-selected-note';
    note.textContent = preset.note;
    banner.appendChild(note);
  }

  banner.classList.remove('hidden');
}

let refreshIkeaDropdown = () => {};

function initIkeaPicker() {
  if (!els.ikeaPicker || !els.ikeaSearchInput || !els.ikeaDropdown) return;

  let isOpen = false;
  let highlightedIdx = -1;
  let currentResults = IKEA_DRAWERS;

  if (els.ikeaPresetCount) {
    els.ikeaPresetCount.textContent = `${IKEA_DRAWERS.length} sizes`;
  }

  const updateClearBtn = () => {
    if (!els.ikeaClearBtn) return;
    els.ikeaClearBtn.classList.toggle('hidden', !els.ikeaSearchInput.value);
  };

  const selectIkeaPreset = (item) => {
    state.selectedIkeaId = item.id;
    state.drawerWidthMm = item.widthMm;
    state.drawerDepthMm = item.depthMm;
    state.cornerRadiusMm = item.cornerRadiusMm || 0;
    els.ikeaSearchInput.value = '';
    updateClearBtn();
    closeDropdown();
    syncAllInputsFromState();
    recomputeAndRender(true);
  };

  const renderDropdown = () => {
    const query = els.ikeaSearchInput.value;
    currentResults = searchIkeaDrawers(query, state.clearanceMm);
    if (highlightedIdx >= currentResults.length) {
      highlightedIdx = currentResults.length - 1;
    }

    if (els.ikeaPresetCount) {
      els.ikeaPresetCount.textContent =
        query.trim() ? `${currentResults.length} of ${IKEA_DRAWERS.length}` : `${IKEA_DRAWERS.length} sizes`;
    }

    els.ikeaDropdown.innerHTML = '';

    if (currentResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ikea-empty';
      empty.textContent = `No IKEA drawers matching "${query.trim()}"`;
      els.ikeaDropdown.appendChild(empty);
      return;
    }

    currentResults.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ikea-option';
      btn.setAttribute('role', 'option');
      const isSelected = item.id === state.selectedIkeaId;
      btn.setAttribute('aria-selected', String(isSelected));
      if (isSelected) btn.classList.add('selected');
      if (idx === highlightedIdx) btn.classList.add('highlighted');

      const top = document.createElement('div');
      top.className = 'ikea-option-top';

      const name = document.createElement('span');
      name.className = 'ikea-option-name';
      name.textContent = item.name;

      const dims = document.createElement('span');
      dims.className = 'ikea-option-dims';
      dims.textContent = formatDimPair(item.widthMm, item.depthMm, state.unit);

      top.appendChild(name);
      top.appendChild(dims);

      const meta = document.createElement('div');
      meta.className = 'ikea-option-meta';

      const tag = document.createElement('span');
      tag.className = 'ikea-series-tag';
      tag.textContent = item.series;

      const cat = document.createElement('span');
      cat.textContent =
        item.cornerRadiusMm > 0
          ? `${item.category} · ${item.cornerRadiusMm} mm corners`
          : item.category;

      meta.appendChild(tag);
      meta.appendChild(cat);

      btn.appendChild(top);
      btn.appendChild(meta);

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      btn.addEventListener('click', () => selectIkeaPreset(item));
      els.ikeaDropdown.appendChild(btn);
    });
  };

  const openDropdown = () => {
    isOpen = true;
    highlightedIdx = -1;
    renderDropdown();
    els.ikeaDropdown.classList.remove('hidden');
    els.ikeaSearchInput.setAttribute('aria-expanded', 'true');
  };

  const closeDropdown = () => {
    isOpen = false;
    highlightedIdx = -1;
    els.ikeaDropdown.classList.add('hidden');
    els.ikeaSearchInput.setAttribute('aria-expanded', 'false');
  };

  refreshIkeaDropdown = () => {
    if (isOpen) renderDropdown();
  };

  els.ikeaSearchInput.addEventListener('focus', () => {
    openDropdown();
  });

  els.ikeaSearchInput.addEventListener('click', () => {
    if (!isOpen) openDropdown();
  });

  els.ikeaSearchInput.addEventListener('input', () => {
    updateClearBtn();
    highlightedIdx = 0;
    if (!isOpen) {
      isOpen = true;
      els.ikeaDropdown.classList.remove('hidden');
      els.ikeaSearchInput.setAttribute('aria-expanded', 'true');
    }
    renderDropdown();
  });

  els.ikeaSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
      }
      if (currentResults.length > 0) {
        highlightedIdx = (highlightedIdx + 1) % currentResults.length;
        renderDropdown();
        const activeEl = els.ikeaDropdown.children[highlightedIdx];
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
      }
      if (currentResults.length > 0) {
        highlightedIdx = highlightedIdx <= 0 ? currentResults.length - 1 : highlightedIdx - 1;
        renderDropdown();
        const activeEl = els.ikeaDropdown.children[highlightedIdx];
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      if (isOpen && currentResults.length > 0) {
        e.preventDefault();
        const targetIdx = highlightedIdx >= 0 ? highlightedIdx : 0;
        selectIkeaPreset(currentResults[targetIdx]);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        closeDropdown();
      }
    }
  });

  if (els.ikeaToggleBtn) {
    els.ikeaToggleBtn.addEventListener('click', () => {
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
        els.ikeaSearchInput.focus();
      }
    });
  }

  if (els.ikeaClearBtn) {
    els.ikeaClearBtn.addEventListener('click', () => {
      els.ikeaSearchInput.value = '';
      updateClearBtn();
      highlightedIdx = -1;
      openDropdown();
      els.ikeaSearchInput.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (isOpen && !els.ikeaPicker.contains(e.target)) {
      closeDropdown();
    }
  });

  updateClearBtn();
  syncIkeaSelectedBanner();
}

function bindEvents() {
  initTooltips();
  initIkeaPicker();

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
      syncIkeaSelectedBanner();
      refreshIkeaDropdown();
      persistState();
    });
  });

  // Leftover space rim mode switcher
  document.querySelectorAll('[data-rim]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextRim = btn.dataset.rim;
      if (nextRim === state.marginFill) return;
      state.marginFill = nextRim;
      document.querySelectorAll('[data-rim]').forEach((b) => b.classList.toggle('active', b === btn));
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

  const onDrawerChange = (e) => {
    const f = UNIT_FACTORS[state.unit];
    const w = parseFloat(els.drawerWidth.value);
    const d = parseFloat(els.drawerDepth.value);
    const c = parseFloat(els.clearanceInput.value);
    if (Number.isFinite(w) && w > 0) state.drawerWidthMm = w * f;
    if (Number.isFinite(d) && d > 0) state.drawerDepthMm = d * f;
    state.clearanceMm = Number.isFinite(c) && c >= 0 ? c * f : 0;
    if (e && (e.target === els.drawerWidth || e.target === els.drawerDepth) && state.selectedIkeaId) {
      state.selectedIkeaId = null;
      syncIkeaSelectedBanner();
    }
    recomputeAndRender(true);
  };

  els.drawerWidth.addEventListener('input', onDrawerChange);
  els.drawerDepth.addEventListener('input', onDrawerChange);
  els.clearanceInput.addEventListener('input', onDrawerChange);

  els.cornerRadiusInput.addEventListener('input', () => {
    const r = parseFloat(els.cornerRadiusInput.value);
    state.cornerRadiusMm = Number.isFinite(r) && r >= 0 ? Math.min(50, r) : 0;
    if (state.selectedIkeaId) {
      state.selectedIkeaId = null;
      syncIkeaSelectedBanner();
    }
    recomputeAndRender(false);
  });

  els.interlockingCheck.addEventListener('change', () => {
    state.interlocking = els.interlockingCheck.checked;
    recomputeAndRender(false);
  });

  document.querySelectorAll('[data-nozzle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextNozzle = btn.dataset.nozzle;
      if (nextNozzle === state.nozzle) return;
      state.nozzle = nextNozzle;
      document.querySelectorAll('[data-nozzle]').forEach((b) => b.classList.toggle('active', b === btn));
      persistState();
      if (state.plan && state.plan.ok) renderKpis(state.plan);
    });
  });

  els.packPlatesCheck.addEventListener('change', () => {
    state.packMultiple = els.packPlatesCheck.checked;
    persistState();
    if (state.plan && state.plan.ok) renderKpis(state.plan);
  });

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

  els.testBinsToggle.addEventListener('click', () => {
    state.testBinsMode = !state.testBinsMode;
    syncBinPaletteUI();
    if (state.plan && state.plan.ok) render2DMap(state.plan);
  });

  document.querySelectorAll('.bin-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [w, d] = btn.dataset.binSize.split('x').map(Number);
      state.activeBinW = w;
      state.activeBinD = d;
      syncBinPaletteUI();
      if (state.plan && state.plan.ok) render2DMap(state.plan);
    });
  });

  const rotateSelectedBin = () => {
    const tmp = state.activeBinW;
    state.activeBinW = state.activeBinD;
    state.activeBinD = tmp;
    syncBinPaletteUI();
    if (state.plan && state.plan.ok) render2DMap(state.plan);
  };
  els.rotateBinBtn.addEventListener('click', rotateSelectedBin);

  els.clearBinsBtn.addEventListener('click', () => {
    state.placedBins = [];
    if (state.plan && state.plan.ok) render2DMap(state.plan);
  });

  window.addEventListener('keydown', (e) => {
    if (!state.testBinsMode || state.viewMode !== '2d') return;
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'r' || e.key === 'R') rotateSelectedBin();
  });

  els.shareBtn.addEventListener('click', async () => {
    const encoded = encodeBase64Url(JSON.stringify(serializeConfig()));
    const url = new URL(window.location.href);
    url.searchParams.set('w', encoded);
    window.history.replaceState(null, '', url.toString());
    const span = els.shareBtn.querySelector('span');
    try {
      await navigator.clipboard.writeText(url.toString());
      if (span) span.textContent = 'Link Copied!';
    } catch {
      window.prompt('Copy this shareable link:', url.toString());
      if (span) span.textContent = 'Link Ready!';
    }
    setTimeout(() => {
      if (span) span.textContent = 'Share Link';
    }, 2000);
  });

  els.saveDrawerBtn.addEventListener('click', saveCurrentDrawerToBatch);
  els.exportBatch3mfBtn.addEventListener('click', downloadBatch3mf);
  els.exportBatchZipBtn.addEventListener('click', downloadBatchZip);

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

  els.download3mfBtn.addEventListener('click', downloadBambu3mf);
  els.download3mfSecondary.addEventListener('click', downloadBambu3mf);
  els.downloadAllBtn.addEventListener('click', downloadAllZip);
  els.downloadAllSecondary.addEventListener('click', downloadAllZip);

  window.addEventListener('resize', () => {
    if (state.viewMode !== '2d') viewer.resize();
  });
}

initPresets();
restoreSavedState();
bindEvents();
recomputeAndRender(true);
renderBatchBar();
initFooterCounters();
