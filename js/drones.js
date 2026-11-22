// Catalogo oficial de aeronaves DJI Fly e validacao de perfis customizados.

export const BUILTIN_DRONES = Object.freeze([
  Object.freeze({
    drone_key: 'dji-mini-4-pro',
    name: 'DJI Mini 4 Pro',
    sensor_width_mm: 9.6,
    sensor_height_mm: 7.2,
    focal_length_mm: 6.72,
    image_width_px: 4032,
    image_height_px: 3024,
    max_flight_time_min: 22,
    max_safe_speed_ms: 9.0,
    has_mechanical_shutter: false,
    is_builtin: true
  }),
  Object.freeze({
    drone_key: 'dji-mini-3-pro',
    name: 'DJI Mini 3 / 3 Pro',
    sensor_width_mm: 9.6,
    sensor_height_mm: 7.2,
    focal_length_mm: 6.72,
    image_width_px: 4032,
    image_height_px: 3024,
    max_flight_time_min: 22,
    max_safe_speed_ms: 9.0,
    has_mechanical_shutter: false,
    is_builtin: true
  }),
  Object.freeze({
    drone_key: 'dji-air-3',
    name: 'DJI Air 3 (Wide)',
    sensor_width_mm: 9.6,
    sensor_height_mm: 7.2,
    focal_length_mm: 6.72,
    image_width_px: 4032,
    image_height_px: 3024,
    max_flight_time_min: 30,
    max_safe_speed_ms: 9.5,
    has_mechanical_shutter: false,
    is_builtin: true
  }),
  Object.freeze({
    drone_key: 'dji-air-3s',
    name: 'DJI Air 3S (Wide)',
    sensor_width_mm: 13.13,
    sensor_height_mm: 9.85,
    focal_length_mm: 8.75,
    image_width_px: 4000,
    image_height_px: 3000,
    max_flight_time_min: 30,
    max_safe_speed_ms: 9.5,
    has_mechanical_shutter: false,
    is_builtin: true
  }),
  Object.freeze({
    drone_key: 'dji-mavic-3',
    name: 'DJI Mavic 3 / Classic / Pro (Wide)',
    sensor_width_mm: 17.3,
    sensor_height_mm: 13.0,
    focal_length_mm: 12.29,
    image_width_px: 5280,
    image_height_px: 3956,
    max_flight_time_min: 30,
    max_safe_speed_ms: 10.0,
    has_mechanical_shutter: false,
    is_builtin: true
  })
]);

/**
 * Normaliza um perfil customizado vindo do Supabase ou formulario.
 * @param {object} profile
 * @returns {object}
 */
function normalizeCustomProfile(profile) {
  const rawId = profile.id != null ? String(profile.id) : '';
  const droneKey = profile.drone_key || (rawId ? `custom:${rawId}` : 'custom');
  return {
    id: rawId || undefined,
    drone_key: droneKey,
    name: String(profile.name ?? '').trim(),
    sensor_width_mm: Number(profile.sensor_width_mm),
    sensor_height_mm: Number(profile.sensor_height_mm),
    focal_length_mm: Number(profile.focal_length_mm),
    image_width_px: Math.round(Number(profile.image_width_px)),
    image_height_px: Math.round(Number(profile.image_height_px)),
    max_flight_time_min: Number(profile.max_flight_time_min),
    max_safe_speed_ms: Number(profile.max_safe_speed_ms),
    has_mechanical_shutter: Boolean(profile.has_mechanical_shutter),
    is_builtin: false
  };
}

/**
 * Busca um drone pelo drone_key no catalogo nativo ou nos perfis customizados.
 * @param {string} key
 * @param {Array<object>} [customProfiles=[]]
 * @returns {object|null}
 */
export function getDroneByKey(key, customProfiles = []) {
  if (!key || typeof key !== 'string') {
    return null;
  }

  const builtin = BUILTIN_DRONES.find((drone) => drone.drone_key === key);
  if (builtin) {
    return builtin;
  }

  if (!Array.isArray(customProfiles)) {
    return null;
  }

  const matched = customProfiles.find((profile) => {
    if (!profile || typeof profile !== 'object') {
      return false;
    }
    const idStr = profile.id != null ? String(profile.id) : '';
    return (
      profile.drone_key === key ||
      idStr === key ||
      (idStr !== '' && `custom:${idStr}` === key)
    );
  });

  return matched ? normalizeCustomProfile(matched) : null;
}

/**
 * Valida os campos fisicos de um perfil de drone customizado.
 * @param {object} profile
 * @returns {{ valid: boolean, errors: string[], normalized: object|null }}
 */
export function validateCustomDrone(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return {
      valid: false,
      errors: ['Perfil de aeronave invalido.'],
      normalized: null
    };
  }

  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  if (!name) {
    errors.push('Nome do modelo e obrigatorio.');
  } else if (name.length > 100) {
    errors.push('Nome do modelo deve ter no maximo 100 caracteres.');
  }

  const sensorW = Number(profile.sensor_width_mm);
  if (!Number.isFinite(sensorW) || sensorW <= 0 || sensorW > 100) {
    errors.push('Largura do sensor (mm) deve estar entre 0 e 100.');
  }

  const sensorH = Number(profile.sensor_height_mm);
  if (!Number.isFinite(sensorH) || sensorH <= 0 || sensorH > 100) {
    errors.push('Altura do sensor (mm) deve estar entre 0 e 100.');
  }

  const focal = Number(profile.focal_length_mm);
  if (!Number.isFinite(focal) || focal <= 0 || focal > 500) {
    errors.push('Distancia focal real (mm) deve estar entre 0 e 500.');
  }

  const imgW = Number(profile.image_width_px);
  if (!Number.isInteger(imgW) || imgW <= 0 || imgW > 50000) {
    errors.push('Largura da imagem (px) deve ser um inteiro positivo.');
  }

  const imgH = Number(profile.image_height_px);
  if (!Number.isInteger(imgH) || imgH <= 0 || imgH > 50000) {
    errors.push('Altura da imagem (px) deve ser um inteiro positivo.');
  }

  const flightTime = Number(profile.max_flight_time_min);
  if (!Number.isFinite(flightTime) || flightTime <= 0 || flightTime > 300) {
    errors.push('Autonomia util (min) deve estar entre 0 e 300.');
  }

  const safeSpeed = Number(profile.max_safe_speed_ms);
  if (!Number.isFinite(safeSpeed) || safeSpeed <= 0 || safeSpeed > 40) {
    errors.push('Velocidade segura (m/s) deve estar entre 0 e 40.');
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: normalizeCustomProfile({
      ...profile,
      name,
      sensor_width_mm: sensorW,
      sensor_height_mm: sensorH,
      focal_length_mm: focal,
      image_width_px: imgW,
      image_height_px: imgH,
      max_flight_time_min: flightTime,
      max_safe_speed_ms: safeSpeed,
      has_mechanical_shutter: Boolean(profile.has_mechanical_shutter)
    })
  };
}
