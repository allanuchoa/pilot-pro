const MISSIONS_TABLE = 'ppr_missions';
const DRONE_PROFILES_TABLE = 'ppr_drone_profiles';
const VALID_MISSION_TYPES = new Set(['grid', 'double_grid', 'corridor']);

function assertClientAndUser(supabaseClient, userId) {
  if (!supabaseClient || typeof supabaseClient.from !== 'function') {
    throw new Error('Cliente Supabase invalido ou nao inicializado.');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('Identificador de usuario (userId) obrigatorio.');
  }
}

function assertRecordId(recordId, label) {
  if (!recordId || typeof recordId !== 'string') {
    throw new Error(`Identificador ${label} obrigatorio.`);
  }
}

function sanitizeMissionPayload(userId, mission) {
  if (!mission || typeof mission !== 'object') {
    throw new Error('Dados da missao obrigatorios.');
  }

  const name = typeof mission.name === 'string' ? mission.name.trim() : '';
  if (!name) {
    throw new Error('Nome da missao obrigatorio.');
  }

  const missionType = mission.mission_type;
  if (!VALID_MISSION_TYPES.has(missionType)) {
    throw new Error(`Tipo de missao invalido: ${String(missionType)}`);
  }

  const droneKey = typeof mission.drone_key === 'string' ? mission.drone_key.trim() : '';
  if (!droneKey) {
    throw new Error('Chave do drone (drone_key) obrigatoria.');
  }

  if (!mission.area_geojson || typeof mission.area_geojson !== 'object') {
    throw new Error('Geometria da area (area_geojson) obrigatoria.');
  }

  if (!mission.flight_params || typeof mission.flight_params !== 'object') {
    throw new Error('Parametros de voo (flight_params) obrigatorios.');
  }

  if (!mission.summary_metrics || typeof mission.summary_metrics !== 'object') {
    throw new Error('Metricas de resumo (summary_metrics) obrigatorias.');
  }

  return {
    user_id: userId,
    name,
    mission_type: missionType,
    drone_key: droneKey,
    area_geojson: mission.area_geojson,
    takeoff_point: mission.takeoff_point ?? null,
    flight_params: mission.flight_params,
    summary_metrics: mission.summary_metrics
  };
}

function sanitizeDronePayload(userId, profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Dados do perfil de drone obrigatorios.');
  }

  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  if (!name) {
    throw new Error('Nome do perfil de drone obrigatorio.');
  }

  const sensorWidthMm = Number(profile.sensor_width_mm);
  const sensorHeightMm = Number(profile.sensor_height_mm);
  const focalLengthMm = Number(profile.focal_length_mm);
  const imageWidthPx = Math.round(Number(profile.image_width_px));
  const imageHeightPx = Math.round(Number(profile.image_height_px));
  const maxFlightTimeMin = Number(profile.max_flight_time_min);
  const maxSafeSpeedMs = Number(profile.max_safe_speed_ms);

  if (
    !Number.isFinite(sensorWidthMm) || sensorWidthMm <= 0 ||
    !Number.isFinite(sensorHeightMm) || sensorHeightMm <= 0 ||
    !Number.isFinite(focalLengthMm) || focalLengthMm <= 0 ||
    !Number.isInteger(imageWidthPx) || imageWidthPx <= 0 ||
    !Number.isInteger(imageHeightPx) || imageHeightPx <= 0 ||
    !Number.isFinite(maxFlightTimeMin) || maxFlightTimeMin <= 0 ||
    !Number.isFinite(maxSafeSpeedMs) || maxSafeSpeedMs <= 0
  ) {
    throw new Error('Parametros fisicos do perfil de drone devem ser numeros positivos.');
  }

  return {
    user_id: userId,
    name,
    sensor_width_mm: sensorWidthMm,
    sensor_height_mm: sensorHeightMm,
    focal_length_mm: focalLengthMm,
    image_width_px: imageWidthPx,
    image_height_px: imageHeightPx,
    max_flight_time_min: maxFlightTimeMin,
    max_safe_speed_ms: maxSafeSpeedMs,
    has_mechanical_shutter: Boolean(profile.has_mechanical_shutter)
  };
}

export async function listMissions(supabaseClient, userId) {
  assertClientAndUser(supabaseClient, userId);

  const { data, error } = await supabaseClient
    .from(MISSIONS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

export async function saveMission(supabaseClient, userId, mission) {
  assertClientAndUser(supabaseClient, userId);
  const payload = sanitizeMissionPayload(userId, mission);

  if (mission.id) {
    const { data, error } = await supabaseClient
      .from(MISSIONS_TABLE)
      .update(payload)
      .eq('id', mission.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await supabaseClient
    .from(MISSIONS_TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function duplicateMission(supabaseClient, userId, missionId) {
  assertClientAndUser(supabaseClient, userId);
  assertRecordId(missionId, 'da missao');

  const { data: original, error: fetchError } = await supabaseClient
    .from(MISSIONS_TABLE)
    .select('*')
    .eq('id', missionId)
    .eq('user_id', userId)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  if (!original) {
    throw new Error('Missao original nao encontrada.');
  }

  const copyPayload = sanitizeMissionPayload(userId, {
    name: `${original.name} (Copia)`,
    mission_type: original.mission_type,
    drone_key: original.drone_key,
    area_geojson: original.area_geojson,
    takeoff_point: original.takeoff_point ?? null,
    flight_params: original.flight_params,
    summary_metrics: original.summary_metrics
  });

  const { data: created, error: insertError } = await supabaseClient
    .from(MISSIONS_TABLE)
    .insert(copyPayload)
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return created;
}

export async function deleteMission(supabaseClient, userId, missionId) {
  assertClientAndUser(supabaseClient, userId);
  assertRecordId(missionId, 'da missao');

  const { error } = await supabaseClient
    .from(MISSIONS_TABLE)
    .delete()
    .eq('id', missionId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return true;
}

export async function listCustomDrones(supabaseClient, userId) {
  assertClientAndUser(supabaseClient, userId);

  const { data, error } = await supabaseClient
    .from(DRONE_PROFILES_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

export async function saveCustomDrone(supabaseClient, userId, profile) {
  assertClientAndUser(supabaseClient, userId);
  const payload = sanitizeDronePayload(userId, profile);

  if (profile.id) {
    const { data, error } = await supabaseClient
      .from(DRONE_PROFILES_TABLE)
      .update(payload)
      .eq('id', profile.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await supabaseClient
    .from(DRONE_PROFILES_TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteCustomDrone(supabaseClient, userId, profileId) {
  assertClientAndUser(supabaseClient, userId);
  assertRecordId(profileId, 'do perfil de drone');

  const { error } = await supabaseClient
    .from(DRONE_PROFILES_TABLE)
    .delete()
    .eq('id', profileId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return true;
}
