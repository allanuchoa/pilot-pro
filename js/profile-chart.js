/**
 * Grafico SVG responsivo do perfil altimetrico (terreno MSL vs trajetoria do drone vs alerta AGL 20m).
 * Sem dependencias externas e com limpeza garantida de event listeners.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const cleanupRegistry = new WeakMap();

/**
 * Formata distancia para eixo X e tooltip.
 * @param {number} meters
 * @returns {string}
 */
function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '0 m';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Cria um elemento SVG com atributos.
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @returns {SVGElement}
 */
function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, String(val));
  }
  return el;
}

/**
 * Encontra o ponto mais proximo da distancia alvo usando busca binaria.
 * @param {Array<{ distanceM: number }>} points
 * @param {number} targetDistance
 * @returns {number}
 */
function findNearestPointIndex(points, targetDistance) {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distanceM < targetDistance) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0) {
    const prevDist = Math.abs(points[lo - 1].distanceM - targetDistance);
    const currDist = Math.abs(points[lo].distanceM - targetDistance);
    if (prevDist < currDist) {
      return lo - 1;
    }
  }
  return lo;
}

/**
 * Renderiza o grafico de perfil altimetrico em SVG responsivo dentro de containerEl.
 *
 * @param {HTMLElement} containerEl
 * @param {Array<{
 *   distanceM: number,
 *   groundElevationM: number,
 *   droneAltitudeMsl: number,
 *   executeHeightM: number,
 *   clearanceM: number,
 *   lat?: number,
 *   lon?: number,
 *   index?: number
 * }>} profilePoints
 * @param {{
 *   minClearanceWarningM?: number,
 *   onHoverPoint?: (point: object | null) => void,
 *   height?: number
 * }} [options]
 * @returns {{ destroy: () => void }}
 */
export function renderElevationProfile(containerEl, profilePoints, options = {}) {
  if (!containerEl) {
    return { destroy: () => {} };
  }

  const prevCleanup = cleanupRegistry.get(containerEl);
  if (typeof prevCleanup === 'function') {
    prevCleanup();
    cleanupRegistry.delete(containerEl);
  }

  containerEl.innerHTML = '';

  const minClearanceWarningM = Number.isFinite(options.minClearanceWarningM)
    ? options.minClearanceWarningM
    : 20;
  const onHoverPoint = typeof options.onHoverPoint === 'function' ? options.onHoverPoint : null;

  if (!Array.isArray(profilePoints) || profilePoints.length < 2) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'profile-chart-empty';
    emptyEl.textContent = 'Desenhe uma missao valida para visualizar o perfil altimetrico.';
    containerEl.appendChild(emptyEl);
    return { destroy: () => {} };
  }

  const width = Math.max(360, containerEl.clientWidth || 720);
  const height = Number.isFinite(options.height) ? options.height : 180;
  const pad = { top: 14, right: 16, bottom: 26, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxDist = Math.max(1, profilePoints[profilePoints.length - 1].distanceM || 1);

  let minAlt = Infinity;
  let maxAlt = -Infinity;
  for (const pt of profilePoints) {
    const g = pt.groundElevationM;
    const d = pt.droneAltitudeMsl;
    const warn = g + minClearanceWarningM;
    if (g < minAlt) minAlt = g;
    if (d < minAlt) minAlt = d;
    if (g > maxAlt) maxAlt = g;
    if (d > maxAlt) maxAlt = d;
    if (warn > maxAlt) maxAlt = warn;
  }

  const rawSpan = Math.max(20, maxAlt - minAlt);
  const yMin = Math.floor((minAlt - rawSpan * 0.12) / 5) * 5;
  const yMax = Math.ceil((maxAlt + rawSpan * 0.12) / 5) * 5;
  const ySpan = Math.max(1, yMax - yMin);

  const scaleX = (dist) => pad.left + (dist / maxDist) * plotW;
  const scaleY = (alt) => pad.top + plotH - ((alt - yMin) / ySpan) * plotH;

  const wrapper = document.createElement('div');
  wrapper.className = 'profile-chart-wrapper';

  const svg = createSvgEl('svg', {
    class: 'profile-chart-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Grafico de perfil altimetrico da missao',
  });

  const defs = createSvgEl('defs');
  const gradId = `ppr-terrain-grad-${Math.random().toString(36).slice(2, 8)}`;
  const grad = createSvgEl('linearGradient', {
    id: gradId,
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
  });
  grad.appendChild(createSvgEl('stop', { offset: '0%', 'stop-color': '#52525b', 'stop-opacity': '0.55' }));
  grad.appendChild(createSvgEl('stop', { offset: '100%', 'stop-color': '#18181b', 'stop-opacity': '0.18' }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Fundo escuro do grafico
  svg.appendChild(
    createSvgEl('rect', {
      x: 0,
      y: 0,
      width,
      height,
      fill: '#101010',
    })
  );

  // Grade horizontal e eixo Y (altitude MSL)
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i += 1) {
    const ratio = i / yTicks;
    const altVal = yMin + ratio * ySpan;
    const yPos = scaleY(altVal);

    svg.appendChild(
      createSvgEl('line', {
        x1: pad.left,
        y1: yPos.toFixed(1),
        x2: width - pad.right,
        y2: yPos.toFixed(1),
        stroke: '#272524',
        'stroke-width': 1,
      })
    );

    const label = createSvgEl('text', {
      x: pad.left - 8,
      y: (yPos + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#a1a1aa',
      'font-size': 10,
      'font-family': 'var(--font-mono)',
    });
    label.textContent = `${Math.round(altVal)}m`;
    svg.appendChild(label);
  }

  // Grade vertical e eixo X (distancia acumulada)
  const xTicks = 4;
  for (let i = 0; i <= xTicks; i += 1) {
    const ratio = i / xTicks;
    const distVal = ratio * maxDist;
    const xPos = scaleX(distVal);

    svg.appendChild(
      createSvgEl('line', {
        x1: xPos.toFixed(1),
        y1: pad.top,
        x2: xPos.toFixed(1),
        y2: pad.top + plotH,
        stroke: '#201e1d',
        'stroke-width': 1,
      })
    );

    const label = createSvgEl('text', {
      x: xPos.toFixed(1),
      y: height - 7,
      'text-anchor': i === 0 ? 'start' : i === xTicks ? 'end' : 'middle',
      fill: '#a1a1aa',
      'font-size': 10,
      'font-family': 'var(--font-mono)',
    });
    label.textContent = formatDistance(distVal);
    svg.appendChild(label);
  }

  // Caminhos SVG: terreno, linha de alerta 20m AGL e trajetoria do drone
  const terrainCoords = [];
  const warningCoords = [];
  const droneCoords = [];
  const dangerPoints = [];

  for (const pt of profilePoints) {
    const x = scaleX(pt.distanceM).toFixed(1);
    const yGround = scaleY(pt.groundElevationM).toFixed(1);
    const yWarn = scaleY(pt.groundElevationM + minClearanceWarningM).toFixed(1);
    const yDrone = scaleY(pt.droneAltitudeMsl).toFixed(1);

    terrainCoords.push(`${x},${yGround}`);
    warningCoords.push(`${x},${yWarn}`);
    droneCoords.push(`${x},${yDrone}`);

    if (pt.clearanceM < minClearanceWarningM) {
      dangerPoints.push({ x, y: yDrone });
    }
  }

  const baseY = (pad.top + plotH).toFixed(1);
  const firstX = scaleX(profilePoints[0].distanceM).toFixed(1);
  const lastX = scaleX(profilePoints[profilePoints.length - 1].distanceM).toFixed(1);

  // Poligono preenchido do terreno
  svg.appendChild(
    createSvgEl('polygon', {
      points: `${firstX},${baseY} ${terrainCoords.join(' ')} ${lastX},${baseY}`,
      fill: `url(#${gradId})`,
    })
  );

  // Contorno do terreno
  svg.appendChild(
    createSvgEl('polyline', {
      points: terrainCoords.join(' '),
      fill: 'none',
      stroke: '#71717a',
      'stroke-width': 1.5,
    })
  );

  // Linha tracejada de alerta AGL 20m
  svg.appendChild(
    createSvgEl('polyline', {
      points: warningCoords.join(' '),
      fill: 'none',
      stroke: '#f59e0b',
      'stroke-width': 1,
      'stroke-dasharray': '4 3',
      opacity: '0.8',
    })
  );

  // Curva de voo do drone (#00d992)
  svg.appendChild(
    createSvgEl('polyline', {
      points: droneCoords.join(' '),
      fill: 'none',
      stroke: '#00d992',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
    })
  );

  // Pontos com risco de colisao (clearance < 20m)
  for (const dp of dangerPoints) {
    svg.appendChild(
      createSvgEl('circle', {
        cx: dp.x,
        cy: dp.y,
        r: 3,
        fill: '#f87171',
      })
    );
  }

  // Elementos de hover (crosshair e marcadores)
  const crosshairLine = createSvgEl('line', {
    x1: pad.left,
    y1: pad.top,
    x2: pad.left,
    y2: pad.top + plotH,
    stroke: '#f4f4f5',
    'stroke-width': 1,
    'stroke-dasharray': '2 2',
    visibility: 'hidden',
  });
  const droneDot = createSvgEl('circle', {
    cx: pad.left,
    cy: pad.top,
    r: 4,
    fill: '#00d992',
    stroke: '#101010',
    'stroke-width': 1.5,
    visibility: 'hidden',
  });
  const terrainDot = createSvgEl('circle', {
    cx: pad.left,
    cy: pad.top,
    r: 3,
    fill: '#a1a1aa',
    stroke: '#101010',
    'stroke-width': 1.2,
    visibility: 'hidden',
  });

  svg.appendChild(crosshairLine);
  svg.appendChild(terrainDot);
  svg.appendChild(droneDot);

  // Area interativa de captura de ponteiro
  const overlay = createSvgEl('rect', {
    x: pad.left,
    y: pad.top,
    width: plotW,
    height: plotH,
    fill: 'transparent',
    cursor: 'crosshair',
  });
  svg.appendChild(overlay);

  const tooltip = document.createElement('div');
  tooltip.className = 'profile-chart-tooltip';
  tooltip.hidden = true;

  wrapper.appendChild(svg);
  wrapper.appendChild(tooltip);
  containerEl.appendChild(wrapper);

  let lastHoveredIndex = -1;

  function updateHoverFromClientX(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;

    const svgX = ((clientX - rect.left) / rect.width) * width;
    const clampedPlotX = Math.max(pad.left, Math.min(pad.left + plotW, svgX));
    const ratio = (clampedPlotX - pad.left) / plotW;
    const targetDist = ratio * maxDist;
    const idx = findNearestPointIndex(profilePoints, targetDist);
    const pt = profilePoints[idx];

    const px = scaleX(pt.distanceM);
    const pyDrone = scaleY(pt.droneAltitudeMsl);
    const pyGround = scaleY(pt.groundElevationM);

    crosshairLine.setAttribute('x1', px.toFixed(1));
    crosshairLine.setAttribute('x2', px.toFixed(1));
    crosshairLine.setAttribute('visibility', 'visible');

    droneDot.setAttribute('cx', px.toFixed(1));
    droneDot.setAttribute('cy', pyDrone.toFixed(1));
    droneDot.setAttribute(
      'fill',
      pt.clearanceM < minClearanceWarningM ? '#f87171' : '#00d992'
    );
    droneDot.setAttribute('visibility', 'visible');

    terrainDot.setAttribute('cx', px.toFixed(1));
    terrainDot.setAttribute('cy', pyGround.toFixed(1));
    terrainDot.setAttribute('visibility', 'visible');

    const clearanceClass = pt.clearanceM < minClearanceWarningM ? 'is-danger' : 'is-safe';
    tooltip.innerHTML = [
      `<div class="tooltip-row"><span>Dist.</span><strong>${formatDistance(pt.distanceM)}</strong></div>`,
      `<div class="tooltip-row"><span>Terreno</span><strong>${pt.groundElevationM.toFixed(1)} m</strong></div>`,
      `<div class="tooltip-row"><span>Alt. Rel.</span><strong>${pt.executeHeightM.toFixed(1)} m</strong></div>`,
      `<div class="tooltip-row ${clearanceClass}"><span>Folga AGL</span><strong>${pt.clearanceM.toFixed(1)} m</strong></div>`,
    ].join('');
    tooltip.hidden = false;

    const tipLeftPct = (px / width) * 100;
    tooltip.style.left = tipLeftPct > 68 ? `${Math.max(2, tipLeftPct - 28)}%` : `${Math.min(72, tipLeftPct + 2)}%`;

    if (idx !== lastHoveredIndex) {
      lastHoveredIndex = idx;
      if (onHoverPoint) {
        onHoverPoint(pt);
      }
    }
  }

  function clearHover() {
    crosshairLine.setAttribute('visibility', 'hidden');
    droneDot.setAttribute('visibility', 'hidden');
    terrainDot.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
    if (lastHoveredIndex !== -1) {
      lastHoveredIndex = -1;
      if (onHoverPoint) {
        onHoverPoint(null);
      }
    }
  }

  const handlePointerMove = (evt) => {
    updateHoverFromClientX(evt.clientX);
  };

  const handleTouchMove = (evt) => {
    if (evt.touches && evt.touches.length > 0) {
      updateHoverFromClientX(evt.touches[0].clientX);
    }
  };

  overlay.addEventListener('pointermove', handlePointerMove);
  overlay.addEventListener('pointerleave', clearHover);
  overlay.addEventListener('touchstart', handleTouchMove, { passive: true });
  overlay.addEventListener('touchmove', handleTouchMove, { passive: true });
  overlay.addEventListener('touchend', clearHover);

  const destroy = () => {
    overlay.removeEventListener('pointermove', handlePointerMove);
    overlay.removeEventListener('pointerleave', clearHover);
    overlay.removeEventListener('touchstart', handleTouchMove);
    overlay.removeEventListener('touchmove', handleTouchMove);
    overlay.removeEventListener('touchend', clearHover);
    if (lastHoveredIndex !== -1 && onHoverPoint) {
      onHoverPoint(null);
    }
  };

  cleanupRegistry.set(containerEl, destroy);
  return { destroy };
}
