/**
 * Servico de elevacao (AWS Terrarium SRTM 30m + fallback Open-Meteo)
 * e calculos puros de acompanhamento de terreno (Terrain Follow).
 */

const EARTH_RADIUS_M = 6371000;
const TERRARIUM_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';
const OPEN_METEO_BATCH_SIZE = 100;
const MIN_SAFE_CLEARANCE_M = 20;

const tileCache = new Map();

/**
 * Calcula distancia geodesica (Haversine) em metros entre dois pontos WGS84.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Decodifica elevacao em metros a partir dos canais RGB de um pixel Terrarium PNG.
 * Formula: (R * 256 + G + B / 256) - 32768
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function decodeTerrariumPixel(r, g, b) {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new TypeError('Canais RGB invalidos para decodificacao Terrarium.');
  }
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Converte coordenadas WGS84 (lat, lon) em indices de tile XYZ e pixel (0..255).
 * @param {number} lat
 * @param {number} lon
 * @param {number} [zoom=12]
 * @returns {{ zoom: number, tileX: number, tileY: number, pixelX: number, pixelY: number, key: string }}
 */
export function latLonToTilePixel(lat, lon, zoom = 12) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new TypeError('Coordenadas lat/lon invalidas.');
  }
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const normalizedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const n = 2 ** zoom;

  const xFloat = ((normalizedLon + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tileX = Math.max(0, Math.min(n - 1, Math.floor(xFloat)));
  const tileY = Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
  const pixelX = Math.max(0, Math.min(255, Math.floor((xFloat - tileX) * 256)));
  const pixelY = Math.max(0, Math.min(255, Math.floor((yFloat - tileY) * 256)));

  return {
    zoom,
    tileX,
    tileY,
    pixelX,
    pixelY,
    key: `${zoom}/${tileX}/${tileY}`,
  };
}

/**
 * Adensa uma sequencia de waypoints inserindo pontos intermediarios quando um segmento
 * excede maxSegmentM, preservando os waypoints originais e seus metadados.
 * @param {Array<{ lat: number, lon: number }>} waypoints
 * @param {number} [maxSegmentM=50]
 * @returns {Array<object>}
 */
export function densifyWaypointsForTerrain(waypoints, maxSegmentM = 50) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return [];
  }
  if (waypoints.length === 1 || !Number.isFinite(maxSegmentM) || maxSegmentM <= 0) {
    return waypoints.map((wp) => ({ ...wp }));
  }

  const result = [];
  for (let i = 0; i < waypoints.length; i += 1) {
    const current = waypoints[i];
    result.push({ ...current });

    if (i === waypoints.length - 1) {
      break;
    }

    const next = waypoints[i + 1];
    const segmentM = haversineDistanceM(current.lat, current.lon, next.lat, next.lon);

    if (segmentM > maxSegmentM) {
      const steps = Math.ceil(segmentM / maxSegmentM);
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        result.push({
          ...current,
          lat: current.lat + (next.lat - current.lat) * t,
          lon: current.lon + (next.lon - current.lon) * t,
          role: 'terrain_sample',
          isMappingStart: false,
          isMappingEnd: false,
          isTerrainSample: true,
          isAuxiliary: false,
        });
      }
    }
  }

  return result;
}

/**
 * Calcula altitude relativa ao ponto de decolagem (executeHeightM),
 * altitude MSL do drone, distancia acumulada e folga real sobre o solo (clearanceM).
 * Emite alerta danger se clearanceM < 20 m.
 *
 * @param {Array<{ lat: number, lon: number, groundElevationM?: number, elevationM?: number }>} waypoints
 * @param {number} takeoffElevationM
 * @param {number} altitudeAglM
 * @param {'terrain_follow' | 'fixed'} [mode='terrain_follow']
 * @returns {{
 *   waypoints: Array<object>,
 *   alerts: Array<{ level: 'warning' | 'danger', code: string, message: string }>,
 *   stats: {
 *     takeoffElevationM: number,
 *     minClearanceM: number,
 *     maxClearanceM: number,
 *     minGroundM: number,
 *     maxGroundM: number,
 *     minExecuteHeightM: number,
 *     maxExecuteHeightM: number,
 *     hasCollisionRisk: boolean
 *   }
 * }}
 */
export function computeRelativeAltitudes(
  waypoints,
  takeoffElevationM,
  altitudeAglM,
  mode = 'terrain_follow'
) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return {
      waypoints: [],
      alerts: [],
      stats: {
        takeoffElevationM: Number.isFinite(takeoffElevationM) ? takeoffElevationM : 0,
        minClearanceM: 0,
        maxClearanceM: 0,
        minGroundM: 0,
        maxGroundM: 0,
        minExecuteHeightM: 0,
        maxExecuteHeightM: 0,
        hasCollisionRisk: false,
      },
    };
  }

  const baseTakeoff = Number.isFinite(takeoffElevationM) ? takeoffElevationM : 0;
  const targetAgl = Number.isFinite(altitudeAglM) ? altitudeAglM : 100;
  const isTerrainFollow = mode === 'terrain_follow';

  let cumulativeDistanceM = 0;
  let minClearanceM = Infinity;
  let maxClearanceM = -Infinity;
  let minGroundM = Infinity;
  let maxGroundM = -Infinity;
  let minExecuteHeightM = Infinity;
  let maxExecuteHeightM = -Infinity;

  const enriched = waypoints.map((wp, index) => {
    if (index > 0) {
      const prev = waypoints[index - 1];
      cumulativeDistanceM += haversineDistanceM(prev.lat, prev.lon, wp.lat, wp.lon);
    }

    const groundElevationM = Number.isFinite(wp.groundElevationM)
      ? wp.groundElevationM
      : Number.isFinite(wp.elevationM)
        ? wp.elevationM
        : baseTakeoff;

    const executeHeightM = isTerrainFollow
      ? targetAgl + (groundElevationM - baseTakeoff)
      : targetAgl;

    const droneAltitudeMsl = baseTakeoff + executeHeightM;
    const clearanceM = droneAltitudeMsl - groundElevationM;

    if (clearanceM < minClearanceM) minClearanceM = clearanceM;
    if (clearanceM > maxClearanceM) maxClearanceM = clearanceM;
    if (groundElevationM < minGroundM) minGroundM = groundElevationM;
    if (groundElevationM > maxGroundM) maxGroundM = groundElevationM;
    if (executeHeightM < minExecuteHeightM) minExecuteHeightM = executeHeightM;
    if (executeHeightM > maxExecuteHeightM) maxExecuteHeightM = executeHeightM;

    return {
      ...wp,
      index,
      distanceM: cumulativeDistanceM,
      groundElevationM,
      executeHeightM,
      droneAltitudeMsl,
      clearanceM,
    };
  });

  const alerts = [];
  const hasCollisionRisk = minClearanceM < MIN_SAFE_CLEARANCE_M;

  if (minClearanceM <= 0) {
    alerts.push({
      level: 'danger',
      code: 'TERRAIN_COLLISION_RISK',
      message: `Risco critico de colisao com o relevo: folga minima de ${minClearanceM.toFixed(1)} m. Ative Terrain Follow ou aumente a altitude.`,
    });
  } else if (hasCollisionRisk) {
    alerts.push({
      level: 'danger',
      code: 'LOW_TERRAIN_CLEARANCE',
      message: `Folga minima sobre o solo abaixo de ${MIN_SAFE_CLEARANCE_M} m (${minClearanceM.toFixed(1)} m). Recomenda-se ativar Terrain Follow ou elevar a altitude.`,
    });
  }

  return {
    waypoints: enriched,
    alerts,
    stats: {
      takeoffElevationM: baseTakeoff,
      minClearanceM,
      maxClearanceM,
      minGroundM,
      maxGroundM,
      minExecuteHeightM,
      maxExecuteHeightM,
      hasCollisionRisk,
    },
  };
}

/**
 * Limpa o cache em memoria de tiles Terrarium.
 */
export function clearElevationCache() {
  tileCache.clear();
}

/**
 * Carrega e decodifica um tile PNG Terrarium em dados RGBA (256x256).
 * @param {number} zoom
 * @param {number} tileX
 * @param {number} tileY
 * @param {{ fetchImpl?: Function, signal?: AbortSignal }} options
 * @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>}
 */
async function loadTerrariumTile(zoom, tileX, tileY, options = {}) {
  const key = `${zoom}/${tileX}/${tileY}`;
  if (tileCache.has(key)) {
    return tileCache.get(key);
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch indisponivel neste ambiente.');
  }

  const url = `${TERRARIUM_BASE_URL}/${zoom}/${tileX}/${tileY}.png`;
  const response = await fetchImpl(url, {
    mode: 'cors',
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Falha ao carregar tile Terrarium ${key}: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const imageData = await decodePngBlobToRgba(blob);
  tileCache.set(key, imageData);
  return imageData;
}

/**
 * Decodifica um Blob PNG para ImageData RGBA usando OffscreenCanvas ou HTMLCanvasElement.
 * @param {Blob} blob
 * @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>}
 */
async function decodePngBlobToRgba(blob) {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  }

  if (typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL !== 'undefined') {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Falha ao decodificar imagem PNG do tile Terrarium.'));
        el.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  throw new Error('Canvas indisponivel para decodificar tiles PNG Terrarium.');
}

/**
 * Consulta elevacoes em lote na Open-Meteo Elevation API (ate 100 pontos por requisicao).
 * @param {Array<{ lat: number, lon: number }>} points
 * @param {{ fetchImpl?: Function, signal?: AbortSignal }} options
 * @returns {Promise<number[]>}
 */
async function fetchOpenMeteoElevations(points, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch indisponivel para Open-Meteo.');
  }

  const results = new Array(points.length);

  for (let start = 0; start < points.length; start += OPEN_METEO_BATCH_SIZE) {
    const batch = points.slice(start, start + OPEN_METEO_BATCH_SIZE);
    const lats = batch.map((p) => p.lat.toFixed(6)).join(',');
    const lons = batch.map((p) => p.lon.toFixed(6)).join(',');
    const url = `${OPEN_METEO_URL}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lons)}`;

    const response = await fetchImpl(url, { signal: options.signal });
    if (!response.ok) {
      throw new Error(`Open-Meteo retornou HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.elevation) || payload.elevation.length !== batch.length) {
      throw new Error('Resposta invalida da Open-Meteo Elevation API.');
    }

    for (let i = 0; i < batch.length; i += 1) {
      const value = Number(payload.elevation[i]);
      if (!Number.isFinite(value)) {
        throw new Error('Valor de elevacao nao numerico retornado pela Open-Meteo.');
      }
      results[start + i] = value;
    }
  }

  return results;
}

/**
 * Consulta elevacao do terreno (metros MSL) para uma lista de pontos { lat, lon }.
 * Usa AWS Terrarium PNG (zoom 12 com cache em memoria) e recorre automaticamente
 * a Open-Meteo Elevation API em lotes de ate 100 pontos se algum tile falhar.
 *
 * @param {Array<{ lat: number, lon: number }>} points
 * @param {{ zoom?: number, fetchImpl?: Function, tileLoader?: Function, signal?: AbortSignal }} [options]
 * @returns {Promise<{ elevations: number[], source: 'terrarium' | 'open-meteo' | 'mixed', failedTiles: number }>}
 */
export async function fetchElevations(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return { elevations: [], source: 'terrarium', failedTiles: 0 };
  }

  const zoom = Number.isInteger(options.zoom) ? options.zoom : 12;
  const loader =
    typeof options.tileLoader === 'function'
      ? options.tileLoader
      : (z, x, y) => loadTerrariumTile(z, x, y, options);

  const groupedByTile = new Map();
  points.forEach((pt, idx) => {
    const info = latLonToTilePixel(pt.lat, pt.lon, zoom);
    if (!groupedByTile.has(info.key)) {
      groupedByTile.set(info.key, {
        zoom: info.zoom,
        tileX: info.tileX,
        tileY: info.tileY,
        entries: [],
      });
    }
    groupedByTile.get(info.key).entries.push({
      idx,
      pixelX: info.pixelX,
      pixelY: info.pixelY,
    });
  });

  const elevations = new Array(points.length);
  const failedIndices = [];
  let failedTiles = 0;

  const tileTasks = Array.from(groupedByTile.values()).map(async (group) => {
    try {
      const tileData = await loader(group.zoom, group.tileX, group.tileY);
      const width = tileData.width || 256;
      const rgba = tileData.data;

      for (const entry of group.entries) {
        const offset = (entry.pixelY * width + entry.pixelX) * 4;
        elevations[entry.idx] = decodeTerrariumPixel(
          rgba[offset],
          rgba[offset + 1],
          rgba[offset + 2]
        );
      }
    } catch {
      failedTiles += 1;
      for (const entry of group.entries) {
        failedIndices.push(entry.idx);
      }
    }
  });

  await Promise.all(tileTasks);

  if (failedIndices.length === 0) {
    return { elevations, source: 'terrarium', failedTiles: 0 };
  }

  const fallbackPoints = failedIndices.map((idx) => points[idx]);
  try {
    const fallbackValues = await fetchOpenMeteoElevations(fallbackPoints, options);
    for (let i = 0; i < failedIndices.length; i += 1) {
      elevations[failedIndices[i]] = fallbackValues[i];
    }
    const source = failedIndices.length === points.length ? 'open-meteo' : 'mixed';
    return { elevations, source, failedTiles };
  } catch (fallbackErr) {
    throw new Error(
      `Falha ao obter elevacao do terreno (Terrarium e Open-Meteo indisponiveis): ${fallbackErr.message}`
    );
  }
}
