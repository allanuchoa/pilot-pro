// Estimador de telemetria operacional e divisor automatico de missoes multi-bateria.

import { haversineDistanceM } from './geometry.js';

export const BATTERY_PALETTE = Object.freeze([
  '#00d992',
  '#38bdf8',
  '#f59e0b',
  '#a78bfa'
]);

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Estima tempo e metricas de uma parte de missao incluindo subida, transito, paradas, retorno e descida.
 */
function evaluatePartMetrics(partWaypoints, takeoffPoint, config) {
  const {
    flightSpeedMs,
    transitionSpeedMs,
    intervalS,
    altitudeAglM,
    climbSpeedMs,
    descentSpeedMs,
    turnStopTimeS
  } = config;

  const firstWp = partWaypoints[0];
  const lastWp = partWaypoints[partWaypoints.length - 1];

  const startAltM = Math.max(
    10,
    Number(firstWp.executeHeightM ?? firstWp.relativeAltM ?? firstWp.altitudeAglM ?? altitudeAglM)
  );
  const endAltM = Math.max(
    10,
    Number(lastWp.executeHeightM ?? lastWp.relativeAltM ?? lastWp.altitudeAglM ?? altitudeAglM)
  );

  const climbTimeS = startAltM / climbSpeedMs;
  const descentTimeS = endAltM / descentSpeedMs;

  const transitToStartM = haversineDistanceM(takeoffPoint, firstWp);
  const returnToHomeM = haversineDistanceM(lastWp, takeoffPoint);
  const transitToStartS = transitToStartM / transitionSpeedMs;
  const returnToHomeS = returnToHomeM / transitionSpeedMs;

  let routeDistanceM = 0;
  let mappingDistanceM = 0;
  let routeTimeS = 0;
  let mappingTimeS = 0;
  let turnStopCount = 0;
  let mappingLineStarts = 0;

  for (let i = 0; i < partWaypoints.length; i += 1) {
    const wp = partWaypoints[i];
    if (!wp.isAuxiliary && !wp.isTerrainSample) {
      turnStopCount += 1;
    }
    if (wp.isMappingStart) {
      mappingLineStarts += 1;
    }

    if (i < partWaypoints.length - 1) {
      const nextWp = partWaypoints[i + 1];
      const segDist = haversineDistanceM(wp, nextWp);
      routeDistanceM += segDist;

      const isMapping = wp.isMappingSegment !== false;
      const segSpeed = isMapping ? flightSpeedMs : transitionSpeedMs;
      const segTime = segDist / Math.max(0.5, segSpeed);
      routeTimeS += segTime;

      if (isMapping) {
        mappingDistanceM += segDist;
        mappingTimeS += segTime;
      }
    }
  }

  // Subtrai 1 vertice pois o ultimo ponto ja entra no retorno ao ponto de decolagem
  const turnTimeS = Math.max(0, turnStopCount - 1) * turnStopTimeS;
  const durationS = climbTimeS + transitToStartS + routeTimeS + turnTimeS + returnToHomeS + descentTimeS;
  const totalDistanceM = transitToStartM + routeDistanceM + returnToHomeM;

  const estimatedPhotos = mappingTimeS > 0
    ? Math.max(1, Math.floor(mappingTimeS / Math.max(1, intervalS)) + Math.max(1, mappingLineStarts))
    : 0;

  return {
    distanceM: roundTo(routeDistanceM, 2),
    totalDistanceM: roundTo(totalDistanceM, 2),
    mappingDistanceM: roundTo(mappingDistanceM, 2),
    transitDistanceM: roundTo(transitToStartM + returnToHomeM, 2),
    durationS: roundTo(durationS, 1),
    durationMin: roundTo(durationS / 60, 2),
    estimatedPhotos,
    waypointCount: partWaypoints.length
  };
}

/**
 * Divide automaticamente uma sequencia de waypoints em partes compativeis com autonomia util e limite de waypoints.
 * @param {Array<object>} waypoints Lista ordenada de waypoints da missao
 * @param {{lat: number, lon: number}|null} takeoffPoint Ponto de decolagem (Home)
 * @param {object} drone Perfil da aeronave
 * @param {object} [options={}]
 * @param {number} [options.flightSpeedMs] Velocidade de voo nas linhas de mapeamento (m/s)
 * @param {number} [options.transitionSpeedMs] Velocidade de transito e retorno (m/s)
 * @param {number} [options.intervalS=3] Intervalo entre disparos (s)
 * @param {number} [options.altitudeAglM=100] Altitude padrao (m)
 * @param {number} [options.reserveRatio=0.20] Reserva de bateria (0 a 0.8)
 * @param {number} [options.maxWaypointsPerPart=99] Limite maximo de waypoints por arquivo KMZ
 * @returns {{ parts: Array<object>, totals: object }}
 */
export function splitMissionByBattery(waypoints, takeoffPoint, drone, options = {}) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return {
      parts: [],
      totals: {
        distanceM: 0,
        totalDistanceM: 0,
        durationS: 0,
        durationMin: 0,
        estimatedPhotos: 0,
        batteryCount: 0,
        waypointCount: 0
      }
    };
  }

  const maxFlightTimeMin = Number(drone?.max_flight_time_min ?? 22);
  const reserveRatio = Math.min(0.8, Math.max(0, Number(options.reserveRatio ?? 0.20)));
  const usableTimeMin = maxFlightTimeMin * (1 - reserveRatio);
  const usableTimeS = usableTimeMin * 60;

  const maxWaypointsPerPart = Math.max(2, Math.floor(Number(options.maxWaypointsPerPart ?? 99)));
  const flightSpeedMs = Math.max(0.5, Number(options.flightSpeedMs ?? drone?.max_safe_speed_ms ?? 8.0));
  const transitionSpeedMs = Math.max(
    flightSpeedMs,
    Number(options.transitionSpeedMs ?? Math.min(12.0, Math.max(flightSpeedMs, drone?.max_safe_speed_ms ?? 9.0)))
  );
  const intervalS = Math.max(1, Number(options.intervalS ?? 3));
  const altitudeAglM = Math.max(10, Number(options.altitudeAglM ?? 100));
  const climbSpeedMs = Math.max(0.5, Number(options.climbSpeedMs ?? 3.0));
  const descentSpeedMs = Math.max(0.5, Number(options.descentSpeedMs ?? 2.5));
  const turnStopTimeS = Math.max(0, Number(options.turnStopTimeS ?? 2.5));

  const effectiveTakeoff = takeoffPoint && Number.isFinite(takeoffPoint.lat) && Number.isFinite(takeoffPoint.lon)
    ? { lat: takeoffPoint.lat, lon: takeoffPoint.lon }
    : { lat: waypoints[0].lat, lon: waypoints[0].lon };

  const evalConfig = {
    flightSpeedMs,
    transitionSpeedMs,
    intervalS,
    altitudeAglM,
    climbSpeedMs,
    descentSpeedMs,
    turnStopTimeS
  };

  const parts = [];
  let cursor = 0;

  while (cursor < waypoints.length) {
    const currentBatch = [waypoints[cursor]];
    let endIdx = cursor;

    while (endIdx + 1 < waypoints.length && currentBatch.length < maxWaypointsPerPart) {
      const candidateBatch = currentBatch.concat([waypoints[endIdx + 1]]);
      const candidateMetrics = evaluatePartMetrics(candidateBatch, effectiveTakeoff, evalConfig);

      if (candidateMetrics.durationS <= usableTimeS || currentBatch.length < 2) {
        currentBatch.push(waypoints[endIdx + 1]);
        endIdx += 1;
        if (candidateMetrics.durationS > usableTimeS && currentBatch.length >= 2) {
          break;
        }
      } else {
        break;
      }
    }

    // Garante fechamento limpo do disparo no ultimo waypoint da parte
    const normalizedBatch = currentBatch.map((wp, idx) => ({
      ...wp,
      partIndex: parts.length + 1,
      partWaypointIndex: idx,
      isMappingStart: idx === 0 ? true : Boolean(wp.isMappingStart),
      isMappingEnd: idx === currentBatch.length - 1 ? true : Boolean(wp.isMappingEnd)
    }));

    const metrics = evaluatePartMetrics(normalizedBatch, effectiveTakeoff, evalConfig);
    const warnings = [];
    if (metrics.durationS > usableTimeS) {
      warnings.push('Segmento minimo excede a autonomia util configurada para uma unica bateria.');
    }

    const partIndex = parts.length + 1;
    parts.push({
      partIndex,
      label: `Parte ${partIndex}`,
      color: BATTERY_PALETTE[(partIndex - 1) % BATTERY_PALETTE.length],
      waypoints: normalizedBatch,
      ...metrics,
      usableTimeMin: roundTo(usableTimeMin, 2),
      batteryUsagePct: roundTo((metrics.durationS / usableTimeS) * 100, 1),
      warnings
    });

    if (endIdx >= waypoints.length - 1) {
      break;
    }

    // Se o corte ocorreu no meio de um segmento de mapeamento, ou se restaria apenas 1 waypoint final,
    // retoma no ultimo waypoint da parte atual para evitar lacuna e garantir >= 2 waypoints por parte.
    const lastOriginalWp = waypoints[endIdx];
    const remainingAfter = waypoints.length - 1 - endIdx;
    const shouldOverlap = (Boolean(lastOriginalWp.isMappingSegment) || remainingAfter === 1) && endIdx > cursor;
    cursor = shouldOverlap ? endIdx : endIdx + 1;
  }

  const totals = parts.reduce(
    (acc, part) => {
      acc.distanceM += part.distanceM;
      acc.totalDistanceM += part.totalDistanceM;
      acc.durationS += part.durationS;
      acc.estimatedPhotos += part.estimatedPhotos;
      acc.waypointCount += part.waypointCount;
      return acc;
    },
    {
      distanceM: 0,
      totalDistanceM: 0,
      durationS: 0,
      durationMin: 0,
      estimatedPhotos: 0,
      batteryCount: parts.length,
      waypointCount: 0
    }
  );

  totals.distanceM = roundTo(totals.distanceM, 2);
  totals.totalDistanceM = roundTo(totals.totalDistanceM, 2);
  totals.durationS = roundTo(totals.durationS, 1);
  totals.durationMin = roundTo(totals.durationS / 60, 2);

  return { parts, totals };
}
