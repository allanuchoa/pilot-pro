// Serializador WPML (DJI Fly) e empacotador .kmz / .zip multi-bateria.

const VALID_FINISH_ACTIONS = new Set(['goHome', 'noAction', 'autoLand']);

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtNum(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number(n.toFixed(decimals)).toString();
}

/**
 * Converte um nome de missao em slug seguro para nomes de arquivos .kmz/.zip.
 * @param {string} name
 * @returns {string}
 */
export function slugifyMissionName(name) {
  const base = String(name || 'missao-pilot-pro')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'missao-pilot-pro';
}

function normalizeConfig(config = {}) {
  const finishAction = VALID_FINISH_ACTIONS.has(config.finishAction)
    ? config.finishAction
    : 'goHome';
  const altitudeAglM = Math.max(5, Number(config.altitudeAglM ?? 100));
  const flightSpeedMs = Math.max(0.5, Number(config.flightSpeedMs ?? 8.0));
  const transitionSpeedMs = Math.max(flightSpeedMs, Number(config.transitionSpeedMs ?? Math.max(flightSpeedMs, 9.0)));
  const takeOffSecurityHeight = Math.max(
    10,
    Number(config.takeOffSecurityHeight ?? Math.min(Math.max(20, altitudeAglM * 0.5), 50))
  );
  const gimbalPitchDeg = Math.max(-90, Math.min(0, Number(config.gimbalPitchDeg ?? -90)));
  const intervalS = Math.max(2, Math.min(5, Math.round(Number(config.intervalS ?? 3))));
  const triggerMode = config.triggerMode === 'manual' ? 'manual' : 'wpml';
  const straightenFlightPath = config.straightenFlightPath !== false;
  const missionName = String(config.missionName || 'Missao Pilot Pro').trim() || 'Missao Pilot Pro';
  const timestampMs = Number.isFinite(config.timestampMs) ? Math.floor(config.timestampMs) : Date.now();

  return {
    missionName,
    finishAction,
    altitudeAglM,
    flightSpeedMs,
    transitionSpeedMs,
    takeOffSecurityHeight,
    gimbalPitchDeg,
    intervalS,
    triggerMode,
    straightenFlightPath,
    timestampMs
  };
}

function buildMissionConfigXml(cfg) {
  return [
    '    <wpml:missionConfig>',
    '      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>',
    `      <wpml:finishAction>${cfg.finishAction}</wpml:finishAction>`,
    '      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>',
    '      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>',
    `      <wpml:takeOffSecurityHeight>${fmtNum(cfg.takeOffSecurityHeight, 1)}</wpml:takeOffSecurityHeight>`,
    `      <wpml:globalTransitionalSpeed>${fmtNum(cfg.transitionSpeedMs, 2)}</wpml:globalTransitionalSpeed>`,
    '      <wpml:droneInfo>',
    '        <wpml:droneEnumValue>68</wpml:droneEnumValue>',
    '        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>',
    '      </wpml:droneInfo>',
    '    </wpml:missionConfig>'
  ].join('\n');
}

/**
 * Gera o conteudo XML de wpmz/template.kml para uma parte de missao.
 * @param {object} part Parte da missao contendo waypoints e metricas
 * @param {object} [config={}] Configuracoes de exportacao
 * @returns {string}
 */
export function buildTemplateKml(part, config = {}) {
  if (!part || !Array.isArray(part.waypoints) || part.waypoints.length < 2) {
    throw new Error('Cada parte da missao precisa de pelo menos 2 waypoints para gerar template.kml.');
  }

  const cfg = normalizeConfig(config);
  const partSuffix = part.partIndex ? ` (Parte ${part.partIndex})` : '';
  const globalTurnMode = cfg.straightenFlightPath
    ? 'toPointAndStopWithDiscontinuityCurvature'
    : 'coordinateTurn';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">',
    '  <Document>',
    `    <name>${escapeXml(cfg.missionName + partSuffix)}</name>`,
    '    <wpml:author>Pilot Pro</wpml:author>',
    `    <wpml:createTime>${cfg.timestampMs}</wpml:createTime>`,
    `    <wpml:updateTime>${cfg.timestampMs}</wpml:updateTime>`,
    buildMissionConfigXml(cfg),
    '    <Folder>',
    '      <wpml:templateType>waypoint</wpml:templateType>',
    '      <wpml:templateId>0</wpml:templateId>',
    '      <wpml:waylineCoordinateSysParam>',
    '        <wpml:coordinateMode>WGS84</wpml:coordinateMode>',
    '        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>',
    '      </wpml:waylineCoordinateSysParam>',
    `      <wpml:autoFlightSpeed>${fmtNum(cfg.flightSpeedMs, 2)}</wpml:autoFlightSpeed>`,
    `      <wpml:globalHeight>${fmtNum(cfg.altitudeAglM, 2)}</wpml:globalHeight>`,
    `      <wpml:globalWaypointTurnMode>${globalTurnMode}</wpml:globalWaypointTurnMode>`,
    '      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>',
    '    </Folder>',
    '  </Document>',
    '</kml>'
  ].join('\n');
}

function buildActionGroupXml(actionGroupId, wpIndex, actionType, intervalS) {
  const paramLines = actionType === 'startTimeIntervalShot'
    ? [
        '          <wpml:actionActuatorFuncParam>',
        `            <wpml:timeInterval>${intervalS}</wpml:timeInterval>`,
        '          </wpml:actionActuatorFuncParam>'
      ]
    : [
        '          <wpml:actionActuatorFuncParam/>'
      ];

  return [
    '        <wpml:actionGroup>',
    `          <wpml:actionGroupId>${actionGroupId}</wpml:actionGroupId>`,
    `          <wpml:actionGroupStartIndex>${wpIndex}</wpml:actionGroupStartIndex>`,
    `          <wpml:actionGroupEndIndex>${wpIndex}</wpml:actionGroupEndIndex>`,
    '          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>',
    '          <wpml:actionTrigger>',
    '            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>',
    '          </wpml:actionTrigger>',
    '          <wpml:action>',
    '            <wpml:actionId>0</wpml:actionId>',
    `            <wpml:actionActuatorFunc>${actionType}</wpml:actionActuatorFunc>`,
    ...paramLines,
    '          </wpml:action>',
    '        </wpml:actionGroup>'
  ].join('\n');
}

/**
 * Gera o conteudo XML de wpmz/waylines.wpml para uma parte de missao.
 * @param {object} part Parte da missao contendo waypoints e metricas
 * @param {object} [config={}] Configuracoes de exportacao
 * @returns {string}
 */
export function buildWaylinesWpml(part, config = {}) {
  if (!part || !Array.isArray(part.waypoints) || part.waypoints.length < 2) {
    throw new Error('Cada parte da missao precisa de pelo menos 2 waypoints para gerar waylines.wpml.');
  }

  const cfg = normalizeConfig(config);
  const waypoints = part.waypoints;
  const distanceM = Number.isFinite(part.distanceM) ? part.distanceM : 0;
  const durationS = Number.isFinite(part.durationS) ? part.durationS : 0;

  let actionGroupId = 0;
  let shootingActive = false;

  const placemarks = waypoints.map((wp, idx) => {
    const lon = Number(wp.lon);
    const lat = Number(wp.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Coordenadas invalidas no waypoint ${idx}.`);
    }

    const executeHeight = Number.isFinite(wp.executeHeightM)
      ? wp.executeHeightM
      : Number.isFinite(wp.relativeAltM)
        ? wp.relativeAltM
        : Number.isFinite(wp.altitudeAglM)
          ? wp.altitudeAglM
          : cfg.altitudeAglM;

    const waypointSpeed = Number.isFinite(wp.speedMs) ? wp.speedMs : cfg.flightSpeedMs;
    const turnMode = wp.turnMode || (cfg.straightenFlightPath
      ? 'toPointAndStopWithDiscontinuityCurvature'
      : 'coordinateTurn');
    const useStraightLine = cfg.straightenFlightPath ? 1 : 0;

    const actionBlocks = [];
    if (cfg.triggerMode === 'wpml') {
      const isLast = idx === waypoints.length - 1;
      const shouldStart = !isLast && (wp.isMappingStart === true || (idx === 0 && !shootingActive));
      const shouldStop = (wp.isMappingEnd === true || isLast) && shootingActive;

      if (shouldStop) {
        actionBlocks.push(buildActionGroupXml(actionGroupId, idx, 'stopTimeIntervalShot', cfg.intervalS));
        actionGroupId += 1;
        shootingActive = false;
      }

      if (shouldStart && !shootingActive) {
        actionBlocks.push(buildActionGroupXml(actionGroupId, idx, 'startTimeIntervalShot', cfg.intervalS));
        actionGroupId += 1;
        shootingActive = true;
      }
    }

    const lines = [
      '      <Placemark>',
      '        <Point>',
      `          <coordinates>${fmtNum(lon, 7)},${fmtNum(lat, 7)}</coordinates>`,
      '        </Point>',
      `        <wpml:index>${idx}</wpml:index>`,
      `        <wpml:executeHeight>${fmtNum(executeHeight, 2)}</wpml:executeHeight>`,
      `        <wpml:waypointSpeed>${fmtNum(waypointSpeed, 2)}</wpml:waypointSpeed>`,
      '        <wpml:waypointHeadingParam>',
      '          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>',
      '          <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>',
      '          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>',
      '        </wpml:waypointHeadingParam>',
      '        <wpml:waypointTurnParam>',
      `          <wpml:waypointTurnMode>${escapeXml(turnMode)}</wpml:waypointTurnMode>`,
      '          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>',
      '        </wpml:waypointTurnParam>',
      `        <wpml:useStraightLine>${useStraightLine}</wpml:useStraightLine>`,
      `        <wpml:gimbalPitchAngle>${fmtNum(cfg.gimbalPitchDeg, 1)}</wpml:gimbalPitchAngle>`
    ];

    if (actionBlocks.length > 0) {
      lines.push(...actionBlocks);
    }

    lines.push('      </Placemark>');
    return lines.join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">',
    '  <Document>',
    buildMissionConfigXml(cfg),
    '    <Folder>',
    '      <wpml:templateId>0</wpml:templateId>',
    '      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>',
    '      <wpml:waylineId>0</wpml:waylineId>',
    `      <wpml:distance>${fmtNum(distanceM, 2)}</wpml:distance>`,
    `      <wpml:duration>${fmtNum(durationS, 1)}</wpml:duration>`,
    `      <wpml:autoFlightSpeed>${fmtNum(cfg.flightSpeedMs, 2)}</wpml:autoFlightSpeed>`,
    ...placemarks,
    '    </Folder>',
    '  </Document>',
    '</kml>'
  ].join('\n');
}

function toBlobIfSupported(uint8Array, mimeType) {
  if (typeof Blob !== 'undefined') {
    return new Blob([uint8Array], { type: mimeType });
  }
  return null;
}

/**
 * Gera um arquivo .kmz individual contendo wpmz/template.kml e wpmz/waylines.wpml.
 * @param {object} part Parte da missao
 * @param {object} [config={}] Configuracoes de exportacao
 * @param {Function} [JSZipImpl=globalThis.JSZip] Construtor JSZip
 * @returns {Promise<{filename: string, mimeType: string, data: Uint8Array, blob: Blob|null, templateKml: string, waylinesWpml: string}>}
 */
export async function exportSinglePartKmz(part, config = {}, JSZipImpl = globalThis.JSZip) {
  if (typeof JSZipImpl !== 'function') {
    throw new Error('JSZip nao disponivel para empacotamento .kmz.');
  }

  const cfg = normalizeConfig(config);
  const slug = slugifyMissionName(config.fileSlug || cfg.missionName);
  const isPartNumbered = Boolean(config.forcePartSuffix) || Number(config.totalParts ?? 1) > 1;
  const partNum = Number(part.partIndex ?? 1);
  const filename = isPartNumbered ? `${slug}_parte${partNum}.kmz` : `${slug}.kmz`;

  const templateKml = buildTemplateKml(part, cfg);
  const waylinesWpml = buildWaylinesWpml(part, cfg);

  const zip = new JSZipImpl();
  zip.file('wpmz/template.kml', templateKml);
  zip.file('wpmz/waylines.wpml', waylinesWpml);

  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const mimeType = 'application/vnd.google-earth.kmz';

  return {
    filename,
    mimeType,
    data,
    blob: toBlobIfSupported(data, mimeType),
    templateKml,
    waylinesWpml
  };
}

/**
 * Exporta 1 parte diretamente como .kmz unico ou N partes como .zip contendo <slug>_parte1.kmz..N.
 * @param {Array<object>} parts Partes da missao
 * @param {object} [config={}] Configuracoes de exportacao
 * @param {Function} [JSZipImpl=globalThis.JSZip] Construtor JSZip
 * @returns {Promise<{filename: string, isMultiPart: boolean, partCount: number, mimeType: string, data: Uint8Array, blob: Blob|null, files: Array<object>}>}
 */
export async function exportMissionPackage(parts, config = {}, JSZipImpl = globalThis.JSZip) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('Nenhuma parte de missao disponivel para exportacao.');
  }
  if (typeof JSZipImpl !== 'function') {
    throw new Error('JSZip nao disponivel para empacotamento da missao.');
  }

  const cfg = normalizeConfig(config);
  const slug = slugifyMissionName(config.fileSlug || cfg.missionName);

  if (parts.length === 1) {
    const single = await exportSinglePartKmz(
      parts[0],
      { ...cfg, fileSlug: slug, totalParts: 1, forcePartSuffix: false },
      JSZipImpl
    );

    return {
      filename: single.filename,
      isMultiPart: false,
      partCount: 1,
      mimeType: single.mimeType,
      data: single.data,
      blob: single.blob,
      files: [single]
    };
  }

  const bundleZip = new JSZipImpl();
  const files = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = { ...parts[i], partIndex: parts[i].partIndex ?? (i + 1) };
    const kmz = await exportSinglePartKmz(
      part,
      { ...cfg, fileSlug: slug, totalParts: parts.length, forcePartSuffix: true },
      JSZipImpl
    );
    bundleZip.file(kmz.filename, kmz.data);
    files.push(kmz);
  }

  const data = await bundleZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const mimeType = 'application/zip';

  return {
    filename: `${slug}.zip`,
    isMultiPart: true,
    partCount: parts.length,
    mimeType,
    data,
    blob: toBlobIfSupported(data, mimeType),
    files
  };
}
