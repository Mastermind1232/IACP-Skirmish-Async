/**
 * Renders IA Skirmish maps with coordinate grid overlay (a1, b2, etc.)
 * Uses Vassal grid params from map-registry.json
 */

import { createCanvas, loadImage, registerFont } from 'canvas';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseCoord } from './game/coords.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Register DejaVu Sans for reliable text rendering (sans-serif often fails on headless/servers)
const FONT_FAMILY = 'DejaVu Sans';
try {
  const ttfDir = resolve(rootDir, 'node_modules', 'dejavu-fonts-ttf', 'ttf');
  const sansPath = resolve(ttfDir, 'DejaVuSans.ttf');
  const boldPath = resolve(ttfDir, 'DejaVuSans-Bold.ttf');
  if (existsSync(sansPath)) {
    registerFont(sansPath, { family: FONT_FAMILY, weight: 'normal' });
  }
  if (existsSync(boldPath)) {
    registerFont(boldPath, { family: FONT_FAMILY, weight: 'bold' });
  }
} catch (err) {
  console.warn('Map renderer: could not register DejaVu fonts, falling back to sans-serif:', err.message);
}

/** Try subfolder first (e.g. tokens/ maps/), then root. pathOrFilename can be "vassal_extracted/images/X" or "X.gif". */
function resolveImagePath(pathOrFilename, subfolder) {
  const filename = pathOrFilename.split(/[/\\]/).pop() || pathOrFilename;
  const base = join(rootDir, 'vassal_extracted', 'images');
  const inSub = join(base, subfolder, filename);
  if (existsSync(inSub)) return join('vassal_extracted', 'images', subfolder, filename).replace(/\\/g, '/');
  const inRoot = join(base, filename);
  if (existsSync(inRoot)) return join('vassal_extracted', 'images', filename).replace(/\\/g, '/');
  return pathOrFilename;
}

let registryCache = null;
let tokenImagesConfig = null;
let mapSpacesCache = null;

/** Returns a lowercase Set of on-map coordinates for grid label filtering. */
function getOnMapCoordSet(mapId) {
  if (!mapSpacesCache) {
    try {
      mapSpacesCache = JSON.parse(readFileSync(join(rootDir, 'data', 'map-spaces.json'), 'utf8'));
    } catch {
      mapSpacesCache = { maps: {} };
    }
  }
  const raw = mapSpacesCache?.maps?.[mapId];
  const spaces = raw?.spaces || [];
  return new Set(spaces.map((s) => String(s).toLowerCase()));
}

function getTokenImagesConfig() {
  try {
    tokenImagesConfig = JSON.parse(readFileSync(join(rootDir, 'data', 'token-images.json'), 'utf8'));
  } catch {
    tokenImagesConfig = tokenImagesConfig || {};
  }
  return tokenImagesConfig;
}

function getRegistry() {
  if (!registryCache) {
    const path = join(rootDir, 'data', 'map-registry.json');
    registryCache = JSON.parse(readFileSync(path, 'utf8'));
  }
  return registryCache;
}

/** Clear in-memory caches so next render uses fresh data (e.g. after git pull). Call from Refresh All. */
export function clearMapRendererCache() {
  registryCache = null;
  tokenImagesConfig = null;
  mapSpacesCache = null;
}

function getMap(mapId) {
  const { maps } = getRegistry();
  return maps.find((m) => m.id === mapId) || maps.find((m) => m.name.toLowerCase().includes(mapId.toLowerCase()));
}

/** Column index → letter (0→A, 1→B, ..., 25→Z, 26→AA) */
function colToLetter(col) {
  if (col < 26) return String.fromCharCode(65 + col);
  return colToLetter(Math.floor(col / 26) - 1) + colToLetter(col % 26);
}

/**
 * Renders a map with coordinate grid overlay.
 * @param {string} mapId - Map ID from registry (e.g. 'training-ground')
 * @param {Object} options
 * @param {Array<{id: string, coord: string, label?: string, color?: string}>} [options.figures] - Figure positions
 * @param {boolean} [options.showGrid=true] - Draw coordinate labels
 * @param {number} [options.maxWidth] - Scale down if wider (for Discord 8MB limit)
 * @returns {Promise<Buffer>} PNG buffer
 */

export async function renderMap(mapId, options = {}) {
  const { figures = [], tokens = {}, showGrid = true, maxWidth = 1200, cropToZone = null, gridStyle = 'default', showGridOnlyOnCoords = null } = options;
  const mapDef = getMap(mapId);
  if (!mapDef) throw new Error(`Map not found: ${mapId}`);

  const mapPath = resolveImagePath(mapDef.imagePath, 'maps');
  const imagePath = join(rootDir, mapPath);
  const { dx, dy, x0, y0 } = mapDef.grid;

  let img;
  if (existsSync(imagePath)) {
    img = await loadImage(imagePath);
  } else {
    // Placeholder: gray canvas with "Map image not found"
    const w = 800;
    const h = 600;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#444';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = `24px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.fillText(`${mapDef.name}`, w / 2, h / 2 - 20);
    ctx.fillText('(Map image not found – add to vassal_extracted/images/)', w / 2, h / 2 + 20);
    return canvas.toBuffer('image/png');
  }

  const origW = img.width;
  const origH = img.height;
  const scale = maxWidth && origW > maxWidth ? maxWidth / origW : 1;
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const s = scale;
  const sx0 = x0 * s;
  const sdx = dx * s;
  const sdy = dy * s;
  const sy0 = y0 * s;

  const numCols = Math.floor((w - sx0) / sdx);
  const numRows = Math.floor((h - sy0) / sdy);

  if (showGrid) {
    const useBlackGrid = gridStyle === 'black';
    const onMapCoords = getOnMapCoordSet(mapId);
    const coordFilter = showGridOnlyOnCoords
      ? new Set((Array.isArray(showGridOnlyOnCoords) ? showGridOnlyOnCoords : []).map((c) => String(c).toLowerCase()))
      : null;
    ctx.fillStyle = useBlackGrid ? '#8B35C8' : 'rgba(107,33,168,0.85)';
    ctx.strokeStyle = useBlackGrid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = useBlackGrid ? 2.5 : 2;
    ctx.font = `bold ${Math.max(8, Math.round(10 * scale))}px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        const label = colToLetter(col) + (row + 1);
        const coordKey = label.toLowerCase();
        if (!onMapCoords.has(coordKey)) continue;
        if (coordFilter && !coordFilter.has(coordKey)) continue;
        const cx = sx0 + col * sdx + sdx / 2;
        const cy = sy0 + row * sdy + sdy / 2;
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
      }
    }
  }

  // Draw named area labels (room names like "Command Center")
  for (const area of tokens.namedAreas || []) {
    if (!area.name || !area.cells?.length) continue;
    const parsed = area.cells.map(parseCoord).filter(p => p.col >= 0 && p.row >= 0);
    if (parsed.length === 0) continue;
    // Compute centroid of all area cell centers
    let acx = 0;
    let acy = 0;
    for (const p of parsed) {
      acx += sx0 + p.col * sdx + sdx / 2;
      acy += sy0 + p.row * sdy + sdy / 2;
    }
    acx /= parsed.length;
    acy /= parsed.length;
    const areaFontSize = Math.round(Math.min(sdx, sdy) * 0.42);
    const areaLabel = area.name.length > 20 ? area.name.slice(0, 19) + '\u2026' : area.name;
    ctx.font = `bold ${areaFontSize}px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const areaMetrics = ctx.measureText(areaLabel);
    const aPadH = Math.max(5, Math.round(areaFontSize * 0.3));
    const aPadV = Math.max(3, Math.round(areaFontSize * 0.2));
    const aBoxW = areaMetrics.width + aPadH * 2;
    const aBoxH = areaFontSize + aPadV * 2;
    const aBoxX = acx - aBoxW / 2;
    const aBoxY = acy - aBoxH / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(aBoxX, aBoxY, aBoxW, aBoxH);
    ctx.lineWidth = Math.max(2, Math.round(areaFontSize * 0.1));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(areaLabel, acx, acy);
    ctx.fillStyle = '#CE93D8'; // Light purple
    ctx.fillText(areaLabel, acx, acy);
  }

  // Draw map tokens using game box images from vassal_extracted/images/tokens
  const tokenSize = Math.min(sdx, sdy) * 0.9;
  const tc = getTokenImagesConfig();
  const imagesDir = join(rootDir, 'vassal_extracted', 'images');

  const CRATE_LABEL_SIZE_SCALE = 0.95; // crates + label ~5% smaller

  const drawTokenAt = async (coord, imageFilename, fallbackStyle, fallbackShape = 'square', label = null, sizeScale = 1) => {
    const { col, row } = parseCoord(coord);
    if (col < 0 || row < 0 || col >= numCols || row >= numRows) return;
    const cx = sx0 + col * sdx + sdx / 2;
    const cy = sy0 + row * sdy + sdy / 2;
    const size = tokenSize * sizeScale;
    const resolved = imageFilename ? resolveImagePath(join('vassal_extracted', 'images', imageFilename), 'tokens') : null;
    const imgPath = resolved ? join(rootDir, resolved) : null;
    if (imgPath && existsSync(imgPath)) {
      try {
        const tokenImg = await loadImage(imgPath);
        const tw = tokenImg.width;
        const th = tokenImg.height;
        const tScale = Math.min(size / tw, size / th);
        const dw = Math.round(tw * tScale);
        const dh = Math.round(th * tScale);
        ctx.drawImage(tokenImg, cx - dw / 2, cy - dh / 2, dw, dh);
      } catch (err) {
        console.error('Token image load failed:', imageFilename, err);
        ctx.fillStyle = fallbackStyle;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        if (fallbackShape === 'circle') {
          ctx.beginPath();
          ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
          ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
        }
      }
    } else {
      ctx.fillStyle = fallbackStyle;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      if (fallbackShape === 'circle') {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
        ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      }
    }
    if (label) {
      const fontSize = Math.max(9, Math.round(11 * scale * sizeScale));
      ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const paddingH = Math.max(4, Math.round(6 * scale * sizeScale));
      const paddingV = Math.max(2, Math.round(3 * scale * sizeScale));
      const metrics = ctx.measureText(label);
      const boxW = metrics.width + paddingH * 2;
      const boxH = fontSize + paddingV * 2;
      const labelY = cy + size / 2 - boxH / 2;
      const boxX = cx - boxW / 2;
      const boxY = labelY - boxH / 2;
      ctx.fillStyle = '#000000';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = '#FFEB3B';
      ctx.fillText(label, cx, labelY);
    }
  };

  // Pre-load all token images in parallel, then draw sequentially (canvas ctx is not thread-safe).
  const tokenDrawQueue = [];
  for (const coord of tokens.terminals || []) {
    tokenDrawQueue.push({ coord, image: tc.terminals, fallback: 'rgba(79,195,247,0.8)', shape: 'square' });
  }
  for (const token of tokens.missionA || []) {
    const coord = typeof token === 'string' ? token : token.coord;
    const label = typeof token === 'string' ? 'Token' : (token.label || 'Token');
    const image = (typeof token === 'object' && token.image) || tc.missionA;
    tokenDrawQueue.push({ coord, image, fallback: 'rgba(120,120,120,0.9)', shape: 'circle', label, sizeScale: CRATE_LABEL_SIZE_SCALE });
  }
  for (const token of tokens.missionB || []) {
    const coord = typeof token === 'string' ? token : token.coord;
    const label = typeof token === 'string' ? 'Token' : (token.label || 'Token');
    const image = (typeof token === 'object' && token.image) || tc.missionB;
    tokenDrawQueue.push({ coord, image, fallback: 'rgba(255,183,77,0.8)', shape: 'square', label, sizeScale: CRATE_LABEL_SIZE_SCALE });
  }
  const anc = tc.ancillary || {};
  for (const coord of tokens.smoke || []) {
    tokenDrawQueue.push({ coord, image: anc.smoke, fallback: 'rgba(150,150,150,0.7)', shape: 'circle' });
  }
  for (const coord of tokens.rubble || []) {
    tokenDrawQueue.push({ coord, image: anc.rubble, fallback: 'rgba(100,80,60,0.9)', shape: 'square' });
  }
  for (const coord of tokens.energyShield || []) {
    tokenDrawQueue.push({ coord, image: anc.energyShield, fallback: 'rgba(100,200,255,0.7)', shape: 'circle' });
  }
  for (const coord of tokens.device || []) {
    tokenDrawQueue.push({ coord, image: anc.device, fallback: 'rgba(80,120,180,0.9)', shape: 'square' });
  }
  for (const coord of tokens.napalm || []) {
    tokenDrawQueue.push({ coord, image: anc.napalm, fallback: 'rgba(200,80,40,0.9)', shape: 'circle' });
  }
  // Load all images in parallel
  const preloadedTokenImages = await Promise.all(tokenDrawQueue.map(async (t) => {
    const resolved = t.image ? resolveImagePath(join('vassal_extracted', 'images', t.image), 'tokens') : null;
    const imgPath = resolved ? join(rootDir, resolved) : null;
    let img = null;
    if (imgPath && existsSync(imgPath)) {
      try { img = await loadImage(imgPath); } catch { /* use fallback */ }
    }
    return { ...t, loadedImg: img };
  }));
  // Draw sequentially with pre-loaded images
  for (const t of preloadedTokenImages) {
    const { col, row } = parseCoord(t.coord);
    if (col < 0 || row < 0 || col >= numCols || row >= numRows) continue;
    const cx = sx0 + col * sdx + sdx / 2;
    const cy = sy0 + row * sdy + sdy / 2;
    const size = tokenSize * (t.sizeScale || 1);
    if (t.loadedImg) {
      const tw = t.loadedImg.width;
      const th = t.loadedImg.height;
      const tScale = Math.min(size / tw, size / th);
      const dw = Math.round(tw * tScale);
      const dh = Math.round(th * tScale);
      ctx.drawImage(t.loadedImg, cx - dw / 2, cy - dh / 2, dw, dh);
    } else {
      ctx.fillStyle = t.fallback;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      if (t.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
        ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      }
    }
    if (t.label) {
      const fontSize = Math.max(9, Math.round(11 * scale * (t.sizeScale || 1)));
      ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const paddingH = Math.max(4, Math.round(6 * scale * (t.sizeScale || 1)));
      const paddingV = Math.max(2, Math.round(3 * scale * (t.sizeScale || 1)));
      const metrics = ctx.measureText(t.label);
      const boxW = metrics.width + paddingH * 2;
      const boxH = fontSize + paddingV * 2;
      const labelY = cy + size / 2 - boxH / 2;
      const boxX = cx - boxW / 2;
      const boxY = labelY - boxH / 2;
      ctx.fillStyle = '#000000';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = '#FFEB3B';
      ctx.fillText(t.label, cx, labelY);
    }
  }

  // Strain markers: draw strain token image + orange count badge on signal markers
  const strainMarkers = tokens.strainMarkers || [];
  if (strainMarkers.length > 0) {
    const strainImagePath = join(rootDir, 'vassal_extracted', 'images', 'tokens', 'Counter--Strain.gif');
    let strainImg = null;
    if (existsSync(strainImagePath)) {
      try { strainImg = await loadImage(strainImagePath); } catch { /* fallback */ }
    }
    const strainSize = tokenSize * 0.5;
    for (const sm of strainMarkers) {
      const { col, row } = parseCoord(sm.coord);
      if (col < 0 || row < 0 || col >= numCols || row >= numRows) continue;
      // Position in bottom-right quadrant of the cell
      const cx = sx0 + col * sdx + sdx * 0.72;
      const cy = sy0 + row * sdy + sdy * 0.72;
      if (strainImg) {
        const tw = strainImg.width;
        const th = strainImg.height;
        const tScale = Math.min(strainSize / tw, strainSize / th);
        const dw = Math.round(tw * tScale);
        const dh = Math.round(th * tScale);
        ctx.drawImage(strainImg, cx - dw / 2, cy - dh / 2, dw, dh);
      } else {
        ctx.fillStyle = 'rgba(100,149,237,0.8)';
        ctx.beginPath();
        ctx.arc(cx, cy, strainSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Orange count badge with black background
      const badgeFontSize = Math.max(9, Math.round(12 * scale));
      const countLabel = String(sm.count);
      ctx.font = `bold ${badgeFontSize}px "${FONT_FAMILY}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bm = ctx.measureText(countLabel);
      const badgeR = Math.max(badgeFontSize * 0.65, (bm.width + 6) / 2);
      const bx = cx + strainSize * 0.35;
      const by = cy - strainSize * 0.35;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(bx, by, badgeR + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FF8C00';
      ctx.fillText(countLabel, bx, by);
    }
  }

  const doorEdges = tokens.doors || [];
  const grouped = new Map();
  for (const edge of doorEdges) {
    if (!edge || edge.length < 2) continue;
    const a = parseCoord(edge[0]);
    const b = parseCoord(edge[1]);
    if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) continue;
    const horizontalBoundary = a.col === b.col;
    const boundaryRow = Math.min(a.row, b.row);
    const boundaryCol = Math.min(a.col, b.col);
    const key = horizontalBoundary ? `h_${boundaryRow}` : `v_${boundaryCol}`;
    const col = horizontalBoundary ? a.col : a.row;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ edge, col, horizontalBoundary });
  }

  const drawDoorSpan = async (items) => {
    if (!items?.length) return;
    const { horizontalBoundary } = items[0];
    // Derive column/row range from actual edge coords (grouping used row as "col" for vertical doors)
    const allCols = new Set();
    const allRows = new Set();
    for (const item of items) {
      const p0 = parseCoord(item.edge[0]);
      const p1 = parseCoord(item.edge[1]);
      allCols.add(p0.col).add(p1.col);
      allRows.add(p0.row).add(p1.row);
    }
    const minCol = Math.min(...allCols);
    const maxCol = Math.max(...allCols);
    const minRow = Math.min(...allRows);
    const maxRow = Math.max(...allRows);
    const boundaryRow = minRow;
    const boundaryCol = minCol;
    const leftX = sx0 + minCol * sdx;
    const rightX = sx0 + (maxCol + 1) * sdx;
    const topY = sy0 + minRow * sdy;
    const bottomY = sy0 + (maxRow + 1) * sdy;
    // Place door on the grid line (boundary): horizontal = line between the two rows; vertical = between the two columns
    const midX = horizontalBoundary ? (leftX + rightX) / 2 : leftX + sdx;
    const midY = horizontalBoundary ? topY + sdy : (topY + bottomY) / 2;
    const spanWidth = (maxCol - minCol + 1) * sdx;
    const spanHeight = (maxRow - minRow + 1) * sdy;
    const doorW = horizontalBoundary ? spanWidth : spanHeight;
    const doorH = horizontalBoundary ? spanHeight : spanWidth;
    const dw = Math.round(doorW);
    const dh = Math.round(doorH);
    const imageFilename = tc.doors || 'Token--Door.png';
    const resolved = resolveImagePath(join('vassal_extracted', 'images', imageFilename), 'tokens');
    const imgPath = join(rootDir, resolved);
    ctx.save();
    ctx.translate(midX, midY);
    if (!horizontalBoundary) ctx.rotate(Math.PI / 2);
    const hw = dw / 2;
    const hh = dh / 2;
    // White backfill: only ~15% into adjacent cells (not full cell height)
    const backfillH = Math.max(4, Math.round(dh * 0.15));
    const hhBf = backfillH / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(-hw, -hhBf, dw, backfillH);
    if (existsSync(imgPath)) {
      try {
        const tokenImg = await loadImage(imgPath);
        const tw = tokenImg.width;
        const th = tokenImg.height;
        // Scale to cover so door graphic fills the white block (image may have internal padding)
        const tScale = Math.max(dw / tw, backfillH / th);
        const iw = Math.round(tw * tScale);
        const ih = Math.round(th * tScale);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-hw, -hhBf, dw, backfillH);
        ctx.clip();
        ctx.drawImage(tokenImg, -iw / 2, -ih / 2, iw, ih);
        ctx.restore();
      } catch (err) {
        console.error('Door image load failed:', imageFilename, err);
        ctx.fillStyle = 'rgba(101,67,33,0.95)';
        ctx.fillRect(-hw * 0.8, -hhBf, hw * 1.6, backfillH);
      }
    } else {
      ctx.fillStyle = 'rgba(101,67,33,0.95)';
      ctx.fillRect(-hw * 0.8, -hhBf, hw * 1.6, backfillH);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-hw, -hhBf, dw, backfillH);
    ctx.restore();
  };

  for (const [, items] of grouped) {
    const sorted = [...items].sort((a, b) => a.col - b.col);
    let span = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].col <= sorted[i - 1].col + 1) {
        span.push(sorted[i]);
      } else {
        await drawDoorSpan(span);
        span = [sorted[i]];
      }
    }
    await drawDoorSpan(span);
  }

  // Figure markers: drawn AFTER tokens/doors so figures render on top
  // Circular clip to hide white background; size-scaled to fill footprint
  // Coord is top-left for large units; center the figure on its footprint
  const baseTokenSize = Math.min(Math.max(52, 64 * scale), sdx * 0.95, sdy * 0.95);
  // Helper: draw a rounded rectangle path centered at (cx, cy) with half-dimensions hw, hh
  function roundedRectPath(cx, cy, hw, hh, r) {
    const x = cx - hw, y = cy - hh, w = hw * 2, h = hh * 2;
    const cr = Math.min(r, hw, hh);
    ctx.beginPath();
    ctx.moveTo(x + cr, y);
    ctx.lineTo(x + w - cr, y);
    ctx.arcTo(x + w, y, x + w, y + cr, cr);
    ctx.lineTo(x + w, y + h - cr);
    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr);
    ctx.lineTo(x + cr, y + h);
    ctx.arcTo(x, y + h, x, y + h - cr, cr);
    ctx.lineTo(x, y + cr);
    ctx.arcTo(x, y, x + cr, y, cr);
    ctx.closePath();
  }
  for (const fig of figures) {
    const coord = fig.coord?.toLowerCase?.() || fig.coord;
    if (!coord) continue;
    const letter = coord.match(/[a-z]+/)?.[0] || '';
    const num = parseInt(coord.match(/\d+/)?.[0] || '0', 10);
    const col = letter
      ? [...letter.toUpperCase()].reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 64), 0) - 1
      : -1;
    const row = num - 1;
    if (row < 0 || col < 0) continue;
    const size = (fig.figureSize || '1x1').toLowerCase();
    const [cols = 1, rows = 1] = size.split('x').map(Number);
    const centerCol = col + cols / 2;
    const centerRow = row + rows / 2;
    const cx = sx0 + centerCol * sdx;
    const cy = sy0 + centerRow * sdy;
    // For square footprints use a circle; for rectangular use a rounded rect matching footprint
    const isSquare = cols === rows;
    const fillFactor = 0.9;
    const clipW = isSquare ? baseTokenSize * (cols === 1 ? 0.92 : cols * 1.05) / 2 : cols * sdx * fillFactor / 2;
    const clipH = isSquare ? baseTokenSize * (rows === 1 ? 0.92 : rows * 1.05) / 2 : rows * sdy * fillFactor / 2;
    const clipRadius = isSquare ? clipW : Math.min(clipW, clipH);
    const cornerRadius = Math.max(8, Math.round(12 * scale));
    let drewImage = false;
    if (fig.imagePath) {
      const figPath = join(rootDir, fig.imagePath);
      if (existsSync(figPath)) {
        try {
          const figImg = await loadImage(figPath);
          const tw = figImg.width;
          const th = figImg.height;
          const tScale = Math.min((clipW * 2) / tw, (clipH * 2) / th);
          const dw = Math.round(tw * tScale);
          const dh = Math.round(th * tScale);
          const isLarge = cols > 1 || rows > 1;
          const outlineGap = isLarge ? Math.max(2, Math.round(3 * scale)) : -6;
          const outlineWidth = isLarge ? Math.max(2, Math.round(3 * scale)) : 10;
          // Draw colored outline outside the figure
          ctx.strokeStyle = fig.color || '#fff';
          ctx.lineWidth = outlineWidth;
          if (isSquare) {
            ctx.beginPath();
            ctx.arc(cx, cy, clipRadius + outlineGap + outlineWidth / 2, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            roundedRectPath(cx, cy, clipW + outlineGap + outlineWidth / 2, clipH + outlineGap + outlineWidth / 2, cornerRadius + outlineGap);
            ctx.stroke();
          }
          // Clip and draw figure image inside
          ctx.save();
          if (isSquare) {
            ctx.beginPath();
            ctx.arc(cx, cy, clipRadius, 0, Math.PI * 2);
            ctx.closePath();
          } else {
            roundedRectPath(cx, cy, clipW, clipH, cornerRadius);
          }
          ctx.clip();
          // Rotate image 90° when orientation is swapped vs base size (e.g. 3x2 vs base 2x3)
          // OR when image aspect ratio mismatches clip area (e.g. landscape image in portrait 1x2 clip)
          const baseSize = (fig.baseSize || size).toLowerCase();
          const [baseCols = 1, baseRows = 1] = baseSize.split('x').map(Number);
          const orientationSwapped = baseCols !== baseRows && cols === baseRows && rows === baseCols;
          const imageIsLandscape = tw > th;
          const aspectMismatch = !isSquare && (imageIsLandscape !== (clipW > clipH));
          if (orientationSwapped || aspectMismatch) {
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 2);
            // Re-scale image to fit the rotated clip area (swap width/height for scaling)
            const rScale = Math.min((clipH * 2) / tw, (clipW * 2) / th);
            const rw = Math.round(tw * rScale);
            const rh = Math.round(th * rScale);
            ctx.drawImage(figImg, -rw / 2, -rh / 2, rw, rh);
          } else {
            ctx.drawImage(figImg, cx - dw / 2, cy - dh / 2, dw, dh);
          }
          ctx.restore();
          drewImage = true;
        } catch (err) {
          console.error('Map figure image load failed:', fig.imagePath, err);
        }
      }
    }
    if (fig.label) {
      const fontSize = Math.max(10, Math.round(12 * scale));
      ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelY = cy + clipH * 0.6;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(fig.label, cx, labelY);
      ctx.fillStyle = fig.color || '#fff';
      ctx.fillText(fig.label, cx, labelY);
    }
    if (!drewImage) {
      console.error(`Map figure image missing for DC "${fig.dcName || '?'}" at ${fig.coord} - run: node scripts/extract-figure-images.js`);
      ctx.fillStyle = fig.color || '#f00';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, 8 * scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = fig.color || '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Power Tokens: up to 3 slots at top-left of unit
    const powerTokenTypes = (fig.powerTokens || []).slice(0, 3);
    const ptSize = Math.max(11, clipRadius * (powerTokenTypes.length > 2 ? 0.3 : 0.36));
    const ptConfig = getTokenImagesConfig().powerTokens || {};
    const figX0 = cx - clipW;
    const figY0 = cy - clipH;
    // Pre-load power token images in parallel
    const ptLoadPromises = [];
    for (let i = 0; i < powerTokenTypes.length; i++) {
      const ptType = powerTokenTypes[i];
      if (ptType) {
        const filename = ptConfig[ptType] || ptConfig.Surge;
        if (filename) {
          const resolved = resolveImagePath(join('vassal_extracted', 'images', filename), 'tokens');
          const imgPath = join(rootDir, resolved);
          if (existsSync(imgPath)) {
            ptLoadPromises.push(loadImage(imgPath).then((img) => ({ i, img })).catch(() => null));
          } else { ptLoadPromises.push(Promise.resolve(null)); }
        }
      }
    }
    const ptResults = await Promise.all(ptLoadPromises);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const result of ptResults) {
      if (!result) continue;
      const px = figX0 + result.i * (ptSize * 0.9);
      const py = figY0;
      const tw = result.img.width;
      const th = result.img.height;
      const tScale = Math.min(ptSize / tw, ptSize / th);
      const dw = Math.round(tw * tScale);
      const dh = Math.round(th * tScale);
      ctx.drawImage(result.img, px, py, dw, dh);
    }
    ctx.imageSmoothingEnabled = false;
    // Pre-load condition icon images in parallel, then draw sequentially (stacking leftward)
    const conditionIcons = (fig.conditions || []).slice(0, 5);
    if (conditionIcons.length > 0) {
      const iconSize = Math.max(11, Math.min(clipW, clipH) * 0.39);
      // Game state stores short verbs (Focus, Stun, etc.); GIF files use participles (Focused, Stunned, etc.)
      const COND_FILE_NAME = { Focus: 'Focused', Stun: 'Stunned', Bleed: 'Bleeding', Weaken: 'Weakened', Hide: 'Hidden' };
      const condImgPromises = conditionIcons.map((cond) => {
        const condIconFile = `Condition Marker--${COND_FILE_NAME[cond] || cond}.gif`;
        const condIconPath = join(rootDir, 'vassal_extracted', 'images', 'conditions', condIconFile);
        if (existsSync(condIconPath)) {
          return loadImage(condIconPath).catch(() => null);
        }
        return Promise.resolve(null);
      });
      const condImgs = await Promise.all(condImgPromises);
      let ciX = cx + clipW;
      const ciY = cy - clipH;
      for (const condImg of condImgs) {
        if (!condImg) continue;
        ciX -= iconSize;
        ctx.drawImage(condImg, ciX, ciY, iconSize, iconSize);
        ciX -= iconSize * 0.05;
      }
    }
    // Damage badge — bottom-center, only shown when damage > 0
    if (fig.damage > 0) {
      const dmgFontSize = Math.max(10, Math.round(13 * scale));
      const dmgText = String(fig.damage);
      ctx.font = `bold ${dmgFontSize}px "${FONT_FAMILY}"`;
      const dmgW = ctx.measureText(dmgText).width;
      const badgeR = Math.max(dmgW / 2 + 4, dmgFontSize * 0.7);
      const badgeX = cx;
      const badgeY = cy + clipH * 0.6;
      // Red circle background
      ctx.fillStyle = 'rgba(200, 30, 30, 0.9)';
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // White damage number
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(dmgText, badgeX, badgeY);
    }
  }

  // Player zone labels: draw player Discord names over their deployment zones
  const playerLabels = options.playerLabels || [];
  for (const { label, zone } of playerLabels) {
    if (!label || !zone || zone.length === 0) continue;
    const parsed = zone.map(parseCoord).filter((p) => p.col >= 0 && p.row >= 0);
    if (parsed.length === 0) continue;

    // Compute centroid of all zone cell centers
    let cx = 0;
    let cy = 0;
    for (const p of parsed) {
      cx += sx0 + p.col * sdx + sdx / 2;
      cy += sy0 + p.row * sdy + sdy / 2;
    }
    cx /= parsed.length;
    cy /= parsed.length;

    // Font sized to ~2.5 cells wide for typical name
    const fontSize = Math.round(Math.min(sdx, sdy) * 0.55);
    const displayLabel = label.length > 12 ? label.slice(0, 11) + '\u2026' : label;
    ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(displayLabel);
    const padH = Math.max(6, Math.round(fontSize * 0.3));
    const padV = Math.max(4, Math.round(fontSize * 0.2));
    const boxW = metrics.width + padH * 2;
    const boxH = fontSize + padV * 2;
    const boxX = cx - boxW / 2;
    const boxY = cy - boxH / 2;

    // Semi-transparent dark background
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // Yellow text with black outline
    ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.1));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(displayLabel, cx, cy);
    ctx.fillStyle = '#FFE033';
    ctx.fillText(displayLabel, cx, cy);
  }

  // Optionally crop to deployment zone for zoomed-in view
  if (cropToZone && Array.isArray(cropToZone) && cropToZone.length > 0) {
    const parsed = cropToZone.map((c) => parseCoord(c)).filter((p) => p.col >= 0 && p.row >= 0);
    if (parsed.length > 0) {
      const cols = parsed.map((p) => p.col);
      const rows = parsed.map((p) => p.row);
      const minCol = Math.max(0, Math.min(...cols) - 1);
      const maxCol = Math.min(numCols - 1, Math.max(...cols) + 1);
      const minRow = Math.max(0, Math.min(...rows) - 1);
      const maxRow = Math.min(numRows - 1, Math.max(...rows) + 1);
      const srcX = sx0 + minCol * sdx;
      const srcY = sy0 + minRow * sdy;
      const srcW = (maxCol - minCol + 1) * sdx;
      const srcH = (maxRow - minRow + 1) * sdy;
      const ZOOM_MAX_WIDTH = 800;
      const zoomScale = srcW > 0 ? Math.min(2, ZOOM_MAX_WIDTH / srcW) : 1;
      const outW = Math.round(srcW * zoomScale);
      const outH = Math.round(srcH * zoomScale);
      const cropCanvas = createCanvas(outW, outH);
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.imageSmoothingEnabled = true;
      cropCtx.imageSmoothingQuality = 'high';
      cropCtx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      return cropCanvas.toBuffer('image/png');
    }
  }

  return canvas.toBuffer('image/png');
}

/**
 * Get list of available map IDs
 */
export function getMapIds() {
  return getRegistry().maps.map((m) => m.id);
}
