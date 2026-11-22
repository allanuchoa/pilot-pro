// Motor fotogrametrico puro para calculo de footprint, GSD, espacamento, velocidade e intervalos.

export const ALLOWED_INTERVALS = Object.freeze([2, 3, 4, 5]);

function roundTo(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Calcula parametros fotogrametricos e alertas operacionais a partir do drone e entradas de voo.
 * @param {object} drone Perfil da aeronave
 * @param {object} [params={}]
 * @param {number} [params.altitudeM=100] Altitude acima do solo (AGL) em metros
 * @param {number} [params.frontOverlapPct=75] Sobreposicao frontal alvo (0 a 95%)
 * @param {number} [params.sideOverlapPct=65] Sobreposicao lateral alvo (0 a 95%)
 * @param {number} [params.maxSpeedMs=9.0] Velocidade maxima desejada em m/s
 * @param {'auto'|2|3|4|5|'2'|'3'|'4'|'5'} [params.intervalMode='auto'] Modo de selecao de intervalo
 * @returns {object}
 */
export function calculatePhotogrammetry(drone, params = {}) {
  if (!drone || typeof drone !== 'object') {
    throw new Error('Perfil de aeronave obrigatorio para calculo fotogrametrico.');
  }

  const sensorW = Number(drone.sensor_width_mm);
  const sensorH = Number(drone.sensor_height_mm);
  const focal = Number(drone.focal_length_mm);
  const imageW = Number(drone.image_width_px);
  const imageH = Number(drone.image_height_px);
  const maxSafeSpeedMs = Number(drone.max_safe_speed_ms ?? 9.0);
  const hasMechanicalShutter = Boolean(drone.has_mechanical_shutter);

  if (
    !Number.isFinite(sensorW) || sensorW <= 0 ||
    !Number.isFinite(sensorH) || sensorH <= 0 ||
    !Number.isFinite(focal) || focal <= 0 ||
    !Number.isFinite(imageW) || imageW <= 0 ||
    !Number.isFinite(imageH) || imageH <= 0
  ) {
    throw new Error('Especificacoes de camera da aeronave invalidas.');
  }

  const altitudeM = Number(params.altitudeM ?? 100);
  const frontOverlapPct = Number(params.frontOverlapPct ?? 75);
  const sideOverlapPct = Number(params.sideOverlapPct ?? 65);
  const intervalModeRaw = params.intervalMode ?? 'auto';
  const isAuto = intervalModeRaw === 'auto' || intervalModeRaw === '' || intervalModeRaw == null;

  if (!Number.isFinite(altitudeM) || altitudeM <= 0) {
    throw new Error('Altitude AGL deve ser um numero positivo.');
  }
  if (!Number.isFinite(frontOverlapPct) || frontOverlapPct < 0 || frontOverlapPct > 95) {
    throw new Error('Sobreposicao frontal deve estar entre 0% e 95%.');
  }
  if (!Number.isFinite(sideOverlapPct) || sideOverlapPct < 0 || sideOverlapPct > 95) {
    throw new Error('Sobreposicao lateral deve estar entre 0% e 95%.');
  }

  const frontOverlap = frontOverlapPct / 100;
  const sideOverlap = sideOverlapPct / 100;

  // Cobertura no solo (footprint)
  const widthM = altitudeM * (sensorW / focal);
  const heightM = altitudeM * (sensorH / focal);

  // GSD (cm/px)
  const gsdCm = (widthM / imageW) * 100;

  // Espacamento entre linhas (cross-track) e passo frontal (along-track)
  const lineSpacingM = widthM * (1 - sideOverlap);
  const photoDistanceM = heightM * (1 - frontOverlap);

  const hasExplicitMaxSpeed = params.maxSpeedMs !== undefined && params.maxSpeedMs !== null && params.maxSpeedMs !== '';
  const requestedMaxSpeed = hasExplicitMaxSpeed ? Number(params.maxSpeedMs) : 9.0;

  if (!Number.isFinite(requestedMaxSpeed) || requestedMaxSpeed <= 0) {
    throw new Error('Velocidade maxima deve ser um numero positivo.');
  }

  let intervalS = 2;
  let flightSpeedMs = 0;
  let effectiveFrontOverlapPct = frontOverlapPct;
  let speedLimited = false;

  if (isAuto) {
    let selected = null;
    for (const dt of ALLOWED_INTERVALS) {
      const candidateSpeed = photoDistanceM / dt;
      if (candidateSpeed <= requestedMaxSpeed + 1e-9) {
        selected = { dt, speed: candidateSpeed };
        break;
      }
    }

    if (selected) {
      intervalS = selected.dt;
      flightSpeedMs = selected.speed;
      effectiveFrontOverlapPct = frontOverlapPct;
      speedLimited = false;
    } else {
      intervalS = ALLOWED_INTERVALS[ALLOWED_INTERVALS.length - 1];
      flightSpeedMs = requestedMaxSpeed;
      const effectiveFrontOverlap = Math.max(0, Math.min(0.999, 1 - (flightSpeedMs * intervalS) / heightM));
      effectiveFrontOverlapPct = effectiveFrontOverlap * 100;
      speedLimited = true;
    }
  } else {
    const manualDt = Number(intervalModeRaw);
    if (!ALLOWED_INTERVALS.includes(manualDt)) {
      throw new Error('Intervalo manual deve ser 2, 3, 4 ou 5 segundos.');
    }
    intervalS = manualDt;
    const requiredSpeed = photoDistanceM / intervalS;
    const manualCap = hasExplicitMaxSpeed ? requestedMaxSpeed : Math.max(maxSafeSpeedMs, 15.0);

    if (requiredSpeed > manualCap + 1e-9) {
      flightSpeedMs = manualCap;
      const effectiveFrontOverlap = Math.max(0, Math.min(0.999, 1 - (flightSpeedMs * intervalS) / heightM));
      effectiveFrontOverlapPct = effectiveFrontOverlap * 100;
      speedLimited = true;
    } else {
      flightSpeedMs = requiredSpeed;
      effectiveFrontOverlapPct = frontOverlapPct;
      speedLimited = false;
    }
  }

  const alerts = [];

  if (!hasMechanicalShutter && (flightSpeedMs > maxSafeSpeedMs + 1e-9 || altitudeM < 80)) {
    const reasons = [];
    if (flightSpeedMs > maxSafeSpeedMs + 1e-9) {
      reasons.push(`velocidade ${roundTo(flightSpeedMs, 2)} m/s acima do limite seguro (${maxSafeSpeedMs.toFixed(1)} m/s)`);
    }
    if (altitudeM < 80) {
      reasons.push(`altitude ${roundTo(altitudeM, 1)} m abaixo de 80 m`);
    }
    alerts.push({
      level: 'warning',
      code: 'ROLLING_SHUTTER',
      message: `Risco de arrasto (rolling shutter): ${reasons.join(' e ')}.`
    });
  }

  if (altitudeM > 120) {
    alerts.push({
      level: 'warning',
      code: 'ALTITUDE_HIGH',
      message: `Altitude ${roundTo(altitudeM, 1)} m excede o teto operacional padrao de 120 m AGL.`
    });
  }

  if (altitudeM < 30) {
    alerts.push({
      level: 'warning',
      code: 'ALTITUDE_LOW',
      message: `Altitude ${roundTo(altitudeM, 1)} m abaixo do minimo recomendado de 30 m AGL.`
    });
  }

  if (flightSpeedMs < 1.0) {
    alerts.push({
      level: 'warning',
      code: 'SPEED_TOO_LOW',
      message: `Velocidade calculada (${roundTo(flightSpeedMs, 2)} m/s) abaixo de 1.0 m/s. Revise altitude ou sobreposicao.`
    });
  }

  if (speedLimited) {
    alerts.push({
      level: 'warning',
      code: 'OVERLAP_LIMITED',
      message: `Velocidade limitada a ${roundTo(flightSpeedMs, 2)} m/s com intervalo ${intervalS}s. Sobreposicao frontal efetiva: ${roundTo(effectiveFrontOverlapPct, 1)}%.`
    });
  }

  return {
    footprint: {
      widthM: roundTo(widthM, 4),
      heightM: roundTo(heightM, 4)
    },
    gsdCm: roundTo(gsdCm, 4),
    lineSpacingM: roundTo(lineSpacingM, 4),
    photoDistanceM: roundTo(photoDistanceM, 4),
    intervalS,
    intervalMode: isAuto ? 'auto' : intervalS,
    flightSpeedMs: roundTo(flightSpeedMs, 4),
    effectiveFrontOverlapPct: roundTo(effectiveFrontOverlapPct, 2),
    speedLimited,
    alerts
  };
}
