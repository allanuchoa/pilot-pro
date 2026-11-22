/**
 * Orquestrador principal do Pilot Pro.
 * Conecta autenticacao SSO (workbench-bridge.js), mapa Leaflet, motor fotogrametrico,
 * geracao de rotas, elevacao Terrain Follow, divisor multi-bateria, exportador WPML e Supabase.
 */

import { BUILTIN_DRONES, getDroneByKey, validateCustomDrone } from './js/drones.js';
import { calculatePhotogrammetry } from './js/photogrammetry.js';
import {
  computeAreaSqm,
  computeOptimalAngle,
  suggestTakeoffPoint,
  generateSimpleGrid,
  generateDoubleGrid,
  generateCorridor,
  parseAreaFile
} from './js/geometry.js';
import {
  densifyWaypointsForTerrain,
  computeRelativeAltitudes,
  fetchElevations
} from './js/elevation.js';
import { splitMissionByBattery } from './js/battery-splitter.js';
import {
  slugifyMissionName,
  exportSinglePartKmz,
  exportMissionPackage
} from './js/wpml-exporter.js';
import { createMapController } from './js/map-controller.js';
import { renderElevationProfile } from './js/profile-chart.js';
import {
  listMissions,
  saveMission,
  duplicateMission,
  deleteMission,
  listCustomDrones,
  saveCustomDrone,
  deleteCustomDrone
} from './js/storage.js';

const DEFAULT_PARAMS = {
  altitudeM: 100,
  frontOverlapPct: 75,
  sideOverlapPct: 65,
  maxSpeedMs: 9.0,
  intervalMode: 'auto',
  rotationDeg: 0,
  overshootM: 15,
  reverseDirection: false,
  straightenFlightPath: true,
  corridorWidthM: 100,
  altitudeMode: 'terrain_follow',
  gimbalPitchDeg: -90,
  finishAction: 'goHome',
  triggerMode: 'wpml',
  maxWaypointsPerPart: 99,
  batteryReservePct: 20
};

const state = {
  initialized: false,
  listenersBound: false,
  session: null,
  supabaseClient: null,
  mapController: null,
  profileChartHandle: null,

  missionId: null,
  missionName: 'Nova Missao',
  missionType: 'grid',
  droneKey: 'dji-mini-4-pro',
  customDrones: [],
  missionsCache: [],

  areaGeoJson: null,
  takeoffPoint: null,
  takeoffIsSuggested: false,

  params: { ...DEFAULT_PARAMS },

  photogrammetry: null,
  rawRoute: null,
  elevationResult: null,
  elevationStatus: 'idle',
  elevationSource: null,
  elevationError: null,
  elevationAbortController: null,
  elevationDebounceTimer: null,

  splitResult: null,
  areaSqm: 0
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeRedirectUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function safeRedirectToPortal() {
  const portalUrl = globalThis.CONFIG && globalThis.CONFIG.PORTAL_URL;
  if (isSafeRedirectUrl(portalUrl)) {
    globalThis.location.href = portalUrl;
  }
}

function showFatalError(title, message) {
  document.body.style.display = 'flex';
  const shell = $('app-shell');
  const fallback = $('app-error-fallback');
  const titleEl = $('app-error-title');
  const msgEl = $('app-error-message');
  if (shell) shell.hidden = true;
  if (fallback) fallback.hidden = false;
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
}

function showToast(message, variant = 'default', durationMs = 3500) {
  const container = $('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (variant === 'success') toast.classList.add('toast-success');
  if (variant === 'danger') toast.classList.add('toast-danger');
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    if (toast.parentNode === container) {
      container.removeChild(toast);
    }
  }, durationMs);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return '--';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatArea(sqm) {
  if (!Number.isFinite(sqm) || sqm <= 0) return '--';
  if (sqm >= 10000) return `${(sqm / 10000).toFixed(2)} ha`;
  return `${Math.round(sqm)} m2`;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '--';
  const totalSec = Math.round(minutes * 60);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function getActiveDrone() {
  return getDroneByKey(state.droneKey, state.customDrones) || BUILTIN_DRONES[0];
}

function clearRuntimeState() {
  if (state.elevationAbortController) {
    state.elevationAbortController.abort();
    state.elevationAbortController = null;
  }
  if (state.elevationDebounceTimer) {
    clearTimeout(state.elevationDebounceTimer);
    state.elevationDebounceTimer = null;
  }
  state.session = null;
  state.missionId = null;
  state.areaGeoJson = null;
  state.takeoffPoint = null;
  state.rawRoute = null;
  state.elevationResult = null;
  state.splitResult = null;
  state.customDrones = [];
  state.missionsCache = [];
}

function openModal(modalId) {
  const modal = $(modalId);
  if (!modal) return;
  modal.hidden = false;
  const focusable = modal.querySelector('input:not([type="hidden"]), button, select');
  if (focusable) {
    focusable.focus();
  }
}

function closeModal(modalId) {
  const modal = $(modalId);
  if (!modal) return;
  modal.hidden = true;
}

function closeAllModals() {
  ['modal-export', 'modal-missions', 'modal-custom-drone', 'modal-dji-guide'].forEach(closeModal);
}

function closePopovers() {
  const layersMenu = $('layers-menu');
  const layersBtn = $('btn-layers-toggle');
  const coordsPopover = $('coords-popover');
  const coordsBtn = $('btn-goto-coords');

  if (layersMenu) layersMenu.hidden = true;
  if (layersBtn) layersBtn.setAttribute('aria-expanded', 'false');
  if (coordsPopover) coordsPopover.hidden = true;
  if (coordsBtn) coordsBtn.setAttribute('aria-expanded', 'false');
}

function setMapHint(text) {
  const chip = $('map-hint-chip');
  if (!chip) return;
  if (!text) {
    chip.hidden = true;
    chip.textContent = '';
    return;
  }
  chip.textContent = text;
  chip.hidden = false;
}

function updateToolbarActiveState(mode) {
  const btnPoly = $('btn-tool-polygon');
  const btnCorr = $('btn-tool-corridor');
  const btnTakeoff = $('btn-tool-takeoff');

  if (btnPoly) btnPoly.classList.toggle('is-active', mode === 'draw-polygon');
  if (btnCorr) btnCorr.classList.toggle('is-active', mode === 'draw-line');
  if (btnTakeoff) btnTakeoff.classList.toggle('is-active', mode === 'takeoff');

  if (mode === 'draw-polygon') {
    setMapHint('Clique no mapa para adicionar vertices do poligono. Arraste para ajustar ou clique direito para remover.');
  } else if (mode === 'draw-line') {
    setMapHint('Clique no mapa para tracar o eixo do corredor linear. Arraste vertices para ajustar.');
  } else if (mode === 'takeoff') {
    setMapHint('Clique no mapa para definir o ponto de decolagem (Home).');
  } else {
    setMapHint('');
  }
}

function renderDroneSelector() {
  const select = $('select-drone');
  if (!select) return;

  select.innerHTML = '';

  const builtinGroup = document.createElement('optgroup');
  builtinGroup.label = 'Catalogo DJI Fly';
  BUILTIN_DRONES.forEach((drone) => {
    const opt = document.createElement('option');
    opt.value = drone.drone_key;
    opt.textContent = drone.name;
    builtinGroup.appendChild(opt);
  });
  select.appendChild(builtinGroup);

  if (state.customDrones.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Perfis Customizados';
    state.customDrones.forEach((profile) => {
      const opt = document.createElement('option');
      opt.value = `custom:${profile.id}`;
      opt.textContent = profile.name;
      customGroup.appendChild(opt);
    });
    select.appendChild(customGroup);
  }

  const active = getActiveDrone();
  state.droneKey = active.is_builtin ? active.drone_key : `custom:${active.id}`;
  select.value = state.droneKey;

  renderDroneSpecSummary(active);
}

function renderDroneSpecSummary(drone) {
  const el = $('drone-spec-summary');
  if (!el || !drone) return;
  const shutter = drone.has_mechanical_shutter ? 'Mecanico' : 'Eletronico';
  el.textContent =
    `Sensor ${drone.sensor_width_mm}x${drone.sensor_height_mm}mm | ` +
    `Focal ${drone.focal_length_mm}mm | ${drone.image_width_px}x${drone.image_height_px}px | ` +
    `${drone.max_flight_time_min} min | ${shutter}`;
}

function syncMissionTypeUI() {
  const buttons = document.querySelectorAll('#mission-type-group [data-mission-type]');
  buttons.forEach((btn) => {
    const active = btn.dataset.missionType === state.missionType;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const corridorGroup = $('corridor-width-group');
  if (corridorGroup) {
    corridorGroup.hidden = state.missionType !== 'corridor';
  }
}

function syncAltitudeModeUI() {
  const buttons = document.querySelectorAll('#altitude-mode-group [data-altitude-mode]');
  buttons.forEach((btn) => {
    const active = btn.dataset.altitudeMode === state.params.altitudeMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function syncTriggerModeUI() {
  const buttons = document.querySelectorAll('#trigger-mode-group [data-trigger-mode]');
  buttons.forEach((btn) => {
    const active = btn.dataset.triggerMode === state.params.triggerMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const hint = $('manual-trigger-hint');
  const intervalVal = $('manual-trigger-interval-value');
  if (hint) {
    hint.hidden = state.params.triggerMode !== 'manual';
  }
  if (intervalVal && state.photogrammetry) {
    intervalVal.textContent = `${state.photogrammetry.intervalS}s`;
  }
}

function syncIntervalModeUI() {
  const buttons = document.querySelectorAll('#interval-mode-group [data-interval]');
  const currentVal = String(state.params.intervalMode);
  buttons.forEach((btn) => {
    const active = btn.dataset.interval === currentVal;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const badge = $('interval-effective-badge');
  if (badge && state.photogrammetry) {
    badge.textContent = state.params.intervalMode === 'auto'
      ? `Auto (${state.photogrammetry.intervalS}s)`
      : `Travado (${state.photogrammetry.intervalS}s)`;
  }
}

function syncTakeoffInfoUI() {
  const el = $('takeoff-info');
  if (!el) return;
  if (!state.takeoffPoint) {
    el.textContent = 'Ponto de decolagem: nao definido';
    return;
  }
  const latStr = state.takeoffPoint.lat.toFixed(6);
  const lonStr = state.takeoffPoint.lon.toFixed(6);
  const tag = state.takeoffIsSuggested ? ' (sugerido)' : ' (confirmado)';
  const elevText = state.elevationResult && Number.isFinite(state.elevationResult.stats.takeoffElevationM)
    ? ` | ${state.elevationResult.stats.takeoffElevationM.toFixed(1)} m MSL`
    : '';
  el.textContent = `Decolagem${tag}: ${latStr}, ${lonStr}${elevText}`;
}

function syncAllInputsFromState() {
  const pairs = [
    ['input-altitude', 'range-altitude', state.params.altitudeM],
    ['input-front-overlap', 'range-front-overlap', state.params.frontOverlapPct],
    ['input-side-overlap', 'range-side-overlap', state.params.sideOverlapPct],
    ['input-max-speed', 'range-max-speed', state.params.maxSpeedMs],
    ['input-rotation', 'range-rotation', state.params.rotationDeg],
    ['input-overshoot', 'range-overshoot', state.params.overshootM],
    ['input-gimbal', 'range-gimbal', state.params.gimbalPitchDeg],
    ['input-corridor-width', 'range-corridor-width', state.params.corridorWidthM]
  ];

  pairs.forEach(([numId, rangeId, value]) => {
    const numEl = $(numId);
    const rangeEl = $(rangeId);
    if (numEl) numEl.value = String(value);
    if (rangeEl) rangeEl.value = String(value);
  });

  const nameEl = $('input-mission-name');
  if (nameEl) nameEl.value = state.missionName;

  const revEl = $('toggle-reverse-direction');
  if (revEl) revEl.checked = Boolean(state.params.reverseDirection);

  const strEl = $('toggle-straighten-path');
  if (strEl) strEl.checked = Boolean(state.params.straightenFlightPath);

  const finishEl = $('select-finish-action');
  if (finishEl) finishEl.value = state.params.finishAction;

  const maxWpEl = $('input-max-waypoints');
  if (maxWpEl) maxWpEl.value = String(state.params.maxWaypointsPerPart);

  const reserveEl = $('input-battery-reserve');
  if (reserveEl) reserveEl.value = String(state.params.batteryReservePct);

  syncMissionTypeUI();
  syncAltitudeModeUI();
  syncTriggerModeUI();
  syncIntervalModeUI();
  syncTakeoffInfoUI();
}

function renderPhotogrammetryReadout() {
  const p = state.photogrammetry;
  if (!p) return;

  const gsdEl = $('readout-gsd');
  const spacingEl = $('readout-line-spacing');
  const photoDistEl = $('readout-photo-dist');
  const speedEl = $('readout-speed');

  if (gsdEl) gsdEl.textContent = `${p.gsdCm.toFixed(2)} cm/px`;
  if (spacingEl) spacingEl.textContent = `${p.lineSpacingM.toFixed(1)} m`;
  if (photoDistEl) photoDistEl.textContent = `${p.photoDistanceM.toFixed(1)} m`;
  if (speedEl) {
    speedEl.textContent = `${p.flightSpeedMs.toFixed(1)} m/s (${p.effectiveFrontOverlapPct.toFixed(0)}%)`;
  }

  const metricGsd = $('metric-gsd');
  const metricSpacing = $('metric-spacing');
  const metricIntSpd = $('metric-interval-speed');
  if (metricGsd) metricGsd.textContent = `${p.gsdCm.toFixed(2)} cm/px`;
  if (metricSpacing) metricSpacing.textContent = `${p.lineSpacingM.toFixed(1)} m`;
  if (metricIntSpd) metricIntSpd.textContent = `${p.intervalS}s @ ${p.flightSpeedMs.toFixed(1)} m/s`;

  syncIntervalModeUI();
  syncTriggerModeUI();
}

function renderAlerts() {
  const container = $('alerts-container');
  if (!container) return;

  const alerts = [];

  if (state.photogrammetry && Array.isArray(state.photogrammetry.alerts)) {
    alerts.push(...state.photogrammetry.alerts);
  }

  if (
    state.params.altitudeMode === 'terrain_follow' &&
    state.takeoffPoint &&
    state.takeoffIsSuggested
  ) {
    alerts.push({
      level: 'warning',
      code: 'TAKEOFF_SUGGESTED',
      message:
        'Ponto de decolagem sugerido automaticamente. Confirme ou arraste o pino H para o local real de decolagem antes de exportar com Terrain Follow.'
    });
  }

  if (state.params.altitudeMode === 'terrain_follow' && state.areaGeoJson) {
    alerts.push({
      level: 'warning',
      code: 'SRTM_ACCURACY',
      message:
        'O relevo SRTM (30 m) nao detecta arvores, torres ou cabos. Mantenha margem segura de altitude AGL.'
    });
  }

  if (state.elevationResult && Array.isArray(state.elevationResult.alerts)) {
    alerts.push(...state.elevationResult.alerts);
  }

  if (alerts.length === 0) {
    container.innerHTML = '<p class="muted-note">Nenhum alerta ativo.</p>';
    return;
  }

  container.innerHTML = alerts
    .map((alert) => {
      const cls = alert.level === 'danger' ? 'alert-card alert-danger' : 'alert-card alert-warning';
      return `<div class="${cls}">${escapeHtml(alert.message)}</div>`;
    })
    .join('');
}

function renderTelemetryAndParts() {
  const distEl = $('metric-distance');
  const durEl = $('metric-duration');
  const photosEl = $('metric-photos');
  const batEl = $('metric-batteries');
  const areaEl = $('metric-area');
  const partsList = $('battery-parts-list');

  if (areaEl) {
    areaEl.textContent = state.areaSqm > 0 ? formatArea(state.areaSqm) : '--';
  }

  if (!state.splitResult || state.splitResult.parts.length === 0) {
    if (distEl) distEl.textContent = '--';
    if (durEl) durEl.textContent = '--';
    if (photosEl) photosEl.textContent = '--';
    if (batEl) batEl.textContent = '--';
    if (partsList) {
      partsList.innerHTML = '<p class="muted-note">Desenhe ou importe uma area para calcular as partes.</p>';
    }
    return;
  }

  const totals = state.splitResult.totals;
  if (distEl) distEl.textContent = formatDistance(totals.totalDistanceM);
  if (durEl) durEl.textContent = formatDuration(totals.durationMin);
  if (photosEl) photosEl.textContent = String(totals.estimatedPhotos);
  if (batEl) batEl.textContent = `${totals.batteryCount} bat`;

  if (partsList) {
    partsList.innerHTML = state.splitResult.parts
      .map((part) => {
        const safeColor = escapeHtml(part.color || '#00d992');
        return `
          <div class="part-card" style="border-left-color: ${safeColor};">
            <div class="part-card-header">
              <span>${escapeHtml(part.label)}</span>
              <span class="mono">${part.batteryUsagePct.toFixed(0)}% bat</span>
            </div>
            <div class="part-card-meta">
              <span>${formatDistance(part.totalDistanceM)}</span>
              <span>${formatDuration(part.durationMin)}</span>
              <span>${part.waypointCount} wps</span>
              <span>${part.estimatedPhotos} fotos</span>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function renderElevationStatusUI() {
  const bar = $('elevation-status-bar');
  const loading = $('elevation-loading');
  const errorBox = $('elevation-error');
  const errorMsg = $('elevation-error-msg');

  if (!bar || !loading || !errorBox) return;

  if (state.elevationStatus === 'loading') {
    bar.hidden = false;
    loading.hidden = false;
    errorBox.hidden = true;
  } else if (state.elevationStatus === 'error') {
    bar.hidden = false;
    loading.hidden = true;
    errorBox.hidden = false;
    if (errorMsg) {
      errorMsg.textContent = state.elevationError || 'Falha ao consultar elevacao do terreno.';
    }
  } else {
    bar.hidden = true;
    loading.hidden = true;
    errorBox.hidden = true;
  }
}

function renderProfileChartUI() {
  const panel = $('profile-panel');
  const chartContainer = $('elevation-profile-chart');
  const sourceBadge = $('profile-source-badge');
  const minAglEl = $('profile-min-agl');
  const maxAglEl = $('profile-max-agl');
  const rangeEl = $('profile-terrain-range');

  if (!chartContainer) return;

  if (!state.elevationResult || !state.elevationResult.waypoints.length) {
    if (minAglEl) minAglEl.textContent = '--';
    if (maxAglEl) maxAglEl.textContent = '--';
    if (rangeEl) rangeEl.textContent = '--';
    if (sourceBadge) sourceBadge.textContent = 'SRTM';
    chartContainer.innerHTML = '<p class="muted-note">Desenhe uma area para visualizar o perfil altimetrico.</p>';
    return;
  }

  const stats = state.elevationResult.stats;
  if (sourceBadge) {
    const labels = {
      terrarium: 'AWS SRTM',
      'open-meteo': 'Open-Meteo',
      mixed: 'SRTM + Open-Meteo'
    };
    sourceBadge.textContent = labels[state.elevationSource] || 'SRTM';
  }
  if (minAglEl) minAglEl.textContent = `${stats.minClearanceM.toFixed(1)} m`;
  if (maxAglEl) maxAglEl.textContent = `${stats.maxClearanceM.toFixed(1)} m`;
  if (rangeEl) rangeEl.textContent = `${stats.minGroundM.toFixed(0)} a ${stats.maxGroundM.toFixed(0)} m`;

  if (panel && !panel.hidden) {
    state.profileChartHandle = renderElevationProfile(chartContainer, state.elevationResult.waypoints, {
      minClearanceWarningM: 20,
      height: 170,
      onHoverPoint: (pt) => {
        if (state.mapController) {
          state.mapController.setHoverMarker(pt);
        }
      }
    });
  }
}

function recomputeSplitAndRenderMap() {
  const drone = getActiveDrone();
  const activeWaypoints =
    state.elevationResult && state.elevationResult.waypoints.length >= 2
      ? state.elevationResult.waypoints
      : (state.rawRoute ? state.rawRoute.waypoints : []);

  if (!activeWaypoints || activeWaypoints.length < 2) {
    state.splitResult = null;
    if (state.mapController) state.mapController.clearMissionParts();
    renderTelemetryAndParts();
    renderAlerts();
    return;
  }

  const takeoff = state.takeoffPoint || suggestTakeoffPoint(activeWaypoints);
  state.splitResult = splitMissionByBattery(activeWaypoints, takeoff, drone, {
    flightSpeedMs: state.photogrammetry.flightSpeedMs,
    transitionSpeedMs: Math.max(state.photogrammetry.flightSpeedMs, 9.0),
    intervalS: state.photogrammetry.intervalS,
    altitudeAglM: state.params.altitudeM,
    reserveRatio: Math.max(0.05, Math.min(0.5, state.params.batteryReservePct / 100)),
    maxWaypointsPerPart: Math.max(10, Math.min(500, Math.round(state.params.maxWaypointsPerPart)))
  });

  if (state.mapController) {
    state.mapController.renderMissionParts(state.splitResult.parts, { takeoffPoint: takeoff });
  }

  renderTelemetryAndParts();
  renderAlerts();
}

function cancelPendingElevation() {
  if (state.elevationDebounceTimer) {
    clearTimeout(state.elevationDebounceTimer);
    state.elevationDebounceTimer = null;
  }
  if (state.elevationAbortController) {
    state.elevationAbortController.abort();
    state.elevationAbortController = null;
  }
}

function scheduleElevationUpdate() {
  if (state.elevationDebounceTimer) {
    clearTimeout(state.elevationDebounceTimer);
  }
  state.elevationDebounceTimer = window.setTimeout(() => {
    state.elevationDebounceTimer = null;
    runElevationUpdate();
  }, 280);
}

async function runElevationUpdate() {
  if (!state.rawRoute || !state.rawRoute.waypoints || state.rawRoute.waypoints.length < 2) {
    state.elevationResult = null;
    state.elevationStatus = 'idle';
    renderElevationStatusUI();
    renderProfileChartUI();
    return;
  }

  if (state.elevationAbortController) {
    state.elevationAbortController.abort();
  }
  const controller = new AbortController();
  state.elevationAbortController = controller;

  const baseWaypoints = state.params.altitudeMode === 'terrain_follow'
    ? densifyWaypointsForTerrain(state.rawRoute.waypoints, 50)
    : state.rawRoute.waypoints.map((wp) => ({ ...wp }));

  const takeoff = state.takeoffPoint || suggestTakeoffPoint(baseWaypoints);
  const queryPoints = [
    { lat: takeoff.lat, lon: takeoff.lon },
    ...baseWaypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon }))
  ];

  state.elevationStatus = 'loading';
  state.elevationError = null;
  renderElevationStatusUI();

  try {
    const response = await fetchElevations(queryPoints, {
      zoom: 12,
      signal: controller.signal
    });

    if (controller.signal.aborted) return;

    const takeoffElevationM = response.elevations[0];
    const waypointsWithGround = baseWaypoints.map((wp, idx) => ({
      ...wp,
      groundElevationM: response.elevations[idx + 1]
    }));

    state.elevationSource = response.source;
    state.elevationResult = computeRelativeAltitudes(
      waypointsWithGround,
      takeoffElevationM,
      state.params.altitudeM,
      state.params.altitudeMode
    );
    state.elevationStatus = 'success';
    renderElevationStatusUI();
    syncTakeoffInfoUI();
    renderProfileChartUI();
    recomputeSplitAndRenderMap();
  } catch (err) {
    if (controller.signal.aborted) return;
    state.elevationStatus = 'error';
    state.elevationError = err && err.message ? err.message : 'Erro ao consultar elevacao.';
    state.elevationResult = null;
    renderElevationStatusUI();
    renderProfileChartUI();
    recomputeSplitAndRenderMap();
  }
}

function recomputeMission({ fetchElevation = true } = {}) {
  const drone = getActiveDrone();
  state.photogrammetry = calculatePhotogrammetry(drone, {
    altitudeM: state.params.altitudeM,
    frontOverlapPct: state.params.frontOverlapPct,
    sideOverlapPct: state.params.sideOverlapPct,
    maxSpeedMs: state.params.maxSpeedMs,
    intervalMode: state.params.intervalMode
  });

  renderPhotogrammetryReadout();

  if (!state.areaGeoJson) {
    cancelPendingElevation();
    state.rawRoute = null;
    state.elevationResult = null;
    state.elevationStatus = 'idle';
    state.splitResult = null;
    state.areaSqm = 0;
    if (state.mapController) {
      state.mapController.clearMissionParts();
      state.mapController.setHoverMarker(null);
    }
    renderElevationStatusUI();
    renderProfileChartUI();
    renderTelemetryAndParts();
    renderAlerts();
    return;
  }

  if (fetchElevation) {
    cancelPendingElevation();
    state.elevationResult = null;
    state.elevationStatus = 'idle';
    renderElevationStatusUI();
    renderProfileChartUI();
  }

  try {
    const geomType = state.areaGeoJson.geometry && state.areaGeoJson.geometry.type;

    if (state.missionType === 'corridor' || geomType === 'LineString') {
      state.rawRoute = generateCorridor(state.areaGeoJson, {
        corridorWidthM: state.params.corridorWidthM,
        lineSpacingM: state.photogrammetry.lineSpacingM,
        overshootM: state.params.overshootM,
        reverseDirection: state.params.reverseDirection,
        straightenFlightPath: state.params.straightenFlightPath
      });
      state.areaSqm = state.rawRoute.stats.mappingDistanceM * state.photogrammetry.lineSpacingM;
    } else if (state.missionType === 'double_grid') {
      state.rawRoute = generateDoubleGrid(state.areaGeoJson, {
        lineSpacingM: state.photogrammetry.lineSpacingM,
        angleDeg: state.params.rotationDeg,
        overshootM: state.params.overshootM,
        reverseDirection: state.params.reverseDirection,
        straightenFlightPath: state.params.straightenFlightPath
      });
      state.areaSqm = computeAreaSqm(state.areaGeoJson);
    } else {
      state.rawRoute = generateSimpleGrid(state.areaGeoJson, {
        lineSpacingM: state.photogrammetry.lineSpacingM,
        angleDeg: state.params.rotationDeg,
        overshootM: state.params.overshootM,
        reverseDirection: state.params.reverseDirection,
        straightenFlightPath: state.params.straightenFlightPath
      });
      state.areaSqm = computeAreaSqm(state.areaGeoJson);
    }
  } catch (err) {
    state.rawRoute = null;
    state.splitResult = null;
    showToast(err.message || 'Erro ao gerar geometria da missao.', 'danger');
    renderTelemetryAndParts();
    renderAlerts();
    return;
  }

  // Sugerir ponto de decolagem automaticamente se o usuario ainda nao definiu manualmente
  if (state.rawRoute && state.rawRoute.waypoints.length > 0) {
    if (!state.takeoffPoint || state.takeoffIsSuggested) {
      const suggested = suggestTakeoffPoint(state.rawRoute.waypoints);
      if (suggested) {
        state.takeoffPoint = { ...suggested, isManual: false };
        state.takeoffIsSuggested = true;
        if (state.mapController) {
          state.mapController.setTakeoffPoint(state.takeoffPoint, { isSuggested: true, emit: false });
        }
      }
    }
  }

  syncTakeoffInfoUI();
  recomputeSplitAndRenderMap();

  if (fetchElevation) {
    scheduleElevationUpdate();
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function buildExportConfig(fileSlug) {
  return {
    missionName: state.missionName,
    fileSlug,
    finishAction: state.params.finishAction,
    altitudeAglM: state.params.altitudeM,
    flightSpeedMs: state.photogrammetry ? state.photogrammetry.flightSpeedMs : state.params.maxSpeedMs,
    transitionSpeedMs: Math.max(
      state.photogrammetry ? state.photogrammetry.flightSpeedMs : 9.0,
      9.0
    ),
    gimbalPitchDeg: state.params.gimbalPitchDeg,
    intervalS: state.photogrammetry ? state.photogrammetry.intervalS : 3,
    triggerMode: state.params.triggerMode,
    straightenFlightPath: state.params.straightenFlightPath
  };
}

function validateBeforeExport() {
  if (!state.areaGeoJson) {
    return 'Desenhe ou importe uma area ou corredor antes de exportar.';
  }
  if (!state.splitResult || !state.splitResult.parts || state.splitResult.parts.length === 0) {
    return 'Nenhuma rota valida gerada. Verifique a area e o espacamento entre linhas.';
  }
  if (state.splitResult.totals.waypointCount < 2) {
    return 'A missao precisa ter pelo menos 2 waypoints para exportar.';
  }
  if (!Number.isFinite(state.params.altitudeM) || state.params.altitudeM <= 0) {
    return 'Altitude AGL invalida.';
  }
  return null;
}

function populateExportModal() {
  const filenameInput = $('export-filename-input');
  const summaryGrid = $('export-summary-metrics');
  const manualBanner = $('export-manual-trigger-banner');
  const manualInterval = $('export-manual-interval');
  const validationBox = $('export-validation-error');
  const partsContainer = $('export-parts-list');
  const downloadAllBtn = $('btn-export-download-all');

  if (filenameInput) {
    filenameInput.value = slugifyMissionName(state.missionName);
  }

  const validationError = validateBeforeExport();
  if (validationBox) {
    validationBox.hidden = !validationError;
    validationBox.textContent = validationError || '';
  }

  if (manualBanner) {
    manualBanner.hidden = state.params.triggerMode !== 'manual';
  }
  if (manualInterval && state.photogrammetry) {
    manualInterval.textContent = `${state.photogrammetry.intervalS}s`;
  }

  if (validationError) {
    if (summaryGrid) summaryGrid.innerHTML = '';
    if (partsContainer) partsContainer.innerHTML = '';
    if (downloadAllBtn) downloadAllBtn.disabled = true;
    return;
  }

  const { parts, totals } = state.splitResult;
  if (summaryGrid) {
    summaryGrid.innerHTML = `
      <div class="readout-cell"><span class="readout-label">Partes</span><strong>${parts.length}</strong></div>
      <div class="readout-cell"><span class="readout-label">Duracao</span><strong>${formatDuration(totals.durationMin)}</strong></div>
      <div class="readout-cell"><span class="readout-label">Waypoints</span><strong>${totals.waypointCount}</strong></div>
      <div class="readout-cell"><span class="readout-label">Fotos Est.</span><strong>${totals.estimatedPhotos}</strong></div>
    `;
  }

  if (partsContainer) {
    partsContainer.innerHTML = parts
      .map((part, idx) => `
        <div class="part-card" style="border-left-color: ${escapeHtml(part.color || '#00d992')};">
          <div class="part-card-header">
            <span>${escapeHtml(part.label)} (${part.waypointCount} wps / ${formatDuration(part.durationMin)})</span>
            <button type="button" class="btn btn-secondary btn-xs" data-export-part-index="${idx}">
              Baixar .kmz
            </button>
          </div>
        </div>
      `)
      .join('');
  }

  if (downloadAllBtn) {
    downloadAllBtn.disabled = false;
    downloadAllBtn.textContent = parts.length > 1
      ? `Baixar ZIP (${parts.length} partes)`
      : 'Baixar KMZ';
  }
}

async function handleExportAll() {
  const validationError = validateBeforeExport();
  if (validationError) {
    showToast(validationError, 'danger');
    return;
  }

  const filenameInput = $('export-filename-input');
  const slug = slugifyMissionName(filenameInput ? filenameInput.value : state.missionName);
  const config = buildExportConfig(slug);

  try {
    const pkg = await exportMissionPackage(state.splitResult.parts, config, globalThis.JSZip);
    if (!pkg.blob) {
      throw new Error('Navegador sem suporte a Blob para download.');
    }
    triggerBlobDownload(pkg.blob, pkg.filename);
    showToast(`Arquivo ${pkg.filename} gerado com sucesso.`, 'success');
  } catch (err) {
    showToast(err.message || 'Falha ao exportar pacote KMZ.', 'danger');
  }
}

async function handleExportSinglePart(partIdx) {
  const validationError = validateBeforeExport();
  if (validationError) {
    showToast(validationError, 'danger');
    return;
  }

  const part = state.splitResult.parts[partIdx];
  if (!part) return;

  const filenameInput = $('export-filename-input');
  const slug = slugifyMissionName(filenameInput ? filenameInput.value : state.missionName);
  const config = {
    ...buildExportConfig(slug),
    totalParts: state.splitResult.parts.length
  };

  try {
    const result = await exportSinglePartKmz(part, config, globalThis.JSZip);
    if (!result.blob) {
      throw new Error('Navegador sem suporte a Blob para download.');
    }
    triggerBlobDownload(result.blob, result.filename);
    showToast(`Arquivo ${result.filename} baixado.`, 'success');
  } catch (err) {
    showToast(err.message || 'Falha ao exportar parte KMZ.', 'danger');
  }
}

function setMissionsModalState(mode, errorMessage = '') {
  const loading = $('missions-state-loading');
  const empty = $('missions-state-empty');
  const errorBox = $('missions-state-error');
  const errorText = $('missions-error-message');
  const success = $('missions-state-success');

  if (loading) loading.hidden = mode !== 'loading';
  if (empty) empty.hidden = mode !== 'empty';
  if (errorBox) errorBox.hidden = mode !== 'error';
  if (success) success.hidden = mode !== 'success';
  if (errorText && errorMessage) errorText.textContent = errorMessage;
}

function renderMissionsList(filterText = '') {
  const listEl = $('missions-list');
  if (!listEl) return;

  const query = String(filterText || '').trim().toLowerCase();
  const filtered = query
    ? state.missionsCache.filter((m) => String(m.name || '').toLowerCase().includes(query))
    : state.missionsCache;

  if (state.missionsCache.length === 0) {
    setMissionsModalState('empty');
    return;
  }

  setMissionsModalState('success');

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="muted-note">Nenhuma missao encontrada para o filtro informado.</p>';
    return;
  }

  const typeLabels = {
    grid: 'Grade',
    double_grid: 'Dupla 3D',
    corridor: 'Corredor'
  };

  listEl.innerHTML = filtered
    .map((mission) => {
      const updated = mission.updated_at
        ? new Date(mission.updated_at).toLocaleDateString('pt-BR')
        : '';
      const metrics = mission.summary_metrics || {};
      const bats = metrics.batteryCount ? `${metrics.batteryCount} bat` : '';
      const dist = metrics.totalDistanceM ? formatDistance(metrics.totalDistanceM) : '';
      const metaParts = [typeLabels[mission.mission_type] || mission.mission_type, dist, bats, updated]
        .filter(Boolean)
        .join(' | ');

      return `
        <div class="part-card" data-mission-id="${escapeHtml(mission.id)}">
          <div class="part-card-header">
            <span>${escapeHtml(mission.name)}</span>
          </div>
          <div class="mission-item-meta">${escapeHtml(metaParts)}</div>
          <div class="mission-item-actions">
            <button type="button" class="btn btn-primary btn-xs" data-mission-action="open" data-mission-id="${escapeHtml(mission.id)}">Abrir</button>
            <button type="button" class="btn btn-secondary btn-xs" data-mission-action="duplicate" data-mission-id="${escapeHtml(mission.id)}">Duplicar</button>
            <button type="button" class="btn btn-ghost btn-xs" data-mission-action="delete" data-mission-id="${escapeHtml(mission.id)}">Excluir</button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadMissionsList() {
  if (!state.supabaseClient || !state.session) {
    setMissionsModalState('error', 'Sessao nao autenticada.');
    return;
  }

  setMissionsModalState('loading');
  try {
    const missions = await listMissions(state.supabaseClient, state.session.user.id);
    state.missionsCache = missions;
    const searchEl = $('input-search-missions');
    renderMissionsList(searchEl ? searchEl.value : '');
  } catch (err) {
    setMissionsModalState('error', err && err.message ? err.message : 'Falha ao carregar missoes.');
  }
}

async function handleSaveMission() {
  if (!state.supabaseClient || !state.session) {
    showToast('Sessao nao autenticada para salvar no banco.', 'danger');
    return;
  }
  if (!state.areaGeoJson) {
    showToast('Desenhe ou importe uma area antes de salvar a missao.', 'danger');
    return;
  }

  const nameInput = $('input-mission-name');
  const missionName = String((nameInput && nameInput.value) || state.missionName || 'Nova Missao').trim() || 'Nova Missao';
  state.missionName = missionName;

  const btn = $('btn-save-mission');
  if (btn) btn.disabled = true;

  try {
    const saved = await saveMission(state.supabaseClient, state.session.user.id, {
      id: state.missionId,
      name: missionName,
      mission_type: state.missionType,
      drone_key: state.droneKey,
      area_geojson: state.areaGeoJson,
      takeoff_point: state.takeoffPoint,
      flight_params: { ...state.params },
      summary_metrics: {
        areaSqm: state.areaSqm,
        ...(state.splitResult ? state.splitResult.totals : {}),
        gsdCm: state.photogrammetry ? state.photogrammetry.gsdCm : null
      }
    });
    state.missionId = saved.id;
    showToast(`Missao "${saved.name}" salva com sucesso.`, 'success');
  } catch (err) {
    showToast(err && err.message ? err.message : 'Falha ao salvar missao.', 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function loadMissionIntoWorkspace(mission) {
  state.missionId = mission.id;
  state.missionName = mission.name || 'Missao Carregada';
  state.missionType = mission.mission_type || 'grid';
  state.droneKey = mission.drone_key || 'dji-mini-4-pro';
  state.params = {
    ...DEFAULT_PARAMS,
    ...(mission.flight_params || {})
  };
  state.areaGeoJson = mission.area_geojson || null;
  state.takeoffPoint = mission.takeoff_point || null;
  state.takeoffIsSuggested = Boolean(mission.takeoff_point && mission.takeoff_point.isManual === false);

  renderDroneSelector();
  syncAllInputsFromState();

  if (state.mapController) {
    if (state.areaGeoJson) {
      state.mapController.setGeometry(state.areaGeoJson, { fit: true, emit: false });
    } else {
      state.mapController.clearGeometry();
    }
    if (state.takeoffPoint) {
      state.mapController.setTakeoffPoint(state.takeoffPoint, {
        isSuggested: state.takeoffIsSuggested,
        emit: false
      });
    } else {
      state.mapController.clearTakeoffPoint();
    }
  }

  recomputeMission({ fetchElevation: true });
  closeModal('modal-missions');
  showToast(`Missao "${state.missionName}" carregada.`, 'success');
}

function renderCustomDronesList() {
  const container = $('custom-drones-list');
  if (!container) return;

  if (state.customDrones.length === 0) {
    container.innerHTML = '<p class="muted-note">Nenhum perfil customizado salvo ainda.</p>';
    return;
  }

  container.innerHTML = state.customDrones
    .map((profile) => `
      <div class="part-card">
        <div class="part-card-header">
          <span>${escapeHtml(profile.name)}</span>
          <div class="mission-item-actions">
            <button type="button" class="btn btn-secondary btn-xs" data-drone-action="edit" data-drone-id="${escapeHtml(profile.id)}">Editar</button>
            <button type="button" class="btn btn-ghost btn-xs" data-drone-action="delete" data-drone-id="${escapeHtml(profile.id)}">Excluir</button>
          </div>
        </div>
        <div class="mission-item-meta">
          ${profile.sensor_width_mm}x${profile.sensor_height_mm}mm | f=${profile.focal_length_mm}mm | ${profile.image_width_px}x${profile.image_height_px}px | ${profile.max_flight_time_min} min
        </div>
      </div>
    `)
    .join('');
}

function resetCustomDroneForm() {
  const form = $('form-custom-drone');
  if (form) form.reset();
  const idEl = $('custom-drone-id');
  if (idEl) idEl.value = '';
  const errEl = $('custom-drone-error');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }
}

function populateCustomDroneForm(profile) {
  if (!profile) return;
  const setVal = (id, val) => {
    const el = $(id);
    if (el) el.value = String(val ?? '');
  };
  setVal('custom-drone-id', profile.id || '');
  setVal('custom-drone-name', profile.name || '');
  setVal('custom-drone-sensor-w', profile.sensor_width_mm);
  setVal('custom-drone-sensor-h', profile.sensor_height_mm);
  setVal('custom-drone-focal', profile.focal_length_mm);
  setVal('custom-drone-flight-time', profile.max_flight_time_min);
  setVal('custom-drone-img-w', profile.image_width_px);
  setVal('custom-drone-img-h', profile.image_height_px);
  setVal('custom-drone-max-speed', profile.max_safe_speed_ms);
  const shutterEl = $('custom-drone-mech-shutter');
  if (shutterEl) shutterEl.checked = Boolean(profile.has_mechanical_shutter);
}

async function handleSaveCustomDrone(event) {
  event.preventDefault();
  const errEl = $('custom-drone-error');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }

  const raw = {
    id: ($('custom-drone-id') && $('custom-drone-id').value) || undefined,
    name: $('custom-drone-name') ? $('custom-drone-name').value : '',
    sensor_width_mm: Number($('custom-drone-sensor-w') && $('custom-drone-sensor-w').value),
    sensor_height_mm: Number($('custom-drone-sensor-h') && $('custom-drone-sensor-h').value),
    focal_length_mm: Number($('custom-drone-focal') && $('custom-drone-focal').value),
    image_width_px: Number($('custom-drone-img-w') && $('custom-drone-img-w').value),
    image_height_px: Number($('custom-drone-img-h') && $('custom-drone-img-h').value),
    max_flight_time_min: Number($('custom-drone-flight-time') && $('custom-drone-flight-time').value),
    max_safe_speed_ms: Number($('custom-drone-max-speed') && $('custom-drone-max-speed').value),
    has_mechanical_shutter: Boolean($('custom-drone-mech-shutter') && $('custom-drone-mech-shutter').checked)
  };

  const validation = validateCustomDrone(raw);
  if (!validation.valid) {
    if (errEl) {
      errEl.textContent = validation.errors.join(' ');
      errEl.hidden = false;
    }
    return;
  }

  try {
    const saved = await saveCustomDrone(state.supabaseClient, state.session.user.id, {
      ...validation.normalized,
      id: raw.id || undefined
    });
    const idx = state.customDrones.findIndex((d) => d.id === saved.id);
    if (idx >= 0) {
      state.customDrones[idx] = saved;
    } else {
      state.customDrones.unshift(saved);
    }
    state.droneKey = `custom:${saved.id}`;
    renderDroneSelector();
    renderCustomDronesList();
    resetCustomDroneForm();
    recomputeMission({ fetchElevation: true });
    showToast(`Perfil "${saved.name}" salvo.`, 'success');
  } catch (err) {
    if (errEl) {
      errEl.textContent = err && err.message ? err.message : 'Falha ao salvar perfil customizado.';
      errEl.hidden = false;
    }
  }
}

function bindSliderAndNumber(rangeId, numberId, paramKey, { min, max, fetchElevation = false } = {}) {
  const rangeEl = $(rangeId);
  const numEl = $(numberId);

  const applyValue = (rawVal) => {
    let val = Number(rawVal);
    if (!Number.isFinite(val)) return;
    if (min !== undefined) val = Math.max(min, val);
    if (max !== undefined) val = Math.min(max, val);
    state.params[paramKey] = val;
    if (rangeEl) rangeEl.value = String(val);
    if (numEl) numEl.value = String(val);
    recomputeMission({ fetchElevation });
  };

  if (rangeEl) {
    rangeEl.addEventListener('input', () => applyValue(rangeEl.value));
  }
  if (numEl) {
    numEl.addEventListener('change', () => applyValue(numEl.value));
  }
}

function bindFallbackListenersOnce() {
  const retryBtn = $('btn-error-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      globalThis.location.reload();
    });
  }
  const portalBtn = $('btn-error-portal');
  if (portalBtn) {
    portalBtn.addEventListener('click', () => {
      safeRedirectToPortal();
    });
  }
}

function bindStaticListenersOnce() {
  if (state.listenersBound) return;
  state.listenersBound = true;

  // Toolbar do mapa
  const btnPoly = $('btn-tool-polygon');
  if (btnPoly) {
    btnPoly.addEventListener('click', () => {
      if (state.missionType === 'corridor') {
        state.missionType = 'grid';
        syncMissionTypeUI();
      }
      if (state.mapController) {
        state.mapController.setGeometryType('polygon', { clearIfChanged: true });
        state.mapController.setMode('draw-polygon');
      }
    });
  }

  const btnCorr = $('btn-tool-corridor');
  if (btnCorr) {
    btnCorr.addEventListener('click', () => {
      state.missionType = 'corridor';
      syncMissionTypeUI();
      if (state.mapController) {
        state.mapController.setGeometryType('line', { clearIfChanged: true });
        state.mapController.setMode('draw-line');
      }
    });
  }

  const btnTakeoff = $('btn-tool-takeoff');
  if (btnTakeoff) {
    btnTakeoff.addEventListener('click', () => {
      if (state.mapController) {
        state.mapController.setMode('takeoff');
      }
    });
  }

  const btnImport = $('btn-import-area');
  const fileInput = $('input-import-file');
  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseAreaFile(file.name, text);
        state.areaGeoJson = parsed.geojson;
        state.takeoffPoint = null;
        state.takeoffIsSuggested = false;

        if (parsed.geometryType === 'line') {
          state.missionType = 'corridor';
          if (state.mapController) state.mapController.setMode('draw-line');
        } else if (state.missionType === 'corridor') {
          state.missionType = 'grid';
          if (state.mapController) state.mapController.setMode('draw-polygon');
        }

        syncMissionTypeUI();
        if (state.mapController) {
          state.mapController.setGeometry(parsed.geojson, { fit: true, emit: false });
        }

        recomputeMission({ fetchElevation: true });
        showToast(`Arquivo "${file.name}" importado com sucesso.`, 'success');
      } catch (err) {
        showToast(err && err.message ? err.message : 'Erro ao importar arquivo.', 'danger');
      }
    });
  }

  const btnClear = $('btn-clear-area');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      cancelPendingElevation();
      state.missionId = null;
      state.areaGeoJson = null;
      state.takeoffPoint = null;
      state.takeoffIsSuggested = false;
      state.rawRoute = null;
      state.elevationResult = null;
      state.elevationStatus = 'idle';
      state.splitResult = null;
      if (state.mapController) {
        state.mapController.clearGeometry();
        state.mapController.clearTakeoffPoint();
      }
      syncTakeoffInfoUI();
      renderElevationStatusUI();
      renderProfileChartUI();
      renderTelemetryAndParts();
      renderAlerts();
      showToast('Area e rota limpas.');
    });
  }

  // Camadas base
  const btnLayers = $('btn-layers-toggle');
  const layersMenu = $('layers-menu');
  if (btnLayers && layersMenu) {
    btnLayers.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const willOpen = layersMenu.hidden;
      closePopovers();
      layersMenu.hidden = !willOpen;
      btnLayers.setAttribute('aria-expanded', String(willOpen));
    });

    layersMenu.addEventListener('click', (ev) => {
      const item = ev.target.closest('[data-layer]');
      if (!item || !state.mapController) return;
      const layerKey = item.dataset.layer;
      state.mapController.setBaseLayer(layerKey);
      layersMenu.querySelectorAll('[data-layer]').forEach((btn) => {
        const active = btn.dataset.layer === layerKey;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', String(active));
      });
      closePopovers();
    });
  }

  // Geolocalizacao
  const btnLocate = $('btn-locate-user');
  if (btnLocate) {
    btnLocate.addEventListener('click', async () => {
      if (!state.mapController) return;
      try {
        await state.mapController.locateUser();
        showToast('Mapa centralizado na sua localizacao.', 'success');
      } catch (err) {
        showToast(err && err.message ? err.message : 'Nao foi possivel localizar.', 'danger');
      }
    });
  }

  // Ir para coordenadas
  const btnGoto = $('btn-goto-coords');
  const coordsPopover = $('coords-popover');
  const btnGotoCancel = $('btn-goto-cancel');
  const btnGotoSubmit = $('btn-goto-submit');
  if (btnGoto && coordsPopover) {
    btnGoto.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const willOpen = coordsPopover.hidden;
      closePopovers();
      coordsPopover.hidden = !willOpen;
      btnGoto.setAttribute('aria-expanded', String(willOpen));
      if (willOpen && $('input-goto-lat')) {
        $('input-goto-lat').focus();
      }
    });
    coordsPopover.addEventListener('click', (ev) => ev.stopPropagation());
  }
  if (btnGotoCancel) {
    btnGotoCancel.addEventListener('click', () => closePopovers());
  }
  if (btnGotoSubmit) {
    btnGotoSubmit.addEventListener('click', () => {
      if (!state.mapController) return;
      const lat = $('input-goto-lat') ? $('input-goto-lat').value : '';
      const lon = $('input-goto-lon') ? $('input-goto-lon').value : '';
      try {
        state.mapController.goToCoordinates(lat, lon, 16);
        closePopovers();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  // Fechar popovers ao clicar fora
  document.addEventListener('click', () => closePopovers());

  // Minhas Missoes
  const btnMissions = $('btn-my-missions');
  if (btnMissions) {
    btnMissions.addEventListener('click', () => {
      openModal('modal-missions');
      loadMissionsList();
    });
  }

  const searchMissions = $('input-search-missions');
  if (searchMissions) {
    searchMissions.addEventListener('input', () => {
      renderMissionsList(searchMissions.value);
    });
  }

  const btnMissionsRetry = $('btn-missions-retry');
  if (btnMissionsRetry) {
    btnMissionsRetry.addEventListener('click', () => loadMissionsList());
  }

  const missionsList = $('missions-list');
  if (missionsList) {
    missionsList.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-mission-action]');
      if (!btn) return;
      const action = btn.dataset.missionAction;
      const missionId = btn.dataset.missionId;
      const mission = state.missionsCache.find((m) => m.id === missionId);

      if (action === 'open' && mission) {
        loadMissionIntoWorkspace(mission);
      } else if (action === 'duplicate' && missionId) {
        try {
          await duplicateMission(state.supabaseClient, state.session.user.id, missionId);
          showToast('Missao duplicada.', 'success');
          await loadMissionsList();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Falha ao duplicar missao.', 'danger');
        }
      } else if (action === 'delete' && missionId) {
        const confirmed = window.confirm(
          `Excluir a missao "${mission ? mission.name : ''}"? Esta acao nao pode ser desfeita.`
        );
        if (!confirmed) return;
        try {
          await deleteMission(state.supabaseClient, state.session.user.id, missionId);
          if (state.missionId === missionId) {
            state.missionId = null;
          }
          showToast('Missao excluida.', 'success');
          await loadMissionsList();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Falha ao excluir missao.', 'danger');
        }
      }
    });
  }

  // Elevacao retry e fallback
  const btnElevRetry = $('btn-elevation-retry');
  if (btnElevRetry) {
    btnElevRetry.addEventListener('click', () => runElevationUpdate());
  }
  const btnElevFixed = $('btn-elevation-fallback-fixed');
  if (btnElevFixed) {
    btnElevFixed.addEventListener('click', () => {
      state.params.altitudeMode = 'fixed';
      state.elevationStatus = 'idle';
      syncAltitudeModeUI();
      renderElevationStatusUI();
      recomputeMission({ fetchElevation: false });
      showToast('Modo alterado para Altitude Fixa.');
    });
  }

  // Perfil altimetrico toggle
  const btnToggleProfile = $('btn-toggle-profile');
  const btnCloseProfile = $('btn-close-profile');
  const profilePanel = $('profile-panel');
  const toggleProfile = (forceOpen) => {
    if (!profilePanel) return;
    const willOpen = forceOpen !== undefined ? forceOpen : profilePanel.hidden;
    profilePanel.hidden = !willOpen;
    if (btnToggleProfile) {
      btnToggleProfile.setAttribute('aria-expanded', String(willOpen));
    }
    if (willOpen) {
      renderProfileChartUI();
    } else if (state.mapController) {
      state.mapController.setHoverMarker(null);
    }
    if (state.mapController) {
      window.setTimeout(() => state.mapController.invalidateSize(), 60);
    }
  };
  if (btnToggleProfile) {
    btnToggleProfile.addEventListener('click', () => toggleProfile());
  }
  if (btnCloseProfile) {
    btnCloseProfile.addEventListener('click', () => toggleProfile(false));
  }

  // Sidebar collapse (desktop) e bottom sheet (mobile)
  const panel = $('control-panel');
  const btnCollapse = $('btn-collapse-sidebar');
  const btnExpand = $('btn-expand-sidebar');
  const sheetHandle = $('sheet-drag-handle');

  if (btnCollapse && panel && btnExpand) {
    btnCollapse.addEventListener('click', () => {
      panel.classList.add('is-collapsed');
      btnExpand.hidden = false;
      if (state.mapController) window.setTimeout(() => state.mapController.invalidateSize(), 60);
    });
    btnExpand.addEventListener('click', () => {
      panel.classList.remove('is-collapsed');
      btnExpand.hidden = true;
      if (state.mapController) window.setTimeout(() => state.mapController.invalidateSize(), 60);
    });
  }

  if (sheetHandle && panel) {
    sheetHandle.addEventListener('click', () => {
      const expanded = panel.classList.toggle('is-expanded');
      sheetHandle.setAttribute('aria-expanded', String(expanded));
      if (state.mapController) window.setTimeout(() => state.mapController.invalidateSize(), 120);
    });
  }

  // Nome da missao, Salvar e Guia DJI Fly
  const nameInput = $('input-mission-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      state.missionName = nameInput.value;
    });
  }

  const btnSave = $('btn-save-mission');
  if (btnSave) {
    btnSave.addEventListener('click', () => handleSaveMission());
  }

  const btnGuide = $('btn-dji-guide');
  if (btnGuide) {
    btnGuide.addEventListener('click', () => openModal('modal-dji-guide'));
  }

  // Aeronave e perfil customizado
  const selectDrone = $('select-drone');
  if (selectDrone) {
    selectDrone.addEventListener('change', () => {
      state.droneKey = selectDrone.value;
      renderDroneSpecSummary(getActiveDrone());
      recomputeMission({ fetchElevation: true });
    });
  }

  const btnCustomDrone = $('btn-custom-drone');
  if (btnCustomDrone) {
    btnCustomDrone.addEventListener('click', () => {
      renderCustomDronesList();
      resetCustomDroneForm();
      openModal('modal-custom-drone');
    });
  }

  const formCustomDrone = $('form-custom-drone');
  if (formCustomDrone) {
    formCustomDrone.addEventListener('submit', handleSaveCustomDrone);
  }

  const btnResetCustomDrone = $('btn-custom-drone-reset');
  if (btnResetCustomDrone) {
    btnResetCustomDrone.addEventListener('click', () => resetCustomDroneForm());
  }

  const customDronesList = $('custom-drones-list');
  if (customDronesList) {
    customDronesList.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-drone-action]');
      if (!btn) return;
      const action = btn.dataset.droneAction;
      const droneId = btn.dataset.droneId;
      const profile = state.customDrones.find((d) => d.id === droneId);

      if (action === 'edit' && profile) {
        populateCustomDroneForm(profile);
      } else if (action === 'delete' && droneId) {
        const confirmed = window.confirm(
          `Excluir o perfil "${profile ? profile.name : ''}"?`
        );
        if (!confirmed) return;
        try {
          await deleteCustomDrone(state.supabaseClient, state.session.user.id, droneId);
          state.customDrones = state.customDrones.filter((d) => d.id !== droneId);
          if (state.droneKey === `custom:${droneId}`) {
            state.droneKey = 'dji-mini-4-pro';
          }
          renderDroneSelector();
          renderCustomDronesList();
          recomputeMission({ fetchElevation: true });
          showToast('Perfil customizado excluido.', 'success');
        } catch (err) {
          showToast(err && err.message ? err.message : 'Falha ao excluir perfil.', 'danger');
        }
      }
    });
  }

  // Tipo de missao
  const missionTypeGroup = $('mission-type-group');
  if (missionTypeGroup) {
    missionTypeGroup.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-mission-type]');
      if (!btn) return;
      const nextType = btn.dataset.missionType;
      if (nextType === state.missionType) return;

      const prevWasCorridor = state.missionType === 'corridor';
      const nextIsCorridor = nextType === 'corridor';
      state.missionType = nextType;
      syncMissionTypeUI();

      if (state.mapController && prevWasCorridor !== nextIsCorridor) {
        state.mapController.setGeometryType(nextIsCorridor ? 'line' : 'polygon', {
          clearIfChanged: true
        });
        state.mapController.setMode(nextIsCorridor ? 'draw-line' : 'draw-polygon');
      } else {
        recomputeMission({ fetchElevation: true });
      }
    });
  }

  // Sliders e inputs numericos
  bindSliderAndNumber('range-corridor-width', 'input-corridor-width', 'corridorWidthM', { min: 20, max: 1000, fetchElevation: true });
  bindSliderAndNumber('range-altitude', 'input-altitude', 'altitudeM', { min: 30, max: 200, fetchElevation: true });
  bindSliderAndNumber('range-front-overlap', 'input-front-overlap', 'frontOverlapPct', { min: 40, max: 95, fetchElevation: false });
  bindSliderAndNumber('range-side-overlap', 'input-side-overlap', 'sideOverlapPct', { min: 40, max: 95, fetchElevation: true });
  bindSliderAndNumber('range-max-speed', 'input-max-speed', 'maxSpeedMs', { min: 1, max: 15, fetchElevation: false });
  bindSliderAndNumber('range-rotation', 'input-rotation', 'rotationDeg', { min: 0, max: 359, fetchElevation: true });
  bindSliderAndNumber('range-overshoot', 'input-overshoot', 'overshootM', { min: 0, max: 100, fetchElevation: true });
  bindSliderAndNumber('range-gimbal', 'input-gimbal', 'gimbalPitchDeg', { min: -90, max: -45, fetchElevation: false });

  // Intervalo de disparo
  const intervalGroup = $('interval-mode-group');
  if (intervalGroup) {
    intervalGroup.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-interval]');
      if (!btn) return;
      const raw = btn.dataset.interval;
      state.params.intervalMode = raw === 'auto' ? 'auto' : Number(raw);
      recomputeMission({ fetchElevation: false });
    });
  }

  // Otimizar angulo
  const btnOptimize = $('btn-optimize-angle');
  if (btnOptimize) {
    btnOptimize.addEventListener('click', () => {
      if (!state.areaGeoJson || state.missionType === 'corridor') {
        showToast('Desenhe ou importe um poligono para otimizar o angulo.');
        return;
      }
      try {
        const optimal = Math.round(computeOptimalAngle(state.areaGeoJson)) % 360;
        state.params.rotationDeg = optimal;
        if ($('input-rotation')) $('input-rotation').value = String(optimal);
        if ($('range-rotation')) $('range-rotation').value = String(optimal);
        recomputeMission({ fetchElevation: true });
        showToast(`Angulo otimizado para ${optimal} graus.`, 'success');
      } catch (err) {
        showToast(err.message || 'Nao foi possivel otimizar o angulo.', 'danger');
      }
    });
  }

  // Toggles de geometria
  const revToggle = $('toggle-reverse-direction');
  if (revToggle) {
    revToggle.addEventListener('change', () => {
      state.params.reverseDirection = revToggle.checked;
      recomputeMission({ fetchElevation: true });
    });
  }

  const strToggle = $('toggle-straighten-path');
  if (strToggle) {
    strToggle.addEventListener('change', () => {
      state.params.straightenFlightPath = strToggle.checked;
      recomputeMission({ fetchElevation: true });
    });
  }

  // Modo de altitude (Terrain Follow vs Altitude Fixa)
  const altModeGroup = $('altitude-mode-group');
  if (altModeGroup) {
    altModeGroup.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-altitude-mode]');
      if (!btn) return;
      state.params.altitudeMode = btn.dataset.altitudeMode;
      syncAltitudeModeUI();
      recomputeMission({ fetchElevation: true });
    });
  }

  // Acao final, modo de disparo, max waypoints, reserva
  const finishSelect = $('select-finish-action');
  if (finishSelect) {
    finishSelect.addEventListener('change', () => {
      state.params.finishAction = finishSelect.value;
    });
  }

  const triggerGroup = $('trigger-mode-group');
  if (triggerGroup) {
    triggerGroup.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-trigger-mode]');
      if (!btn) return;
      state.params.triggerMode = btn.dataset.triggerMode;
      syncTriggerModeUI();
    });
  }

  const maxWpInput = $('input-max-waypoints');
  if (maxWpInput) {
    maxWpInput.addEventListener('change', () => {
      const val = Math.max(10, Math.min(500, Math.round(Number(maxWpInput.value) || 99)));
      state.params.maxWaypointsPerPart = val;
      maxWpInput.value = String(val);
      recomputeSplitAndRenderMap();
    });
  }

  const reserveInput = $('input-battery-reserve');
  if (reserveInput) {
    reserveInput.addEventListener('change', () => {
      const val = Math.max(5, Math.min(50, Number(reserveInput.value) || 20));
      state.params.batteryReservePct = val;
      reserveInput.value = String(val);
      recomputeSplitAndRenderMap();
    });
  }

  // Modal Exportar
  const btnOpenExport = $('btn-open-export');
  if (btnOpenExport) {
    btnOpenExport.addEventListener('click', () => {
      populateExportModal();
      openModal('modal-export');
    });
  }

  const btnExportAll = $('btn-export-download-all');
  if (btnExportAll) {
    btnExportAll.addEventListener('click', () => handleExportAll());
  }

  const exportPartsList = $('export-parts-list');
  if (exportPartsList) {
    exportPartsList.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-export-part-index]');
      if (!btn) return;
      handleExportSinglePart(Number(btn.dataset.exportPartIndex));
    });
  }

  const btnExportGuide = $('btn-export-guide-link');
  if (btnExportGuide) {
    btnExportGuide.addEventListener('click', () => {
      closeModal('modal-export');
      openModal('modal-dji-guide');
    });
  }

  // Abas do Guia DJI Fly
  const guideTabs = $('guide-tabs');
  if (guideTabs) {
    guideTabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-guide-tab]');
      if (!btn) return;
      const tab = btn.dataset.guideTab;
      guideTabs.querySelectorAll('[data-guide-tab]').forEach((item) => {
        const active = item.dataset.guideTab === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });
      ['android', 'rc', 'rc2'].forEach((key) => {
        const panelEl = $(`guide-panel-${key}`);
        if (panelEl) panelEl.hidden = key !== tab;
      });
    });
  }

  // Fechamento de modais por [data-close-modal], backdrop e Escape
  document.addEventListener('click', (ev) => {
    const closeBtn = ev.target.closest('[data-close-modal]');
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }
    if (ev.target.classList && ev.target.classList.contains('modal-backdrop')) {
      ev.target.hidden = true;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closePopovers();
      closeAllModals();
    }
  });
}

async function initApp(session) {
  if (state.initialized) return;

  if (!globalThis.L) {
    showFatalError(
      'Biblioteca Leaflet indisponivel',
      'Nao foi possivel carregar o mapa via CDN. Verifique sua conexao e tente novamente.'
    );
    return;
  }

  if (typeof globalThis.getSupabaseClient !== 'function') {
    showFatalError(
      'Cliente Supabase indisponivel',
      'Nao foi possivel inicializar o cliente de autenticacao.'
    );
    return;
  }

  try {
    state.supabaseClient = globalThis.getSupabaseClient();
  } catch (err) {
    showFatalError('Erro de configuracao', err.message || 'Falha ao inicializar Supabase.');
    return;
  }

  state.initialized = true;
  state.session = session;

  // Escuta mudanca de estado de autenticacao para reagir imediatamente a SIGNED_OUT
  state.supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      clearRuntimeState();
      safeRedirectToPortal();
    }
  });

  bindStaticListenersOnce();

  // Inicializa controlador Leaflet
  state.mapController = createMapController('map', {
    maptilerKey: (globalThis.CONFIG && globalThis.CONFIG.MAPTILER_KEY) || '',
    onGeometryChange: (geojson) => {
      state.areaGeoJson = geojson;
      recomputeMission({ fetchElevation: true });
    },
    onTakeoffChange: (point) => {
      state.takeoffPoint = point;
      state.takeoffIsSuggested = false;
      syncTakeoffInfoUI();
      recomputeMission({ fetchElevation: true });
    },
    onModeChange: (mode) => {
      updateToolbarActiveState(mode);
    }
  });

  const maptilerBtn = $('btn-layer-maptiler');
  if (maptilerBtn && globalThis.CONFIG && globalThis.CONFIG.MAPTILER_KEY) {
    maptilerBtn.hidden = false;
  }

  updateToolbarActiveState('draw-polygon');

  // Carrega perfis customizados do usuario sem bloquear uso livre caso falhe
  try {
    if (session && session.user && session.user.id) {
      state.customDrones = await listCustomDrones(state.supabaseClient, session.user.id);
    }
  } catch (_err) {
    state.customDrones = [];
  }

  renderDroneSelector();
  syncAllInputsFromState();
  recomputeMission({ fetchElevation: false });

  window.setTimeout(() => {
    if (state.mapController) state.mapController.invalidateSize();
  }, 150);
}

// Registra botoes da tela de fallback imediatamente
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindFallbackListenersOnce, { once: true });
} else {
  bindFallbackListenersOnce();
}

// Aguarda evento oficial do App Bridge
window.addEventListener('workbench-ready', (event) => {
  const session = event && event.detail ? event.detail.session : null;
  if (!session || !session.user) {
    safeRedirectToPortal();
    return;
  }
  initApp(session);
});
