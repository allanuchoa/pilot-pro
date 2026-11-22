import assert from 'node:assert/strict';

import { BUILTIN_DRONES, getDroneByKey, validateCustomDrone } from '../js/drones.js';
import { calculatePhotogrammetry } from '../js/photogrammetry.js';
import {
  computeAreaSqm,
  computeOptimalAngle,
  suggestTakeoffPoint,
  generateSimpleGrid,
  generateDoubleGrid,
  generateCorridor,
  parseAreaFile
} from '../js/geometry.js';
import {
  decodeTerrariumPixel,
  latLonToTilePixel,
  densifyWaypointsForTerrain,
  computeRelativeAltitudes
} from '../js/elevation.js';
import { splitMissionByBattery, BATTERY_PALETTE } from '../js/battery-splitter.js';
import {
  slugifyMissionName,
  buildTemplateKml,
  buildWaylinesWpml,
  exportSinglePartKmz,
  exportMissionPackage
} from '../js/wpml-exporter.js';
import {
  parseCoordinatePair,
  parseSingleCoordinate
} from '../js/map-controller.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

function makeRectPolygon(centerLat, centerLon, widthM, heightM) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const dLat = (heightM / 2) / mPerDegLat;
  const dLon = (widthM / 2) / mPerDegLon;

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [centerLon - dLon, centerLat - dLat],
        [centerLon + dLon, centerLat - dLat],
        [centerLon + dLon, centerLat + dLat],
        [centerLon - dLon, centerLat + dLat],
        [centerLon - dLon, centerLat - dLat]
      ]]
    }
  };
}

class MockJSZip {
  constructor() {
    this.entries = new Map();
  }
  file(name, content) {
    this.entries.set(name, content);
    return this;
  }
  async generateAsync(options = {}) {
    const manifest = JSON.stringify({
      type: options.type || 'uint8array',
      entries: Array.from(this.entries.keys())
    });
    return new TextEncoder().encode(manifest);
  }
}

// ============================================================================
// 1. drones.js
// ============================================================================

await test('drones.js: catalogo possui os 5 modelos oficiais DJI Fly', () => {
  assert.equal(BUILTIN_DRONES.length, 5);
  const keys = BUILTIN_DRONES.map((d) => d.drone_key);
  assert.deepEqual(keys, [
    'dji-mini-4-pro',
    'dji-mini-3-pro',
    'dji-air-3',
    'dji-air-3s',
    'dji-mavic-3'
  ]);

  const mini4 = getDroneByKey('dji-mini-4-pro');
  assert.ok(mini4);
  assert.equal(mini4.sensor_width_mm, 9.6);
  assert.equal(mini4.focal_length_mm, 6.72);
  assert.equal(mini4.image_width_px, 4032);
  assert.equal(mini4.has_mechanical_shutter, false);
});

await test('drones.js: getDroneByKey resolve perfil customizado e validateCustomDrone valida faixas', () => {
  const custom = {
    id: 'abc-123',
    name: 'DJI Air 2S Custom',
    sensor_width_mm: 13.2,
    sensor_height_mm: 8.8,
    focal_length_mm: 8.38,
    image_width_px: 5472,
    image_height_px: 3648,
    max_flight_time_min: 24,
    max_safe_speed_ms: 9.5,
    has_mechanical_shutter: false
  };

  const validRes = validateCustomDrone(custom);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.errors.length, 0);

  const found = getDroneByKey('custom:abc-123', [custom]);
  assert.ok(found);
  assert.equal(found.name, 'DJI Air 2S Custom');
  assert.equal(getDroneByKey('inexistente', [custom]), null);

  const invalidRes = validateCustomDrone({
    name: '',
    sensor_width_mm: -1,
    sensor_height_mm: 0,
    focal_length_mm: 0,
    image_width_px: 100.5,
    image_height_px: 0,
    max_flight_time_min: -5,
    max_safe_speed_ms: 0
  });
  assert.equal(invalidRes.valid, false);
  assert.ok(invalidRes.errors.length >= 4);
});

// ============================================================================
// 2. photogrammetry.js
// ============================================================================

await test('photogrammetry.js: caso de referencia Mini 4 Pro 100m 65% lateral => 50.0 m', () => {
  const mini4 = getDroneByKey('dji-mini-4-pro');
  const result = calculatePhotogrammetry(mini4, {
    altitudeM: 100,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    maxSpeedMs: 9.0,
    intervalMode: 'auto'
  });

  assert.ok(Math.abs(result.footprint.widthM - 142.857) < 0.05);
  assert.ok(Math.abs(result.lineSpacingM - 50.0) < 0.05);
  assert.ok(Math.abs(result.photoDistanceM - 26.786) < 0.1);
  assert.ok([2, 3, 4, 5].includes(result.intervalS));
  assert.equal(result.intervalS, 3);
  assert.ok(result.flightSpeedMs <= 9.0);
  assert.ok(Math.abs(result.gsdCm - 3.54) < 0.05);
});

await test('photogrammetry.js: selecao manual de intervalo e limitacao de velocidade', () => {
  const mini4 = getDroneByKey('dji-mini-4-pro');

  const manual4 = calculatePhotogrammetry(mini4, {
    altitudeM: 100,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    maxSpeedMs: 9.0,
    intervalMode: 4
  });
  assert.equal(manual4.intervalS, 4);
  assert.equal(manual4.speedLimited, false);
  assert.ok(Math.abs(manual4.flightSpeedMs - (manual4.photoDistanceM / 4)) < 0.05);

  const manual2Capped = calculatePhotogrammetry(mini4, {
    altitudeM: 100,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    maxSpeedMs: 9.0,
    intervalMode: 2
  });
  assert.equal(manual2Capped.intervalS, 2);
  assert.equal(manual2Capped.flightSpeedMs, 9.0);
  assert.equal(manual2Capped.speedLimited, true);
  assert.ok(manual2Capped.effectiveFrontOverlapPct > 75);

  // Caso onde nem dt=5s atende v_max baixo
  const limited = calculatePhotogrammetry(mini4, {
    altitudeM: 120,
    frontOverlapPct: 60,
    sideOverlapPct: 65,
    maxSpeedMs: 5.0,
    intervalMode: 'auto'
  });
  assert.equal(limited.intervalS, 5);
  assert.equal(limited.flightSpeedMs, 5.0);
  assert.equal(limited.speedLimited, true);
  assert.ok(limited.effectiveFrontOverlapPct > 60);
  assert.ok(limited.alerts.some((a) => a.code === 'OVERLAP_LIMITED'));
});

await test('photogrammetry.js: alertas de rolling shutter e altitude > 120m', () => {
  const mini4 = getDroneByKey('dji-mini-4-pro');

  const lowAlt = calculatePhotogrammetry(mini4, {
    altitudeM: 60,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    maxSpeedMs: 9.0,
    intervalMode: 'auto'
  });
  assert.ok(lowAlt.alerts.some((a) => a.code === 'ROLLING_SHUTTER' && a.level === 'warning'));

  const highAlt = calculatePhotogrammetry(mini4, {
    altitudeM: 130,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    maxSpeedMs: 9.0,
    intervalMode: 'auto'
  });
  assert.ok(highAlt.alerts.some((a) => a.code === 'ALTITUDE_HIGH'));

  const mechDrone = { ...mini4, has_mechanical_shutter: true };
  const mechLow = calculatePhotogrammetry(mechDrone, {
    altitudeM: 60,
    frontOverlapPct: 75,
    sideOverlapPct: 65,
    maxSpeedMs: 9.0,
    intervalMode: 'auto'
  });
  assert.equal(mechLow.alerts.some((a) => a.code === 'ROLLING_SHUTTER'), false);
});

// ============================================================================
// 3. geometry.js
// ============================================================================

await test('geometry.js: Grade Simples + Straighten Flight Path + area + angulo otimo', () => {
  const poly = makeRectPolygon(-15.79, -47.88, 400, 150);
  const area = computeAreaSqm(poly);
  assert.ok(area > 55000 && area < 65000, `Area esperada ~60000 m2, obtida ${area}`);

  const optAngle = computeOptimalAngle(poly);
  assert.ok(
    Math.abs(optAngle - 90) < 5 || Math.abs(optAngle - 270) < 5,
    `Angulo otimo esperado ~90 graus para retangulo Leste-Oeste, obtido ${optAngle}`
  );

  const grid = generateSimpleGrid(poly, {
    lineSpacingM: 50,
    angleDeg: optAngle,
    overshootM: 15,
    straightenFlightPath: true
  });

  assert.ok(grid.lines.length >= 3);
  assert.ok(grid.waypoints.length >= grid.lines.length * 2);
  assert.ok(
    grid.waypoints.every((wp) => wp.turnMode === 'toPointAndStopWithDiscontinuityCurvature')
  );
  assert.ok(grid.waypoints.some((wp) => wp.isAuxiliary === true));

  const takeoff = suggestTakeoffPoint(grid.waypoints);
  assert.ok(takeoff && Number.isFinite(takeoff.lat) && Number.isFinite(takeoff.lon));
});

await test('geometry.js: Grade Dupla (3D) gera duas malhas ortogonais conectadas', () => {
  const poly = makeRectPolygon(-15.79, -47.88, 250, 250);
  const simple = generateSimpleGrid(poly, {
    lineSpacingM: 50,
    angleDeg: 0,
    overshootM: 10,
    straightenFlightPath: true
  });
  const dbl = generateDoubleGrid(poly, {
    lineSpacingM: 50,
    angleDeg: 0,
    overshootM: 10,
    straightenFlightPath: true
  });

  assert.equal(dbl.stats.secondaryAngleDeg, 90);
  assert.ok(dbl.lines.length >= simple.lines.length * 2 - 2);
  assert.ok(dbl.waypoints.length > simple.waypoints.length);
});

await test('geometry.js: Corredor Linear com 1 passada central e multiplas passadas simetricas', () => {
  const line = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [-47.885, -15.790],
        [-47.880, -15.790]
      ]
    }
  };

  const singlePass = generateCorridor(line, {
    corridorWidthM: 40,
    lineSpacingM: 50,
    overshootM: 10,
    straightenFlightPath: true
  });
  assert.equal(singlePass.stats.passCount, 1);
  assert.ok(singlePass.waypoints.length >= 2);

  const multiPass = generateCorridor(line, {
    corridorWidthM: 140,
    lineSpacingM: 50,
    overshootM: 10,
    straightenFlightPath: true
  });
  assert.equal(multiPass.stats.passCount, 3);
  assert.ok(multiPass.waypoints.length > singlePass.waypoints.length);
});

await test('geometry.js: parser KML e GeoJSON valido e rejeicao de invalido', () => {
  const geojsonStr = JSON.stringify(makeRectPolygon(-15.79, -47.88, 200, 200));
  const parsedGeo = parseAreaFile('talhao.geojson', geojsonStr);
  assert.equal(parsedGeo.geometryType, 'polygon');
  assert.equal(parsedGeo.geojson.geometry.type, 'Polygon');

  const kmlPoly = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document><Placemark><Polygon><outerBoundaryIs><LinearRing>
        <coordinates>-47.89,-15.80,0 -47.88,-15.80,0 -47.88,-15.79,0 -47.89,-15.79,0 -47.89,-15.80,0</coordinates>
      </LinearRing></outerBoundaryIs></Polygon></Placemark></Document>
    </kml>`;
  const parsedKmlPoly = parseAreaFile('area.kml', kmlPoly);
  assert.equal(parsedKmlPoly.geometryType, 'polygon');
  assert.equal(parsedKmlPoly.geojson.geometry.type, 'Polygon');

  const kmlLine = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document><Placemark><LineString>
        <coordinates>-47.89,-15.80,0 -47.88,-15.79,0</coordinates>
      </LineString></Placemark></Document>
    </kml>`;
  const parsedKmlLine = parseAreaFile('estrada.kml', kmlLine);
  assert.equal(parsedKmlLine.geometryType, 'line');
  assert.equal(parsedKmlLine.geojson.geometry.type, 'LineString');

  assert.throws(() => parseAreaFile('vazio.kml', ''), /vazio|invalido/i);
  assert.throws(() => parseAreaFile('quebrado.geojson', '{invalido'), /invalido|JSON/i);
});

// ============================================================================
// 4. elevation.js
// ============================================================================

await test('elevation.js: decodeTerrariumPixel e latLonToTilePixel', () => {
  assert.equal(decodeTerrariumPixel(128, 0, 0), 0);
  assert.equal(decodeTerrariumPixel(131, 232, 0), 1000);
  assert.equal(decodeTerrariumPixel(128, 10, 128), 10.5);

  const tp = latLonToTilePixel(-15.793889, -47.882778, 12);
  assert.equal(tp.zoom, 12);
  assert.ok(tp.tileX >= 0 && tp.tileX < 4096);
  assert.ok(tp.tileY >= 0 && tp.tileY < 4096);
  assert.ok(tp.pixelX >= 0 && tp.pixelX <= 255);
  assert.ok(tp.pixelY >= 0 && tp.pixelY <= 255);
  assert.equal(tp.key, `12/${tp.tileX}/${tp.tileY}`);
});

await test('elevation.js: adensamento de waypoints e calculo h_rel / alerta clearance < 20m', () => {
  const sparse = [
    { lat: -15.7900, lon: -47.8800, groundElevationM: 1000 },
    { lat: -15.7900, lon: -47.8780, groundElevationM: 1090 }
  ];

  const densified = densifyWaypointsForTerrain(sparse, 50);
  assert.ok(densified.length > 2);
  assert.ok(densified.some((p) => p.isTerrainSample === true));

  const tf = computeRelativeAltitudes(sparse, 1000, 100, 'terrain_follow');
  assert.equal(tf.waypoints[0].executeHeightM, 100);
  assert.equal(tf.waypoints[1].executeHeightM, 190);
  assert.equal(tf.waypoints[1].clearanceM, 100);
  assert.equal(tf.stats.hasCollisionRisk, false);

  const fixed = computeRelativeAltitudes(sparse, 1000, 100, 'fixed');
  assert.equal(fixed.waypoints[0].executeHeightM, 100);
  assert.equal(fixed.waypoints[1].executeHeightM, 100);
  assert.equal(fixed.waypoints[1].clearanceM, 10);
  assert.equal(fixed.stats.hasCollisionRisk, true);
  assert.ok(fixed.alerts.some((a) => a.level === 'danger'));
});

// ============================================================================
// 5. battery-splitter.js
// ============================================================================

await test('battery-splitter.js: split multi-bateria respeita reserva 20% e limite <= 99 waypoints', () => {
  const mini4 = getDroneByKey('dji-mini-4-pro');
  const bigPoly = makeRectPolygon(-15.79, -47.88, 1800, 1800);
  const grid = generateSimpleGrid(bigPoly, {
    lineSpacingM: 40,
    angleDeg: 0,
    overshootM: 15,
    straightenFlightPath: true
  });
  const takeoff = suggestTakeoffPoint(grid.waypoints);

  const split = splitMissionByBattery(grid.waypoints, takeoff, mini4, {
    flightSpeedMs: 8.5,
    intervalS: 3,
    altitudeAglM: 100,
    reserveRatio: 0.20,
    maxWaypointsPerPart: 99
  });

  assert.ok(split.parts.length >= 2, `Esperado >= 2 partes, obtido ${split.parts.length}`);
  const maxUsableMin = mini4.max_flight_time_min * 0.80;

  split.parts.forEach((part, idx) => {
    assert.equal(part.partIndex, idx + 1);
    assert.equal(part.color, BATTERY_PALETTE[idx % BATTERY_PALETTE.length]);
    assert.ok(part.waypointCount <= 99, `Parte ${part.partIndex} excedeu 99 waypoints: ${part.waypointCount}`);
    assert.ok(part.durationMin <= maxUsableMin + 0.5, `Parte ${part.partIndex} excedeu tempo util`);
  });

  assert.equal(split.totals.batteryCount, split.parts.length);
  assert.ok(split.totals.totalDistanceM > 0);
  assert.ok(split.totals.estimatedPhotos > 0);
});

// ============================================================================
// 6. wpml-exporter.js
// ============================================================================

await test('wpml-exporter.js: XML valido template.kml e waylines.wpml (WPML vs Manual) e empacotamento', async () => {
  assert.equal(slugifyMissionName('Fazenda Sao Joao #01'), 'fazenda-sao-joao-01');

  const part1 = {
    partIndex: 1,
    distanceM: 500,
    durationS: 75,
    waypoints: [
      { lat: -15.790, lon: -47.880, executeHeightM: 100, isMappingStart: true, isMappingEnd: false, isMappingSegment: true, straighten: true, turnMode: 'toPointAndStopWithDiscontinuityCurvature' },
      { lat: -15.788, lon: -47.880, executeHeightM: 105, isMappingStart: false, isMappingEnd: true, isMappingSegment: true, straighten: true, turnMode: 'toPointAndStopWithDiscontinuityCurvature' }
    ]
  };
  const part2 = {
    partIndex: 2,
    distanceM: 480,
    durationS: 70,
    waypoints: [
      { lat: -15.788, lon: -47.879, executeHeightM: 102, isMappingStart: true, isMappingEnd: false, isMappingSegment: true, straighten: true, turnMode: 'toPointAndStopWithDiscontinuityCurvature' },
      { lat: -15.790, lon: -47.879, executeHeightM: 98, isMappingStart: false, isMappingEnd: true, isMappingSegment: true, straighten: true, turnMode: 'toPointAndStopWithDiscontinuityCurvature' }
    ]
  };

  const kml = buildTemplateKml(part1, {
    missionName: 'Teste Campo',
    finishAction: 'goHome',
    altitudeAglM: 100,
    flightSpeedMs: 8.5,
    gimbalPitchDeg: -90,
    straightenFlightPath: true
  });
  assert.ok(kml.includes('xmlns="http://www.opengis.net/kml/2.2"'));
  assert.ok(kml.includes('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"'));
  assert.ok(kml.includes('<wpml:finishAction>goHome</wpml:finishAction>'));
  assert.ok(kml.includes('<wpml:heightMode>relativeToStartPoint</wpml:heightMode>'));

  const wpmlAuto = buildWaylinesWpml(part1, {
    missionName: 'Teste Campo',
    altitudeAglM: 100,
    flightSpeedMs: 8.5,
    gimbalPitchDeg: -90,
    intervalS: 3,
    triggerMode: 'wpml',
    straightenFlightPath: true
  });
  assert.ok(wpmlAuto.includes('<coordinates>-47.88,-15.79</coordinates>'));
  assert.ok(wpmlAuto.includes('<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>'));
  assert.ok(wpmlAuto.includes('<wpml:executeHeight>105</wpml:executeHeight>'));
  assert.ok(wpmlAuto.includes('<wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>'));
  assert.ok(wpmlAuto.includes('<wpml:gimbalPitchAngle>-90</wpml:gimbalPitchAngle>'));
  assert.ok(wpmlAuto.includes('startTimeIntervalShot'));
  assert.ok(wpmlAuto.includes('stopTimeIntervalShot'));

  const wpmlManual = buildWaylinesWpml(part1, {
    missionName: 'Teste Campo',
    triggerMode: 'manual'
  });
  assert.equal(wpmlManual.includes('startTimeIntervalShot'), false);
  assert.equal(wpmlManual.includes('<wpml:actionGroup>'), false);

  const singleKmz = await exportSinglePartKmz(part1, { missionName: 'Teste Campo' }, MockJSZip);
  assert.equal(singleKmz.filename, 'teste-campo.kmz');
  const singleManifest = JSON.parse(new TextDecoder().decode(singleKmz.data));
  assert.deepEqual(singleManifest.entries, ['wpmz/template.kml', 'wpmz/waylines.wpml']);

  const multiPkg = await exportMissionPackage([part1, part2], { missionName: 'Teste Campo' }, MockJSZip);
  assert.equal(multiPkg.isMultiPart, true);
  assert.equal(multiPkg.filename, 'teste-campo.zip');
  const multiManifest = JSON.parse(new TextDecoder().decode(multiPkg.data));
  assert.deepEqual(multiManifest.entries, ['teste-campo_parte1.kmz', 'teste-campo_parte2.kmz']);
});

// ============================================================================
// 7. map-controller.js (parseCoordinatePair / parseSingleCoordinate)
// ============================================================================

await test('map-controller.js: parseCoordinatePair interpreta Google Earth, decimais com ° e GMS/DMS', () => {
  const geDeg = parseCoordinatePair('-3.964863°, -38.377869°');
  assert.ok(geDeg);
  assert.ok(Math.abs(geDeg.lat - (-3.964863)) < 1e-6);
  assert.ok(Math.abs(geDeg.lon - (-38.377869)) < 1e-6);

  const plainComma = parseCoordinatePair('-3.964863, -38.377869');
  assert.ok(plainComma);
  assert.equal(plainComma.lat, -3.964863);
  assert.equal(plainComma.lon, -38.377869);

  const spaceSep = parseCoordinatePair('-3.964863 -38.377869');
  assert.ok(spaceSep);
  assert.equal(spaceSep.lat, -3.964863);
  assert.equal(spaceSep.lon, -38.377869);

  const semiSep = parseCoordinatePair('-3.964863; -38.377869');
  assert.ok(semiSep);
  assert.equal(semiSep.lat, -3.964863);

  const dms = parseCoordinatePair('3°57\'53.5"S 38°22\'40.3"W');
  assert.ok(dms);
  assert.ok(Math.abs(dms.lat - (-3.964861)) < 0.0001);
  assert.ok(Math.abs(dms.lon - (-38.377861)) < 0.0001);

  assert.equal(parseSingleCoordinate('-3.964863°'), -3.964863);
  assert.equal(parseCoordinatePair('95.0, -38.37'), null);
  assert.equal(parseCoordinatePair('texto invalido'), null);
});

console.log(`\nResumo: ${passed} passou, ${failed} falhou.`);
if (failed > 0) {
  process.exit(1);
}
