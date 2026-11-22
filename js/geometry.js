// Motor geometrico puro para Grade Simples, Grade Dupla (3D), Corredor Linear e importacao KML/GeoJSON.
// Funciona nativamente em navegador e Node.js sem dependencia obrigatoria de DOM ou bibliotecas externas.

const EARTH_RADIUS_M = 6371008.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function roundTo(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeAngleDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

/**
 * Distancia geodesica Haversine em metros entre dois pontos ({lat, lon} ou [lon, lat]).
 * @param {{lat: number, lon: number}|[number, number]} a
 * @param {{lat: number, lon: number}|[number, number]} b
 * @returns {number}
 */
export function haversineDistanceM(a, b) {
  const lat1 = Array.isArray(a) ? a[1] : a.lat;
  const lon1 = Array.isArray(a) ? a[0] : a.lon;
  const lat2 = Array.isArray(b) ? b[1] : b.lat;
  const lon2 = Array.isArray(b) ? b[0] : b.lon;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(rLat1) * Math.cos(rLat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cria projecao metrica local (plano tangente WGS84) centrada na media das coordenadas [lon, lat].
 * @param {Array<[number, number]>} coords
 */
function createLocalProjection(coords) {
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of coords) {
    sumLon += lon;
    sumLat += lat;
  }
  const refLon = sumLon / coords.length;
  const refLat = sumLat / coords.length;
  const latRad = toRad(refLat);

  // Comprimento de 1 grau em latitude e longitude no elipsoide WGS84
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = Math.max(1e-6, 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad));

  return {
    refLon,
    refLat,
    toLocal([lon, lat]) {
      return {
        x: (lon - refLon) * mPerDegLon,
        y: (lat - refLat) * mPerDegLat
      };
    },
    toGeo(x, y) {
      return {
        lon: roundTo(refLon + x / mPerDegLon, 7),
        lat: roundTo(refLat + y / mPerDegLat, 7)
      };
    }
  };
}

/**
 * Extrai os aneis de coordenadas de um Polygon/MultiPolygon/Feature/FeatureCollection GeoJSON.
 * @param {object} geojson
 * @returns {Array<Array<[number, number]>>}
 */
function extractPolygonRings(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    throw new Error('GeoJSON de poligono invalido.');
  }

  let geom = geojson;
  if (geom.type === 'FeatureCollection') {
    const feat = Array.isArray(geom.features)
      ? geom.features.find((f) => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
      : null;
    if (!feat) {
      throw new Error('Nenhum poligono encontrado na FeatureCollection.');
    }
    geom = feat.geometry;
  } else if (geom.type === 'Feature') {
    geom = geom.geometry;
  }

  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
    throw new Error('Geometria esperada deve ser Polygon ou MultiPolygon.');
  }

  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates[0];
  if (!Array.isArray(rings) || !Array.isArray(rings[0]) || rings[0].length < 4) {
    throw new Error('Poligono deve possuir pelo menos 3 vertices distintos (anel fechado com 4 pontos).');
  }

  return rings.map((ring) =>
    ring.map((pt) => {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw new Error('Coordenadas invalidas encontradas no poligono.');
      }
      return [lon, lat];
    })
  );
}

/**
 * Extrai coordenadas de uma LineString/Feature/FeatureCollection GeoJSON.
 * @param {object} geojson
 * @returns {Array<[number, number]>}
 */
function extractLineCoords(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    throw new Error('GeoJSON de linha invalido.');
  }

  let geom = geojson;
  if (geom.type === 'FeatureCollection') {
    const feat = Array.isArray(geom.features)
      ? geom.features.find((f) => f && f.geometry && f.geometry.type === 'LineString')
      : null;
    if (!feat) {
      throw new Error('Nenhuma LineString encontrada na FeatureCollection.');
    }
    geom = feat.geometry;
  } else if (geom.type === 'Feature') {
    geom = geom.geometry;
  }

  if (!geom || geom.type !== 'LineString') {
    throw new Error('Geometria esperada deve ser LineString.');
  }

  if (!Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
    throw new Error('Corredor Linear exige pelo menos 2 vertices.');
  }

  return geom.coordinates.map((pt) => {
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('Coordenadas invalidas encontradas na LineString.');
    }
    return [lon, lat];
  });
}

function ringAreaShoelace(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    sum += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Calcula a area em metros quadrados de um poligono GeoJSON.
 * @param {object} polygonGeoJson
 * @returns {number}
 */
export function computeAreaSqm(polygonGeoJson) {
  const rings = extractPolygonRings(polygonGeoJson);
  const outer = rings[0];
  const proj = createLocalProjection(outer);
  const outerLocal = outer.map((pt) => proj.toLocal(pt));

  let area = ringAreaShoelace(outerLocal);
  for (let i = 1; i < rings.length; i += 1) {
    const holeLocal = rings[i].map((pt) => proj.toLocal(pt));
    area -= ringAreaShoelace(holeLocal);
  }
  return Math.max(0, roundTo(area, 2));
}

/**
 * Fecho convexo (Andrew's monotone chain) em coordenadas locais 2D.
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<{x: number, y: number}>}
 */
function convexHull2D(points) {
  const pts = points
    .slice()
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  if (pts.length <= 2) {
    return pts;
  }

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Calcula o azimute otimo (0 a 180 graus a partir do Norte) alinhado a maior aresta do fecho convexo.
 * @param {object} polygonGeoJson
 * @returns {number}
 */
export function computeOptimalAngle(polygonGeoJson) {
  const rings = extractPolygonRings(polygonGeoJson);
  const outer = rings[0];
  const proj = createLocalProjection(outer);
  const uniquePts = outer.slice(0, -1).map((pt) => proj.toLocal(pt));
  const hull = convexHull2D(uniquePts);

  if (hull.length < 2) {
    return 0;
  }

  let bestLenSq = -1;
  let bestDx = 0;
  let bestDy = 1;

  for (let i = 0; i < hull.length; i += 1) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > bestLenSq) {
      bestLenSq = lenSq;
      bestDx = dx;
      bestDy = dy;
    }
  }

  // Azimute horario a partir do Norte (+Y)
  const azimuth = (toDeg(Math.atan2(bestDx, bestDy)) + 360) % 180;
  return roundTo(azimuth, 1);
}

/**
 * Sugere o ponto de decolagem padrao a partir da sequencia de waypoints gerada.
 * @param {Array<{lat: number, lon: number}>} waypoints
 * @returns {{lat: number, lon: number}|null}
 */
export function suggestTakeoffPoint(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return null;
  }
  const first = waypoints[0];
  if (!first || !Number.isFinite(first.lat) || !Number.isFinite(first.lon)) {
    return null;
  }
  return {
    lat: roundTo(first.lat, 7),
    lon: roundTo(first.lon, 7)
  };
}

/**
 * Constroi os waypoints de um segmento de linha aplicando Straighten Flight Path quando ativo.
 */
function buildLineWaypoints(startGeo, endGeo, meta) {
  const {
    lineIndex,
    passIndex,
    straightenFlightPath,
    straightenOffsetM,
    isFirstInPass,
    isLastInPass
  } = meta;

  const turnMode = straightenFlightPath
    ? 'toPointAndStopWithDiscontinuityCurvature'
    : 'coordinateTurn';

  const segLen = haversineDistanceM(startGeo, endGeo);
  const points = [];

  points.push({
    lat: startGeo.lat,
    lon: startGeo.lon,
    lineIndex,
    passIndex,
    role: 'line_start',
    isMappingStart: isFirstInPass,
    isMappingEnd: false,
    isMappingSegment: true,
    isAuxiliary: false,
    straighten: Boolean(straightenFlightPath),
    turnMode
  });

  if (straightenFlightPath && segLen > straightenOffsetM * 2 + 4) {
    const ratioStart = straightenOffsetM / segLen;
    const ratioEnd = 1 - ratioStart;

    points.push({
      lat: roundTo(startGeo.lat + (endGeo.lat - startGeo.lat) * ratioStart, 7),
      lon: roundTo(startGeo.lon + (endGeo.lon - startGeo.lon) * ratioStart, 7),
      lineIndex,
      passIndex,
      role: 'straighten_aux',
      isMappingStart: false,
      isMappingEnd: false,
      isMappingSegment: true,
      isAuxiliary: true,
      straighten: true,
      turnMode
    });

    points.push({
      lat: roundTo(startGeo.lat + (endGeo.lat - startGeo.lat) * ratioEnd, 7),
      lon: roundTo(startGeo.lon + (endGeo.lon - startGeo.lon) * ratioEnd, 7),
      lineIndex,
      passIndex,
      role: 'straighten_aux',
      isMappingStart: false,
      isMappingEnd: false,
      isMappingSegment: true,
      isAuxiliary: true,
      straighten: true,
      turnMode
    });
  }

  points.push({
    lat: endGeo.lat,
    lon: endGeo.lon,
    lineIndex,
    passIndex,
    role: 'line_end',
    isMappingStart: false,
    isMappingEnd: isLastInPass,
    isMappingSegment: !isLastInPass,
    isAuxiliary: false,
    straighten: Boolean(straightenFlightPath),
    turnMode
  });

  return points;
}

function computeWaypointStats(waypoints, extra = {}) {
  let totalDistanceM = 0;
  let mappingDistanceM = 0;

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const d = haversineDistanceM(waypoints[i], waypoints[i + 1]);
    totalDistanceM += d;
    if (waypoints[i].isMappingSegment) {
      mappingDistanceM += d;
    }
  }

  return {
    waypointCount: waypoints.length,
    totalDistanceM: roundTo(totalDistanceM, 2),
    mappingDistanceM: roundTo(mappingDistanceM, 2),
    ...extra
  };
}

/**
 * Gera uma Grade Simples (boustrophedon) sobre um poligono GeoJSON.
 * @param {object} polygonGeoJson
 * @param {object} options
 * @param {number} options.lineSpacingM Espacamento lateral entre linhas em metros
 * @param {number} [options.angleDeg] Azimute das linhas (0..359); padrao: angulo otimo
 * @param {number} [options.overshootM=15] Extensao nas cabeceiras de cada linha em metros
 * @param {boolean} [options.reverseDirection=false] Inverte ordem das linhas
 * @param {boolean} [options.straightenFlightPath=true] Ativa retificacao de trajetoria
 * @param {number} [options.straightenOffsetM] Distancia dos pontos auxiliares de alinhamento
 * @returns {{ waypoints: Array<object>, lines: Array<object>, stats: object }}
 */
export function generateSimpleGrid(polygonGeoJson, options = {}) {
  const lineSpacingM = Number(options.lineSpacingM);
  if (!Number.isFinite(lineSpacingM) || lineSpacingM <= 0) {
    throw new Error('lineSpacingM deve ser um numero positivo.');
  }

  const overshootM = Math.max(0, Number(options.overshootM ?? 15));
  const reverseDirection = Boolean(options.reverseDirection);
  const straightenFlightPath = options.straightenFlightPath !== false;
  const flipParity = Boolean(options._flipParity);
  const passIndex = Number(options._passIndex ?? 1);
  const straightenOffsetM = Number.isFinite(options.straightenOffsetM)
    ? Math.max(1, Number(options.straightenOffsetM))
    : Math.min(3.5, Math.max(1.5, lineSpacingM * 0.06));

  const angleDeg = options.angleDeg !== undefined && options.angleDeg !== null
    ? normalizeAngleDeg(options.angleDeg)
    : computeOptimalAngle(polygonGeoJson);

  const rings = extractPolygonRings(polygonGeoJson);
  const outer = rings[0];
  const proj = createLocalProjection(outer);
  const localRing = outer.map((pt) => proj.toLocal(pt));

  // Rotacao para o sistema da linha: eixo u ao longo do azimute, eixo v perpendicular
  const rad = toRad(angleDeg);
  const sinA = Math.sin(rad);
  const cosA = Math.cos(rad);

  const uvRing = localRing.map(({ x, y }) => ({
    u: x * sinA + y * cosA,
    v: x * cosA - y * sinA
  }));

  let vMin = Infinity;
  let vMax = -Infinity;
  for (const pt of uvRing) {
    if (pt.v < vMin) vMin = pt.v;
    if (pt.v > vMax) vMax = pt.v;
  }

  const spanV = vMax - vMin;
  if (spanV <= 1e-6) {
    return {
      waypoints: [],
      lines: [],
      stats: { lineCount: 0, waypointCount: 0, totalDistanceM: 0, mappingDistanceM: 0, angleDeg }
    };
  }

  const lineCount = Math.max(1, Math.ceil(spanV / lineSpacingM));
  const vPositions = [];
  if (lineCount === 1) {
    vPositions.push((vMin + vMax) / 2);
  } else {
    const totalGridSpan = (lineCount - 1) * lineSpacingM;
    const vStart = (vMin + vMax) / 2 - totalGridSpan / 2;
    for (let i = 0; i < lineCount; i += 1) {
      vPositions.push(vStart + i * lineSpacingM);
    }
  }

  const rawLines = [];
  for (const vTarget of vPositions) {
    // Evita degenerescencia exata em vertices horizontais
    const vScan = Math.min(vMax - 1e-6, Math.max(vMin + 1e-6, vTarget));
    const uIntersections = [];

    for (let i = 0; i < uvRing.length - 1; i += 1) {
      const p1 = uvRing[i];
      const p2 = uvRing[i + 1];
      if ((p1.v <= vScan && p2.v > vScan) || (p2.v <= vScan && p1.v > vScan)) {
        const t = (vScan - p1.v) / (p2.v - p1.v);
        uIntersections.push(p1.u + t * (p2.u - p1.u));
      }
    }

    if (uIntersections.length >= 2) {
      uIntersections.sort((a, b) => a - b);
      const uStart = uIntersections[0] - overshootM;
      const uEnd = uIntersections[uIntersections.length - 1] + overshootM;
      rawLines.push({ v: vTarget, uStart, uEnd });
    }
  }

  if (reverseDirection) {
    rawLines.reverse();
  }

  const waypoints = [];
  const lines = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const forward = flipParity ? i % 2 === 1 : i % 2 === 0;
    const u0 = forward ? line.uStart : line.uEnd;
    const u1 = forward ? line.uEnd : line.uStart;

    const x0 = u0 * sinA + line.v * cosA;
    const y0 = u0 * cosA - line.v * sinA;
    const x1 = u1 * sinA + line.v * cosA;
    const y1 = u1 * cosA - line.v * sinA;

    const startGeo = proj.toGeo(x0, y0);
    const endGeo = proj.toGeo(x1, y1);

    const lineWps = buildLineWaypoints(startGeo, endGeo, {
      lineIndex: i,
      passIndex,
      straightenFlightPath,
      straightenOffsetM,
      isFirstInPass: true,
      isLastInPass: true
    });

    for (const wp of lineWps) {
      waypoints.push({
        ...wp,
        index: waypoints.length
      });
    }

    lines.push({
      lineIndex: i,
      passIndex,
      start: startGeo,
      end: endGeo,
      lengthM: roundTo(haversineDistanceM(startGeo, endGeo), 2)
    });
  }

  return {
    waypoints,
    lines,
    stats: computeWaypointStats(waypoints, {
      lineCount: lines.length,
      angleDeg
    })
  };
}

/**
 * Gera uma Grade Dupla (3D) ortogonal conectando a segunda malha pela extremidade mais proxima da primeira.
 * @param {object} polygonGeoJson
 * @param {object} options
 * @returns {{ waypoints: Array<object>, lines: Array<object>, stats: object }}
 */
export function generateDoubleGrid(polygonGeoJson, options = {}) {
  const primaryAngle = options.angleDeg !== undefined && options.angleDeg !== null
    ? normalizeAngleDeg(options.angleDeg)
    : computeOptimalAngle(polygonGeoJson);
  const secondaryAngle = normalizeAngleDeg(primaryAngle + 90);

  const pass1 = generateSimpleGrid(polygonGeoJson, {
    ...options,
    angleDeg: primaryAngle,
    _passIndex: 1
  });

  if (pass1.waypoints.length === 0) {
    return {
      waypoints: [],
      lines: [],
      stats: {
        lineCount: 0,
        waypointCount: 0,
        totalDistanceM: 0,
        mappingDistanceM: 0,
        angleDeg: primaryAngle,
        secondaryAngleDeg: secondaryAngle
      }
    };
  }

  const lastWpPass1 = pass1.waypoints[pass1.waypoints.length - 1];

  // Avalia as 4 combinacoes de entrada da segunda malha para minimizar deslocamento ocioso
  const candidates = [
    { reverseDirection: false, _flipParity: false },
    { reverseDirection: false, _flipParity: true },
    { reverseDirection: true, _flipParity: false },
    { reverseDirection: true, _flipParity: true }
  ].map((variant) =>
    generateSimpleGrid(polygonGeoJson, {
      ...options,
      angleDeg: secondaryAngle,
      reverseDirection: variant.reverseDirection,
      _flipParity: variant._flipParity,
      _passIndex: 2
    })
  );

  let bestPass2 = candidates[0];
  let bestDist = Infinity;

  for (const cand of candidates) {
    if (cand.waypoints.length === 0) continue;
    const dist = haversineDistanceM(lastWpPass1, cand.waypoints[0]);
    if (dist < bestDist) {
      bestDist = dist;
      bestPass2 = cand;
    }
  }

  const lineOffset = pass1.lines.length;
  const combinedLines = pass1.lines.concat(
    bestPass2.lines.map((line, idx) => ({
      ...line,
      lineIndex: lineOffset + idx,
      passIndex: 2
    }))
  );

  const combinedWaypoints = pass1.waypoints.concat(
    bestPass2.waypoints.map((wp) => ({
      ...wp,
      lineIndex: lineOffset + wp.lineIndex,
      passIndex: 2
    }))
  ).map((wp, idx) => ({
    ...wp,
    index: idx
  }));

  return {
    waypoints: combinedWaypoints,
    lines: combinedLines,
    stats: computeWaypointStats(combinedWaypoints, {
      lineCount: combinedLines.length,
      angleDeg: primaryAngle,
      secondaryAngleDeg: secondaryAngle,
      transitionDistanceM: roundTo(bestDist, 2)
    })
  };
}

/**
 * Calcula uma polilinha paralela deslocada lateralmente por `offsetM` com extensao `overshootM` nas pontas.
 */
function offsetPolyline2D(pts, offsetM, overshootM) {
  const n = pts.length;
  const segNormals = [];
  const segDirs = [];

  for (let i = 0; i < n - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len;
    const uy = dy / len;
    segDirs.push({ x: ux, y: uy });
    // Normal a esquerda
    segNormals.push({ x: -uy, y: ux });
  }

  const result = [];
  const miterLimit = Math.max(Math.abs(offsetM) * 2.5, 1);

  for (let i = 0; i < n; i += 1) {
    if (i === 0) {
      const norm = segNormals[0];
      const dir = segDirs[0];
      result.push({
        x: pts[0].x + norm.x * offsetM - dir.x * overshootM,
        y: pts[0].y + norm.y * offsetM - dir.y * overshootM
      });
    } else if (i === n - 1) {
      const norm = segNormals[n - 2];
      const dir = segDirs[n - 2];
      result.push({
        x: pts[n - 1].x + norm.x * offsetM + dir.x * overshootM,
        y: pts[n - 1].y + norm.y * offsetM + dir.y * overshootM
      });
    } else {
      const n1 = segNormals[i - 1];
      const n2 = segNormals[i];
      let mx = n1.x + n2.x;
      let my = n1.y + n2.y;
      const mLen = Math.hypot(mx, my);

      if (mLen < 1e-6) {
        result.push({
          x: pts[i].x + n1.x * offsetM,
          y: pts[i].y + n1.y * offsetM
        });
      } else {
        mx /= mLen;
        my /= mLen;
        const dot = mx * n1.x + my * n1.y;
        const scale = dot > 0.2 ? Math.min(Math.abs(offsetM) / dot, miterLimit) * Math.sign(offsetM) : offsetM;
        result.push({
          x: pts[i].x + mx * scale,
          y: pts[i].y + my * scale
        });
      }
    }
  }

  return result;
}

/**
 * Gera um plano de Corredor Linear com passadas paralelas simetricas cobrindo toda a largura configurada.
 * @param {object} lineStringGeoJson
 * @param {object} options
 * @param {number} [options.corridorWidthM=50] Largura total da faixa do corredor em metros
 * @param {number} options.lineSpacingM Espacamento lateral entre passadas em metros
 * @param {number} [options.overshootM=15] Extensao nas extremidades em metros
 * @param {boolean} [options.reverseDirection=false] Inverte ordem das passadas
 * @param {boolean} [options.straightenFlightPath=true] Ativa retificacao de trajetoria
 * @returns {{ waypoints: Array<object>, lines: Array<object>, stats: object }}
 */
export function generateCorridor(lineStringGeoJson, options = {}) {
  const lineSpacingM = Number(options.lineSpacingM);
  if (!Number.isFinite(lineSpacingM) || lineSpacingM <= 0) {
    throw new Error('lineSpacingM deve ser um numero positivo.');
  }

  const corridorWidthM = Number(options.corridorWidthM ?? 50);
  if (!Number.isFinite(corridorWidthM) || corridorWidthM <= 0) {
    throw new Error('corridorWidthM deve ser um numero positivo.');
  }

  const overshootM = Math.max(0, Number(options.overshootM ?? 15));
  const reverseDirection = Boolean(options.reverseDirection);
  const straightenFlightPath = options.straightenFlightPath !== false;
  const straightenOffsetM = Number.isFinite(options.straightenOffsetM)
    ? Math.max(1, Number(options.straightenOffsetM))
    : Math.min(3.5, Math.max(1.5, lineSpacingM * 0.06));

  const coords = extractLineCoords(lineStringGeoJson);
  const proj = createLocalProjection(coords);
  const localPts = coords.map((pt) => proj.toLocal(pt));

  const passCount = Math.max(1, Math.ceil(corridorWidthM / lineSpacingM));
  const offsets = [];
  for (let i = 0; i < passCount; i += 1) {
    offsets.push((i - (passCount - 1) / 2) * lineSpacingM);
  }

  if (reverseDirection) {
    offsets.reverse();
  }

  const waypoints = [];
  const lines = [];

  for (let p = 0; p < offsets.length; p += 1) {
    const offsetM = offsets[p];
    const passPts2D = offsetPolyline2D(localPts, offsetM, overshootM);
    const ordered2D = p % 2 === 0 ? passPts2D : passPts2D.slice().reverse();
    const geoPts = ordered2D.map((pt) => proj.toGeo(pt.x, pt.y));

    let passLengthM = 0;
    for (let s = 0; s < geoPts.length - 1; s += 1) {
      const startGeo = geoPts[s];
      const endGeo = geoPts[s + 1];
      passLengthM += haversineDistanceM(startGeo, endGeo);

      const segWps = buildLineWaypoints(startGeo, endGeo, {
        lineIndex: p,
        passIndex: 1,
        straightenFlightPath,
        straightenOffsetM,
        isFirstInPass: s === 0,
        isLastInPass: s === geoPts.length - 2
      });

      // Evita duplicar vertice intermediario compartilhado entre segmentos consecutivos da mesma passada
      const startSlice = s === 0 ? 0 : 1;
      for (let k = startSlice; k < segWps.length; k += 1) {
        waypoints.push({
          ...segWps[k],
          index: waypoints.length
        });
      }
    }

    lines.push({
      lineIndex: p,
      passIndex: 1,
      offsetM: roundTo(offsetM, 2),
      points: geoPts,
      start: geoPts[0],
      end: geoPts[geoPts.length - 1],
      lengthM: roundTo(passLengthM, 2)
    });
  }

  return {
    waypoints,
    lines,
    stats: computeWaypointStats(waypoints, {
      passCount,
      lineCount: lines.length,
      corridorWidthM
    })
  };
}

function validateCoordTuple(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function ensureClosedRing(ring) {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return ring.concat([[first[0], first[1]]]);
  }
  return ring;
}

function parseGeoJsonContent(contentText) {
  let parsed;
  try {
    parsed = JSON.parse(contentText);
  } catch (err) {
    throw new Error(`Arquivo GeoJSON invalido: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Conteudo GeoJSON vazio ou malformado.');
  }

  const warnings = [];
  let geometry = null;

  if (parsed.type === 'FeatureCollection') {
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
      throw new Error('FeatureCollection nao contem nenhuma geometria.');
    }
    const supported = parsed.features.filter(
      (f) => f && f.geometry && ['Polygon', 'MultiPolygon', 'LineString'].includes(f.geometry.type)
    );
    if (supported.length === 0) {
      throw new Error('Nenhuma geometria Polygon, MultiPolygon ou LineString encontrada no GeoJSON.');
    }
    if (supported.length > 1) {
      warnings.push(`Arquivo possui ${supported.length} geometrias. Apenas a primeira foi importada.`);
    }
    geometry = supported[0].geometry;
  } else if (parsed.type === 'Feature') {
    geometry = parsed.geometry;
  } else if (['Polygon', 'MultiPolygon', 'LineString'].includes(parsed.type)) {
    geometry = parsed;
  } else {
    throw new Error(`Tipo GeoJSON nao suportado: ${parsed.type || 'desconhecido'}.`);
  }

  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    let rawOuter = geometry.type === 'Polygon'
      ? geometry.coordinates?.[0]
      : geometry.coordinates?.[0]?.[0];

    if (geometry.type === 'MultiPolygon' && geometry.coordinates.length > 1) {
      warnings.push('MultiPolygon detectado. Apenas o primeiro poligono foi importado.');
    }

    if (!Array.isArray(rawOuter) || rawOuter.length < 3) {
      throw new Error('Poligono GeoJSON deve ter pelo menos 3 vertices validos.');
    }

    const cleaned = rawOuter.map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) {
        throw new Error('Coordenada de poligono malformada no GeoJSON.');
      }
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!validateCoordTuple(lon, lat)) {
        throw new Error('Coordenadas fora dos limites geograficos WGS84 no GeoJSON.');
      }
      return [lon, lat];
    });

    const closed = ensureClosedRing(cleaned);
    if (closed.length < 4) {
      throw new Error('Poligono GeoJSON invalido apos fechamento do anel.');
    }

    return {
      geometryType: 'polygon',
      geojson: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [closed]
        }
      },
      warnings
    };
  }

  if (geometry.type === 'LineString') {
    const rawCoords = geometry.coordinates;
    if (!Array.isArray(rawCoords) || rawCoords.length < 2) {
      throw new Error('LineString GeoJSON deve ter pelo menos 2 vertices.');
    }

    const cleaned = rawCoords.map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) {
        throw new Error('Coordenada de linha malformada no GeoJSON.');
      }
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!validateCoordTuple(lon, lat)) {
        throw new Error('Coordenadas fora dos limites geograficos WGS84 no GeoJSON.');
      }
      return [lon, lat];
    });

    return {
      geometryType: 'line',
      geojson: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: cleaned
        }
      },
      warnings
    };
  }

  throw new Error('Tipo de geometria GeoJSON nao suportado.');
}

function parseKmlCoordinatesText(coordText) {
  const tokens = coordText.trim().split(/\s+/).filter(Boolean);
  const coords = [];

  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length < 2) {
      throw new Error(`Tupla de coordenadas KML invalida: "${token}".`);
    }
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!validateCoordTuple(lon, lat)) {
      throw new Error(`Coordenadas KML fora dos limites WGS84: "${token}".`);
    }
    coords.push([lon, lat]);
  }

  return coords;
}

function parseKmlContent(contentText) {
  const warnings = [];
  const polygonMatches = [...contentText.matchAll(/<Polygon\b[^>]*>([\s\S]*?)<\/Polygon>/gi)];
  const lineMatches = [...contentText.matchAll(/<LineString\b[^>]*>([\s\S]*?)<\/LineString>/gi)];

  if (polygonMatches.length === 0 && lineMatches.length === 0) {
    throw new Error('Nenhum elemento <Polygon> ou <LineString> encontrado no arquivo KML.');
  }

  const firstPolygonIdx = polygonMatches.length > 0 ? polygonMatches[0].index : Infinity;
  const firstLineIdx = lineMatches.length > 0 ? lineMatches[0].index : Infinity;

  if (polygonMatches.length + lineMatches.length > 1) {
    warnings.push('Arquivo KML contem multiplas geometrias. Apenas a primeira foi importada.');
  }

  if (firstPolygonIdx < firstLineIdx) {
    const polyBlock = polygonMatches[0][1];
    const outerMatch = polyBlock.match(/<outerBoundaryIs\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)
      || polyBlock.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);

    if (!outerMatch) {
      throw new Error('Tag <coordinates> ausente dentro do <Polygon> KML.');
    }

    const coords = parseKmlCoordinatesText(outerMatch[1]);
    const closed = ensureClosedRing(coords);
    if (closed.length < 4) {
      throw new Error('Poligono KML deve possuir pelo menos 3 vertices distintos.');
    }

    return {
      geometryType: 'polygon',
      geojson: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [closed]
        }
      },
      warnings
    };
  }

  const lineBlock = lineMatches[0][1];
  const coordMatch = lineBlock.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
  if (!coordMatch) {
    throw new Error('Tag <coordinates> ausente dentro da <LineString> KML.');
  }

  const coords = parseKmlCoordinatesText(coordMatch[1]);
  if (coords.length < 2) {
    throw new Error('LineString KML deve possuir pelo menos 2 vertices.');
  }

  return {
    geometryType: 'line',
    geojson: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: coords
      }
    },
    warnings
  };
}

/**
 * Faz o parsing de um arquivo local .geojson ou .kml sem depender de DOMParser.
 * @param {string} filename Nome do arquivo
 * @param {string} contentText Conteudo textual do arquivo
 * @returns {{ geometryType: 'polygon'|'line', geojson: object, warnings: string[] }}
 */
export function parseAreaFile(filename, contentText) {
  if (typeof contentText !== 'string' || !contentText.trim()) {
    throw new Error('Arquivo de area vazio.');
  }

  const trimmed = contentText.trim();
  const lowerName = String(filename || '').toLowerCase();

  if (lowerName.endsWith('.kml') || (!lowerName.endsWith('.geojson') && !lowerName.endsWith('.json') && trimmed.startsWith('<'))) {
    return parseKmlContent(trimmed);
  }

  if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json') || trimmed.startsWith('{')) {
    return parseGeoJsonContent(trimmed);
  }

  throw new Error('Formato de arquivo nao suportado. Utilize .geojson ou .kml.');
}
