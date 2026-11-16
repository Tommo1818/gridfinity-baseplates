export const BAMBU_PRESETS = [
  {
    id: 'a1-mini',
    name: 'Bambu Lab A1 mini',
    bedX: 180,
    bedY: 180,
    maxGridLabel: '4 × 4 max',
    note: '180 × 180 mm build plate',
  },
  {
    id: 'a1',
    name: 'Bambu Lab A1',
    bedX: 256,
    bedY: 256,
    maxGridLabel: '6 × 6 max',
    note: '256 × 256 mm build plate',
  },
  {
    id: 'p1s',
    name: 'Bambu Lab P1P / P1S',
    bedX: 256,
    bedY: 256,
    maxGridLabel: '6 × 6 max',
    note: '256 × 256 mm build plate (252 mm for 6×6)',
  },
  {
    id: 'x1c',
    name: 'Bambu Lab X1C / X1E',
    bedX: 256,
    bedY: 256,
    maxGridLabel: '6 × 6 max',
    note: '256 × 256 mm build plate (252 mm for 6×6)',
  },
  {
    id: 'h2d',
    name: 'Bambu Lab H2D (Single Nozzle)',
    bedX: 325,
    bedY: 320,
    maxGridLabel: '7 × 7 max',
    note: '325 × 320 mm single-nozzle printable area',
  },
  {
    id: 'h2d-dual',
    name: 'Bambu Lab H2D (Dual Nozzle)',
    bedX: 300,
    bedY: 320,
    maxGridLabel: '7 × 7 max',
    note: '300 × 320 mm dual-nozzle printable area',
  },
  {
    id: 'custom',
    name: 'Custom Printer Bed',
    bedX: 220,
    bedY: 220,
    maxGridLabel: 'Custom',
    note: 'Enter any printable X × Y dimensions',
  },
];

export function getPresetById(id) {
  return BAMBU_PRESETS.find((p) => p.id === id) || BAMBU_PRESETS[0];
}
