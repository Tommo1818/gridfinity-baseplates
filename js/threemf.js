import { createZipBlob } from './zip.js';
import { buildProjectSettingsJson } from './bambu_profile.js';

function makeUuid(seed) {
  const hex = (n, len) => (n >>> 0).toString(16).padStart(len, '0').slice(-len);
  return `${hex(seed * 2654435761, 8)}-${hex(seed * 2246822519, 4)}-4${hex(seed * 3266489917, 3)}-8${hex(seed * 668265263, 3)}-${hex(seed * 374761393, 8)}${hex(seed + 17, 4)}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeName(str) {
  return String(str).replace(/[<>:/\\|?*"]/g, '-');
}

/**
 * Serialize a triangle mesh into a deduplicated 3MF sub-model XML string.
 */
function buildObjectModelXml(mesh, partId) {
  const { positions, triCount } = mesh;
  const vertMap = new Map();
  const vertices = [];
  const triangles = [];

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const idxs = new Array(3);
    for (let v = 0; v < 3; v++) {
      const x = positions[base + v * 3];
      const y = positions[base + v * 3 + 1];
      const z = positions[base + v * 3 + 2];
      const xr = Math.round(x * 1e4) / 1e4;
      const yr = Math.round(y * 1e4) / 1e4;
      const zr = Math.round(z * 1e4) / 1e4;
      const key = `${xr},${yr},${zr}`;
      let idx = vertMap.get(key);
      if (idx === undefined) {
        idx = vertices.length;
        vertMap.set(key, idx);
        vertices.push(`     <vertex x="${xr}" y="${yr}" z="${zr}" />`);
      }
      idxs[v] = idx;
    }
    triangles.push(`     <triangle v1="${idxs[0]}" v2="${idxs[1]}" v3="${idxs[2]}" />`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ' <resources>',
    `  <object id="${partId}" p:UUID="${makeUuid(partId * 101)}" type="model">`,
    '   <mesh>',
    '    <vertices>',
    ...vertices,
    '    </vertices>',
    '    <triangles>',
    ...triangles,
    '    </triangles>',
    '   </mesh>',
    '  </object>',
    ' </resources>',
    ' <build/>',
    '</model>',
  ].join('\n');
}

/**
 * 2D shelf packer placing multiple tile instances onto minimal build plates.
 * Allows 90 deg rotation when beneficial. Keeps `gap` mm between parts and `margin` mm from edges
 * (falling back to 0 margin for near-full-bed single tiles).
 */
export function packInstancesOntoPlates(instances, bedX, bedY, packMultiple = true, gap = 8, margin = 4) {
  if (!packMultiple) {
    return instances.map((inst) => ({
      items: [
        {
          ...inst,
          rotated90: false,
          localX: bedX * 0.5,
          localY: bedY * 0.5,
        },
      ],
    }));
  }

  // Sort largest/tallest first for tightest shelf packing
  const sorted = [...instances].sort((a, b) => {
    const areaDiff = b.w * b.d - a.w * a.d;
    if (Math.abs(areaDiff) > 1) return areaDiff;
    return Math.max(b.w, b.d) - Math.max(a.w, a.d);
  });

  const plates = [];

  for (const inst of sorted) {
    // Try fitting onto an existing plate's shelves
    let placed = false;
    for (const plate of plates) {
      if (tryPlaceOnPlate(plate, inst, bedX, bedY, gap, margin)) {
        placed = true;
        break;
      }
    }
    if (placed) continue;

    // Open a new plate (use margin if tile fits with margin, otherwise 0 edge margin)
    const fitsWithMargin =
      (inst.w + margin * 2 <= bedX + 1e-6 && inst.d + margin * 2 <= bedY + 1e-6) ||
      (inst.d + margin * 2 <= bedX + 1e-6 && inst.w + margin * 2 <= bedY + 1e-6);
    const effMargin = fitsWithMargin ? margin : 0;
    const plate = { shelves: [], items: [], margin: effMargin };
    if (!tryPlaceOnPlate(plate, inst, bedX, bedY, gap, effMargin)) {
      // Fallback centered
      plate.items.push({ ...inst, rotated90: false, localX: bedX * 0.5, localY: bedY * 0.5 });
    }
    plates.push(plate);
  }

  // Center each plate's packed bounding box nicely on the bed
  for (const plate of plates) {
    if (plate.items.length === 1 && !plate.shelves.length) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const it of plate.items) {
      const w = it.rotated90 ? it.d : it.w;
      const d = it.rotated90 ? it.w : it.d;
      minX = Math.min(minX, it.localX - w / 2);
      maxX = Math.max(maxX, it.localX + w / 2);
      minY = Math.min(minY, it.localY - d / 2);
      maxY = Math.max(maxY, it.localY + d / 2);
    }
    const shiftX = bedX / 2 - (minX + maxX) / 2;
    const shiftY = bedY / 2 - (minY + maxY) / 2;
    for (const it of plate.items) {
      it.localX += shiftX;
      it.localY += shiftY;
    }
  }

  return plates;
}

function tryPlaceOnPlate(plate, inst, bedX, bedY, gap, margin) {
  const usableW = bedX - margin * 2;
  const usableD = bedY - margin * 2;
  const orientations = [
    { w: inst.w, d: inst.d, rotated90: false },
    ...(Math.abs(inst.w - inst.d) > 1e-4 ? [{ w: inst.d, d: inst.w, rotated90: true }] : []),
  ];

  // Try existing shelves first
  for (const shelf of plate.shelves) {
    for (const ori of orientations) {
      if (ori.d <= shelf.height + 1e-6 && shelf.usedW + gap + ori.w <= usableW + 1e-6) {
        const lx = margin + shelf.usedW + gap + ori.w / 2;
        const ly = margin + shelf.y + ori.d / 2;
        shelf.usedW += gap + ori.w;
        plate.items.push({ ...inst, rotated90: ori.rotated90, localX: lx, localY: ly });
        return true;
      }
    }
  }

  // Open a new shelf
  const usedY = plate.shelves.length === 0 ? 0 : plate.shelves[plate.shelves.length - 1].y + plate.shelves[plate.shelves.length - 1].height + gap;
  // Pick orientation that leaves most remaining shelf space or smaller height
  const validOris = orientations.filter((o) => o.w <= usableW + 1e-6 && usedY + o.d <= usableD + 1e-6);
  if (validOris.length === 0) return false;
  validOris.sort((a, b) => a.d - b.d);
  const chosen = validOris[0];
  plate.shelves.push({ y: usedY, height: chosen.d, usedW: chosen.w });
  plate.items.push({
    ...inst,
    rotated90: chosen.rotated90,
    localX: margin + chosen.w / 2,
    localY: margin + usedY + chosen.d / 2,
  });
  return true;
}

/**
 * Create a multi-plate Bambu Studio .3mf Blob from one or more drawer plans.
 * Each batch item: { namePrefix: string, plan, modelMeshes }
 */
export function createBatchBambu3mfBlob(
  drawerItems,
  { presetId = 'a1-mini', nozzle = '0.4', packMultiple = true, title = 'Gridfinity Plates' } = {}
) {
  const firstPlan = drawerItems[0].plan;
  const bedX = firstPlan.bedWidthMm;
  const bedY = firstPlan.bedDepthMm;
  const stepX = bedX * 1.2;
  const stepY = bedY * 1.2;

  const entries = [];
  const rels = [];
  const instances = [];

  let meshCounter = 0;
  for (const item of drawerItems) {
    const prefix = item.namePrefix ? `${item.namePrefix} - ` : '';
    for (const model of item.plan.models) {
      meshCounter++;
      const partId = meshCounter * 2 - 1;
      const relPath = `/3D/Objects/object_${meshCounter}.model`;
      const mesh = item.modelMeshes.get(model.key);

      entries.push({
        name: `3D/Objects/object_${meshCounter}.model`,
        data: buildObjectModelXml(mesh, partId),
      });

      rels.push(
        ` <Relationship Target="${relPath}" Id="rel-${meshCounter}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />`
      );

      for (let copy = 0; copy < model.count; copy++) {
        const baseLabel =
          model.count > 1
            ? `${prefix}Model ${model.label} (${copy + 1} of ${model.count}) ${model.spec.nx}x${model.spec.ny}`
            : `${prefix}Model ${model.label} ${model.spec.nx}x${model.spec.ny}`;
        instances.push({
          partId,
          relPath,
          triCount: mesh.triCount,
          w: mesh.widthMm,
          d: mesh.depthMm,
          name: sanitizeName(baseLabel),
        });
      }
    }
  }

  const plates = packInstancesOntoPlates(instances, bedX, bedY, packMultiple);
  const colsPerRow = Math.max(1, Math.ceil(Math.sqrt(plates.length)));

  const resourceObjects = [];
  const buildItems = [];
  const configObjects = [];
  const platesXml = [];
  const assembleItems = [];

  let uuidCounter = 1;
  let globalItemCounter = 0;

  plates.forEach((plate, pIdx) => {
    const platerId = pIdx + 1;
    const gridCol = pIdx % colsPerRow;
    const gridRow = Math.floor(pIdx / colsPerRow);
    const plateOriginX = gridCol * stepX;
    const plateOriginY = -gridRow * stepY;

    const plateInstXml = [];
    for (const item of plate.items) {
      globalItemCounter++;
      const objId = globalItemCounter * 2 + 10;
      const cx = +(plateOriginX + item.localX).toFixed(3);
      const cy = +(plateOriginY + item.localY).toFixed(3);
      const lx = +item.localX.toFixed(3);
      const ly = +item.localY.toFixed(3);

      // 3MF 3x4 affine matrix: identity or 90 deg CCW rotation in XY
      const rotMat = item.rotated90 ? '0 -1 0 1 0 0 0 0 1' : '1 0 0 0 1 0 0 0 1';

      resourceObjects.push(
        [
          `  <object id="${objId}" p:UUID="${makeUuid(uuidCounter++)}" type="model">`,
          '   <components>',
          `    <component p:path="${item.relPath}" objectid="${item.partId}" p:UUID="${makeUuid(uuidCounter++)}" transform="1 0 0 0 1 0 0 0 1 0 0 0" />`,
          '   </components>',
          '  </object>',
        ].join('\n')
      );

      buildItems.push(
        `  <item objectid="${objId}" p:UUID="${makeUuid(uuidCounter++)}" transform="${rotMat} ${cx} ${cy} 0" printable="1" />`
      );

      configObjects.push(
        [
          `  <object id="${objId}">`,
          `    <metadata key="name" value="${escapeXml(item.name)}"/>`,
          '    <metadata key="extruder" value="1"/>',
          `    <metadata face_count="${item.triCount}"/>`,
          `    <part id="${item.partId}" subtype="normal_part">`,
          `      <metadata key="name" value="${escapeXml(item.name)}"/>`,
          '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>',
          '      <metadata key="source_object_id" value="0"/>',
          '      <metadata key="source_volume_id" value="0"/>',
          '    </part>',
          '  </object>',
        ].join('\n')
      );

      plateInstXml.push(
        [
          '    <model_instance>',
          `      <metadata key="object_id" value="${objId}"/>`,
          '      <metadata key="instance_id" value="0"/>',
          `      <metadata key="identify_id" value="${100 + globalItemCounter}"/>`,
          '    </model_instance>',
        ].join('\n')
      );

      assembleItems.push(
        `   <assemble_item object_id="${objId}" instance_id="0" transform="${rotMat} ${lx} ${ly} 0" offset="0 0 0" />`
      );
    }

    const plateTitle =
      plate.items.length === 1
        ? plate.items[0].name
        : `Plate ${platerId} (${plate.items.length} tiles)`;

    platesXml.push(
      [
        '  <plate>',
        `    <metadata key="plater_id" value="${platerId}"/>`,
        `    <metadata key="plater_name" value="${escapeXml(sanitizeName(plateTitle))}"/>`,
        '    <metadata key="locked" value="false"/>',
        ...plateInstXml,
        '  </plate>',
      ].join('\n')
    );
  });

  const mainModelXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit="millimeter" xml:lang="en-US" requiredextensions="p" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">',
    ' <metadata name="Application">BambuStudio-02.01.01.52</metadata>',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ` <metadata name="Title">${escapeXml(sanitizeName(`${title} (${plates.length} plates)`))}</metadata>`,
    ' <resources>',
    ...resourceObjects,
    ' </resources>',
    ` <build p:UUID="${makeUuid(uuidCounter++)}">`,
    ...buildItems,
    ' </build>',
    '</model>',
  ].join('\n');

  const modelSettingsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    ...configObjects,
    ...platesXml,
    '  <assemble>',
    ...assembleItems,
    '  </assemble>',
    '</config>',
  ].join('\n');

  const sliceInfoXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    '  <header>',
    '    <header_item key="X-BBL-Client-Type" value="slicer"/>',
    '    <header_item key="X-BBL-Client-Version" value="02.01.01.52"/>',
    '  </header>',
    '</config>',
  ].join('\n');

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    '</Types>',
  ].join('\n');

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />',
    '</Relationships>',
  ].join('\n');

  const modelRelsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...rels,
    '</Relationships>',
  ].join('\n');

  entries.push(
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: '3D/_rels/3dmodel.model.rels', data: modelRelsXml },
    { name: '3D/3dmodel.model', data: mainModelXml },
    { name: 'Metadata/model_settings.config', data: modelSettingsXml },
    { name: 'Metadata/slice_info.config', data: sliceInfoXml },
    { name: 'Metadata/project_settings.config', data: buildProjectSettingsJson(presetId, bedX, bedY, nozzle) }
  );

  return {
    blob: createZipBlob(entries),
    plateCount: plates.length,
    tileCount: instances.length,
  };
}

/**
 * Convenience single-drawer .3mf wrapper.
 */
export function createBambu3mfBlob(plan, modelMeshes, options = 'a1-mini') {
  const opts = typeof options === 'string' ? { presetId: options } : options;
  return createBatchBambu3mfBlob(
    [{ namePrefix: '', plan, modelMeshes }],
    {
      ...opts,
      title: `Gridfinity ${plan.cols}x${plan.rows} Drawer`,
    }
  );
}
