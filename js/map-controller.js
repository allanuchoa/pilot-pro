/**
 * Controlador de mapa interativo (Leaflet) do Pilot Pro.
 * Gerencia camadas base, desenho/edicao de poligono e polilinha,
 * ponto de decolagem arrastavel, renderizacao multi-bateria e marcador de hover.
 */

const ROUTE_COLORS = ['#00d992', '#38bdf8', '#f59e0b', '#a78bfa'];

const DEFAULT_CENTER = [-15.793889, -47.882778];
const DEFAULT_ZOOM = 5;

function createBaseLayers(maptilerKey) {
  const L = globalThis.L;
  const layers = {
    esri: {
      key: 'esri',
      label: 'Satelite (Esri)',
      layer: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri',
          maxZoom: 19,
          maxNativeZoom: 18
        }
      )
    },
    'carto-dark': {
      key: 'carto-dark',
      label: 'Escuro (Carto Dark)',
      layer: L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 20
        }
      )
    },
    osm: {
      key: 'osm',
      label: 'Mapa (OpenStreetMap)',
      layer: L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }
      )
    }
  };

  if (typeof maptilerKey === 'string' && maptilerKey.trim().length > 0) {
    layers.maptiler = {
      key: 'maptiler',
      label: 'Satelite (MapTiler)',
      layer: L.tileLayer(
        `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(maptilerKey.trim())}`,
        {
          attribution: '&copy; MapTiler &copy; OpenStreetMap',
          maxZoom: 20
        }
      )
    };
  }

  return layers;
}

function createVertexIcon(index) {
  const L = globalThis.L;
  return L.divIcon({
    className: 'ppr-vertex-icon',
    html: `<span class="ppr-vertex-dot" title="Vertice ${index + 1} (arraste para mover, clique direito para remover)" style="display:block;width:14px;height:14px;border-radius:50%;background:#ffffff;border:2px solid #101010;box-sizing:border-box;cursor:grab;"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function createMidpointIcon() {
  const L = globalThis.L;
  return L.divIcon({
    className: 'ppr-midpoint-icon',
    html: '<span class="ppr-midpoint-dot" title="Clique para inserir vertice intermediario" style="display:block;width:10px;height:10px;border-radius:50%;background:rgba(0,217,146,0.75);border:1.5px solid #101010;box-sizing:border-box;cursor:pointer;"></span>',
    iconSize: [10, 10],
    iconAnchor: [5, 5]
  });
}

function createTakeoffIcon(isSuggested) {
  const L = globalThis.L;
  const cls = isSuggested ? 'ppr-takeoff-pin is-suggested' : 'ppr-takeoff-pin';
  const bg = isSuggested ? '#f59e0b' : '#00d992';
  const border = isSuggested ? '#fde68a' : '#101010';
  return L.divIcon({
    className: 'ppr-takeoff-icon',
    html: `<div class="${cls}" title="Ponto de decolagem (arraste para ajustar)" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${bg};color:#101010;border:2px solid ${border};font-weight:700;font-size:13px;font-family:Inter,sans-serif;box-sizing:border-box;cursor:grab;">H</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function extractVerticesFromGeoJson(geojson, fallbackType = 'polygon') {
  if (!geojson || typeof geojson !== 'object') {
    return { geometryType: fallbackType, vertices: [] };
  }

  let geometry = geojson;
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features) && geojson.features.length > 0) {
    geometry = geojson.features[0].geometry;
  } else if (geojson.type === 'Feature') {
    geometry = geojson.geometry;
  }

  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return { geometryType: fallbackType, vertices: [] };
  }

  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0] || [];
    const coords = ring.slice();
    if (coords.length > 1) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        coords.pop();
      }
    }
    return {
      geometryType: 'polygon',
      vertices: coords.map((c) => ({ lat: Number(c[1]), lon: Number(c[0]) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    };
  }

  if (geometry.type === 'MultiPolygon') {
    const ring = (geometry.coordinates[0] && geometry.coordinates[0][0]) || [];
    const coords = ring.slice();
    if (coords.length > 1) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        coords.pop();
      }
    }
    return {
      geometryType: 'polygon',
      vertices: coords.map((c) => ({ lat: Number(c[1]), lon: Number(c[0]) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    };
  }

  if (geometry.type === 'LineString') {
    return {
      geometryType: 'line',
      vertices: geometry.coordinates
        .map((c) => ({ lat: Number(c[1]), lon: Number(c[0]) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    };
  }

  return { geometryType: fallbackType, vertices: [] };
}

export class MapController {
  constructor(container, options = {}) {
    if (!globalThis.L) {
      throw new Error('Biblioteca Leaflet (L) nao carregada.');
    }

    const L = globalThis.L;
    this.container = typeof container === 'string'
      ? document.getElementById(container)
      : container;

    if (!this.container) {
      throw new Error('Container do mapa nao encontrado.');
    }

    this.callbacks = {
      onGeometryChange: options.onGeometryChange || (() => {}),
      onTakeoffChange: options.onTakeoffChange || (() => {}),
      onModeChange: options.onModeChange || (() => {}),
      onBaseLayerChange: options.onBaseLayerChange || (() => {}),
      onMapClick: options.onMapClick || (() => {})
    };

    const maptilerKey = options.maptilerKey !== undefined
      ? options.maptilerKey
      : (globalThis.CONFIG && globalThis.CONFIG.MAPTILER_KEY) || '';

    this.map = L.map(this.container, {
      center: options.center || DEFAULT_CENTER,
      zoom: options.zoom || DEFAULT_ZOOM,
      zoomControl: false,
      preferCanvas: true
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    this.baseLayers = createBaseLayers(maptilerKey);
    this.activeBaseLayerKey = 'esri';
    this.baseLayers.esri.layer.addTo(this.map);

    this.geometryLayer = L.layerGroup().addTo(this.map);
    this.handlesLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.takeoffLayer = L.layerGroup().addTo(this.map);
    this.overlayLayer = L.layerGroup().addTo(this.map);

    this.mode = 'draw-polygon';
    this.geometryType = 'polygon';
    this.vertices = [];
    this.takeoffPoint = null;
    this.takeoffIsSuggested = false;
    this.takeoffMarker = null;
    this.hoverMarker = null;
    this.userLocationMarker = null;

    this._handleMapClick = this._onMapClick.bind(this);
    this.map.on('click', this._handleMapClick);

    this._updateCursor();
  }

  getAvailableBaseLayers() {
    return Object.values(this.baseLayers).map((entry) => ({
      key: entry.key,
      label: entry.label
    }));
  }

  setBaseLayer(layerKey) {
    if (!this.baseLayers[layerKey] || layerKey === this.activeBaseLayerKey) {
      return this.activeBaseLayerKey;
    }

    const current = this.baseLayers[this.activeBaseLayerKey];
    if (current && this.map.hasLayer(current.layer)) {
      this.map.removeLayer(current.layer);
    }

    this.baseLayers[layerKey].layer.addTo(this.map);
    this.activeBaseLayerKey = layerKey;
    this.callbacks.onBaseLayerChange(layerKey);
    return layerKey;
  }

  setMode(mode) {
    const allowed = ['select', 'draw-polygon', 'draw-line', 'takeoff'];
    if (!allowed.includes(mode)) {
      return;
    }

    if (mode === 'draw-polygon' && this.geometryType !== 'polygon') {
      this.geometryType = 'polygon';
      this._renderEditableGeometry();
    } else if (mode === 'draw-line' && this.geometryType !== 'line') {
      this.geometryType = 'line';
      this._renderEditableGeometry();
    }

    this.mode = mode;
    this._updateCursor();
    this.callbacks.onModeChange(mode);
  }

  setGeometryType(geometryType, { clearIfChanged = false } = {}) {
    if (geometryType !== 'polygon' && geometryType !== 'line') {
      return;
    }
    const changed = this.geometryType !== geometryType;
    this.geometryType = geometryType;
    if (changed && clearIfChanged) {
      this.vertices = [];
      this._emitGeometryChange();
    }
    this._renderEditableGeometry();
  }

  _updateCursor() {
    if (!this.container) return;
    if (this.mode === 'draw-polygon' || this.mode === 'draw-line' || this.mode === 'takeoff') {
      this.container.style.cursor = 'crosshair';
    } else {
      this.container.style.cursor = '';
    }
  }

  _onMapClick(event) {
    const { lat, lng } = event.latlng;
    this.callbacks.onMapClick({ lat, lon: lng, mode: this.mode });

    if (this.mode === 'takeoff') {
      this.setTakeoffPoint({ lat, lon: lng }, { isSuggested: false, emit: true });
      return;
    }

    if (this.mode === 'draw-polygon' || this.mode === 'draw-line') {
      this.geometryType = this.mode === 'draw-line' ? 'line' : 'polygon';
      this.vertices.push({ lat, lon: lng });
      this._renderEditableGeometry();
      this._emitGeometryChange();
    }
  }

  getGeometry() {
    if (this.geometryType === 'polygon') {
      if (this.vertices.length < 3) return null;
      const ring = this.vertices.map((v) => [v.lon, v.lat]);
      ring.push([this.vertices[0].lon, this.vertices[0].lat]);
      return {
        type: 'Feature',
        properties: { geometryType: 'polygon' },
        geometry: {
          type: 'Polygon',
          coordinates: [ring]
        }
      };
    }

    if (this.vertices.length < 2) return null;
    return {
      type: 'Feature',
      properties: { geometryType: 'line' },
      geometry: {
        type: 'LineString',
        coordinates: this.vertices.map((v) => [v.lon, v.lat])
      }
    };
  }

  getVertexCount() {
    return this.vertices.length;
  }

  setGeometry(geojson, { fit = false, emit = false } = {}) {
    const extracted = extractVerticesFromGeoJson(geojson, this.geometryType);
    this.geometryType = extracted.geometryType;
    this.vertices = extracted.vertices;
    this._renderEditableGeometry();
    if (fit && this.vertices.length > 0) {
      this.fitToGeometry(this.getGeometry());
    }
    if (emit) {
      this._emitGeometryChange();
    }
  }

  removeVertex(index) {
    if (index < 0 || index >= this.vertices.length) return;
    this.vertices.splice(index, 1);
    this._renderEditableGeometry();
    this._emitGeometryChange();
  }

  removeLastVertex() {
    if (this.vertices.length === 0) return;
    this.vertices.pop();
    this._renderEditableGeometry();
    this._emitGeometryChange();
  }

  clearGeometry() {
    this.vertices = [];
    this._renderEditableGeometry();
    this.clearMissionParts();
    this.setHoverMarker(null);
    this._emitGeometryChange();
  }

  _emitGeometryChange() {
    this.callbacks.onGeometryChange(this.getGeometry(), this.geometryType, this.vertices.length);
  }

  _renderEditableGeometry() {
    const L = globalThis.L;
    this.geometryLayer.clearLayers();
    this.handlesLayer.clearLayers();

    if (this.vertices.length === 0) {
      return;
    }

    const latLngs = this.vertices.map((v) => [v.lat, v.lon]);

    if (this.geometryType === 'polygon' && latLngs.length >= 3) {
      L.polygon(latLngs, {
        color: '#ffffff',
        weight: 2,
        opacity: 0.9,
        fillColor: '#00d992',
        fillOpacity: 0.12
      }).addTo(this.geometryLayer);
    } else if (latLngs.length >= 2) {
      L.polyline(latLngs, {
        color: '#ffffff',
        weight: 2.5,
        opacity: 0.9,
        dashArray: this.geometryType === 'polygon' ? '6 6' : null
      }).addTo(this.geometryLayer);
    }

    // Marcadores de vertices arrastaveis
    this.vertices.forEach((vertex, idx) => {
      const marker = L.marker([vertex.lat, vertex.lon], {
        icon: createVertexIcon(idx),
        draggable: true,
        zIndexOffset: 500
      });

      marker.on('drag', (ev) => {
        const pos = ev.target.getLatLng();
        this.vertices[idx] = { lat: pos.lat, lon: pos.lng };
        this._renderShapeOnly();
      });

      marker.on('dragend', (ev) => {
        const pos = ev.target.getLatLng();
        this.vertices[idx] = { lat: pos.lat, lon: pos.lng };
        this._renderEditableGeometry();
        this._emitGeometryChange();
      });

      marker.on('contextmenu', (ev) => {
        L.DomEvent.stopPropagation(ev);
        L.DomEvent.preventDefault(ev);
        this.removeVertex(idx);
      });

      marker.addTo(this.handlesLayer);
    });

    // Marcadores intermediarios para inserir novos vertices
    const segmentCount = this.geometryType === 'polygon'
      ? (this.vertices.length >= 3 ? this.vertices.length : this.vertices.length - 1)
      : this.vertices.length - 1;

    for (let i = 0; i < segmentCount; i += 1) {
      const a = this.vertices[i];
      const b = this.vertices[(i + 1) % this.vertices.length];
      if (!a || !b) continue;
      const midLat = (a.lat + b.lat) / 2;
      const midLon = (a.lon + b.lon) / 2;

      const midMarker = L.marker([midLat, midLon], {
        icon: createMidpointIcon(),
        zIndexOffset: 400
      });

      midMarker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        this.vertices.splice(i + 1, 0, { lat: midLat, lon: midLon });
        this._renderEditableGeometry();
        this._emitGeometryChange();
      });

      midMarker.addTo(this.handlesLayer);
    }
  }

  _renderShapeOnly() {
    const L = globalThis.L;
    this.geometryLayer.clearLayers();
    const latLngs = this.vertices.map((v) => [v.lat, v.lon]);
    if (this.geometryType === 'polygon' && latLngs.length >= 3) {
      L.polygon(latLngs, {
        color: '#ffffff',
        weight: 2,
        opacity: 0.9,
        fillColor: '#00d992',
        fillOpacity: 0.12
      }).addTo(this.geometryLayer);
    } else if (latLngs.length >= 2) {
      L.polyline(latLngs, {
        color: '#ffffff',
        weight: 2.5,
        opacity: 0.9
      }).addTo(this.geometryLayer);
    }
  }

  setTakeoffPoint(point, { isSuggested = false, emit = false } = {}) {
    const L = globalThis.L;
    if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) {
      this.clearTakeoffPoint();
      return;
    }

    const lat = Number(point.lat);
    const lon = Number(point.lon);
    this.takeoffPoint = { lat, lon, isManual: !isSuggested };
    this.takeoffIsSuggested = Boolean(isSuggested);

    this.takeoffLayer.clearLayers();
    this.takeoffMarker = L.marker([lat, lon], {
      icon: createTakeoffIcon(this.takeoffIsSuggested),
      draggable: true,
      zIndexOffset: 800
    });

    this.takeoffMarker.on('dragend', (ev) => {
      const pos = ev.target.getLatLng();
      this.takeoffPoint = { lat: pos.lat, lon: pos.lng, isManual: true };
      this.takeoffIsSuggested = false;
      this.takeoffMarker.setIcon(createTakeoffIcon(false));
      this.callbacks.onTakeoffChange(this.takeoffPoint);
    });

    this.takeoffMarker.bindTooltip(
      this.takeoffIsSuggested
        ? 'Decolagem sugerida (arraste para confirmar)'
        : 'Ponto de decolagem (Home)',
      { direction: 'top', offset: [0, -14] }
    );

    this.takeoffMarker.addTo(this.takeoffLayer);

    if (emit) {
      this.callbacks.onTakeoffChange(this.takeoffPoint);
    }
  }

  clearTakeoffPoint() {
    this.takeoffPoint = null;
    this.takeoffIsSuggested = false;
    this.takeoffMarker = null;
    this.takeoffLayer.clearLayers();
  }

  renderMissionParts(parts = [], options = {}) {
    const L = globalThis.L;
    this.routeLayer.clearLayers();

    if (!Array.isArray(parts) || parts.length === 0) {
      return;
    }

    const takeoff = options.takeoffPoint || this.takeoffPoint;

    parts.forEach((part, idx) => {
      const waypoints = Array.isArray(part.waypoints) ? part.waypoints : [];
      if (waypoints.length < 2) return;

      const color = part.color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
      const latLngs = waypoints.map((wp) => [wp.lat, wp.lon]);

      // Linha de transito decolagem -> inicio e fim -> decolagem
      if (takeoff && Number.isFinite(takeoff.lat) && Number.isFinite(takeoff.lon)) {
        L.polyline(
          [[takeoff.lat, takeoff.lon], latLngs[0]],
          {
            color,
            weight: 1.5,
            opacity: 0.5,
            dashArray: '4 6'
          }
        ).addTo(this.routeLayer);

        L.polyline(
          [latLngs[latLngs.length - 1], [takeoff.lat, takeoff.lon]],
          {
            color,
            weight: 1.5,
            opacity: 0.4,
            dashArray: '4 6'
          }
        ).addTo(this.routeLayer);
      }

      const routeLine = L.polyline(latLngs, {
        color,
        weight: 2.5,
        opacity: 0.95
      });

      const partNum = part.partIndex || (idx + 1);
      const durationText = Number.isFinite(part.durationMin) ? `${part.durationMin.toFixed(1)} min` : '';
      routeLine.bindTooltip(
        `Parte ${partNum}: ${waypoints.length} waypoints${durationText ? ` (${durationText})` : ''}`,
        { sticky: true }
      );
      routeLine.addTo(this.routeLayer);

      // Marcador de inicio da parte
      L.circleMarker(latLngs[0], {
        radius: 5,
        color: '#101010',
        weight: 2,
        fillColor: color,
        fillOpacity: 1
      })
        .bindTooltip(`Inicio Parte ${partNum}`, { direction: 'top' })
        .addTo(this.routeLayer);

      // Marcador de fim da parte
      L.circleMarker(latLngs[latLngs.length - 1], {
        radius: 4,
        color: color,
        weight: 2,
        fillColor: '#101010',
        fillOpacity: 1
      })
        .bindTooltip(`Fim Parte ${partNum}`, { direction: 'top' })
        .addTo(this.routeLayer);
    });
  }

  clearMissionParts() {
    this.routeLayer.clearLayers();
  }

  setHoverMarker(point) {
    const L = globalThis.L;
    if (this.hoverMarker) {
      this.overlayLayer.removeLayer(this.hoverMarker);
      this.hoverMarker = null;
    }

    if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) {
      return;
    }

    this.hoverMarker = L.circleMarker([Number(point.lat), Number(point.lon)], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#00d992',
      fillOpacity: 1
    }).addTo(this.overlayLayer);
  }

  fitToGeometry(geojson) {
    const L = globalThis.L;
    if (geojson) {
      try {
        const layer = L.geoJSON(geojson);
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });
          return true;
        }
      } catch (_err) {
        return false;
      }
    }

    if (this.vertices.length > 0) {
      const bounds = L.latLngBounds(this.vertices.map((v) => [v.lat, v.lon]));
      if (bounds.isValid()) {
        this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });
        return true;
      }
    }

    return false;
  }

  locateUser() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalizacao nao suportada neste navegador.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          this.goToCoordinates(lat, lon, 16);

          const L = globalThis.L;
          if (this.userLocationMarker) {
            this.overlayLayer.removeLayer(this.userLocationMarker);
          }
          this.userLocationMarker = L.circleMarker([lat, lon], {
            radius: 6,
            color: '#ffffff',
            weight: 2,
            fillColor: '#38bdf8',
            fillOpacity: 0.9
          })
            .bindTooltip('Sua localizacao atual', { direction: 'top' })
            .addTo(this.overlayLayer);

          resolve({ lat, lon });
        },
        (err) => {
          reject(new Error(err.message || 'Nao foi possivel obter sua localizacao.'));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }

  goToCoordinates(lat, lon, zoom = 16) {
    const numLat = Number(lat);
    const numLon = Number(lon);
    if (
      !Number.isFinite(numLat) ||
      !Number.isFinite(numLon) ||
      numLat < -90 ||
      numLat > 90 ||
      numLon < -180 ||
      numLon > 180
    ) {
      throw new Error('Coordenadas invalidas. Informe latitude (-90 a 90) e longitude (-180 a 180).');
    }
    this.map.setView([numLat, numLon], zoom, { animate: true });
    return { lat: numLat, lon: numLon };
  }

  invalidateSize() {
    if (this.map) {
      this.map.invalidateSize({ pan: false });
    }
  }

  destroy() {
    if (this.map) {
      this.map.off('click', this._handleMapClick);
      this.map.remove();
      this.map = null;
    }
  }
}

export function createMapController(container, options = {}) {
  return new MapController(container, options);
}
