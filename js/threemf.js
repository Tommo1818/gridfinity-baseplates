import { createZipBlob } from './zip.js';
import { buildProjectSettingsJson } from './bambu_profile.js';

function makeUuid(seed) {
  const hex = (n, len) => (n >>> 0).toString(16).padStart(len, '0');
  return `${hex(seed * 2654435761, 8)}-${hex(seed * 2246822519, 4)}-4${hex(seed * 3266489917, 3)}-8${hex(seed * 668265263, 3)}-${hex(seed * 374761393, 8)}${hex(seed + 17, 4)}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialize a triangle mesh (positions Float32Array) into a deduplicated 3MF sub-model XML string.
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
 * Create a multi-plate Bambu Studio .3mf Blob containing every required tile
 * pre-arranged on separate build plates (Plate 1..N) with exact repeat counts.
 */
export function createBambu3mfBlob(plan, modelMeshes, presetId = 'a1-mini') {
  const entries = [];
  const rels = [];
  const resourceObjects = [];
  const buildItems = [];
  const configObjects = [];
  const platesXml = [];
  const assembleItems = [];

  const bedX = plan.bedWidthMm;
  const bedY = plan.bedDepthMm;
  const stepX = bedX * 1.2;
  const stepY = bedY * 1.2;
  const colsPerRow = 3;

  let plateIndex = 0;
  let uuidCounter = 1;

  // Store each unique mesh once in 3D/Objects/object_k.model
  const meshInfoByKey = new Map();
  plan.models.forEach((model, idx) => {
    const k = idx + 1;
    const partId = k * 2 - 1;
    const relPath = `/3D/Objects/object_${k}.model`;
    const mesh = modelMeshes.get(model.key);

    entries.push({
      name: `3D/Objects/object_${k}.model`,
      data: buildObjectModelXml(mesh, partId),
    });

    rels.push(
      ` <Relationship Target="${relPath}" Id="rel-${k}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />`
    );

    meshInfoByKey.set(model.key, { partId, relPath, triCount: mesh.triCount });
  });

  // Create one plate and wrapper object per required print copy
  for (const model of plan.models) {
    const { partId, relPath, triCount } = meshInfoByKey.get(model.key);

    for (let copy = 0; copy < model.count; copy++) {
      const pIdx = plateIndex++;
      const platerId = pIdx + 1;
      const objId = platerId * 2 + 10;
      const gridCol = pIdx % colsPerRow;
      const gridRow = Math.floor(pIdx / colsPerRow);
      const cx = +(bedX * 0.5 + gridCol * stepX).toFixed(3);
      const cy = +(bedY * 0.5 - gridRow * stepY).toFixed(3);

      const plateName =
        model.count > 1
          ? `Model ${model.label} (${copy + 1}/${model.count}) ${model.spec.nx}x${model.spec.ny}`
          : `Model ${model.label} ${model.spec.nx}x${model.spec.ny}`;

      resourceObjects.push(
        [
          `  <object id="${objId}" p:UUID="${makeUuid(uuidCounter++)}" type="model">`,
          '   <components>',
          `    <component p:path="${relPath}" objectid="${partId}" p:UUID="${makeUuid(uuidCounter++)}" transform="1 0 0 0 1 0 0 0 1 0 0 0" />`,
          '   </components>',
          '  </object>',
        ].join('\n')
      );

      buildItems.push(
        `  <item objectid="${objId}" p:UUID="${makeUuid(uuidCounter++)}" transform="1 0 0 0 1 0 0 0 1 ${cx} ${cy} 0" printable="1" />`
      );

      configObjects.push(
        [
          `  <object id="${objId}">`,
          `    <metadata key="name" value="${escapeXml(plateName)}"/>`,
          '    <metadata key="extruder" value="1"/>',
          `    <metadata face_count="${triCount}"/>`,
          `    <part id="${partId}" subtype="normal_part">`,
          `      <metadata key="name" value="${escapeXml(plateName)}"/>`,
          '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>',
          '      <metadata key="source_object_id" value="0"/>',
          '      <metadata key="source_volume_id" value="0"/>',
          '    </part>',
          '  </object>',
        ].join('\n')
      );

      platesXml.push(
        [
          '  <plate>',
          `    <metadata key="plater_id" value="${platerId}"/>`,
          `    <metadata key="plater_name" value="${escapeXml(plateName)}"/>`,
          '    <metadata key="locked" value="false"/>',
          '    <model_instance>',
          `      <metadata key="object_id" value="${objId}"/>`,
          '      <metadata key="instance_id" value="0"/>',
          `      <metadata key="identify_id" value="${100 + platerId}"/>`,
          '    </model_instance>',
          '  </plate>',
        ].join('\n')
      );

      assembleItems.push(
        `   <assemble_item object_id="${objId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ${+(bedX * 0.5).toFixed(3)} ${+(bedY * 0.5).toFixed(3)} 0" offset="0 0 0" />`
      );
    }
  }

  const mainModelXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit="millimeter" xml:lang="en-US" requiredextensions="p" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">',
    ' <metadata name="Application">BambuStudio-02.01.01.52</metadata>',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ` <metadata name="Title">${escapeXml(`Gridfinity ${plan.cols}x${plan.rows} Drawer (${plateIndex} plates)`)}</metadata>`,
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
    { name: 'Metadata/project_settings.config', data: buildProjectSettingsJson(presetId, bedX, bedY) }
  );

  return createZipBlob(entries);
}
