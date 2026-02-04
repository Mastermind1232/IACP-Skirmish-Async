/**
 * Renders IA Skirmish maps with coordinate grid overlay (a1, b2, etc.)
 * Uses Vassal grid params from map-registry.json
 */

import { createCanvas, loadImage, registerFont } from 'canvas';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

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

function getMapSpaces(mapId) {
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
/** Parse coord "g10" -> { col, row } (0-based) */
function parseCoord(coord) {
  const s = String(coord || '').toLowerCase();
  const letter = s.match(/[a-z]+/)?.[0] || '';
  const num = parseInt(s.match(/\d+/)?.[0] || '0', 10);
  const col = letter
    ? [...letter].reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 96), 0) - 1
    : -1;
  const row = num - 1;
  return { col, row };
}

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
    const onMapCoords = getMapSpaces(mapId);
    const coordFilter = showGridOnlyOnCoords
      ? new Set((Array.isArray(showGridOnlyOnCoords) ? showGridOnlyOnCoords : []).map((c) => String(c).toLowerCase()))
      : null;
    ctx.fillStyle = useBlackGrid ? '#000000' : 'rgba(0,0,0,0.7)';
    ctx.strokeStyle = useBlackGrid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = useBlackGrid ? 2.5 : 2;
    ctx.font = `bold ${Math.max(11, Math.round(13 * scale))}px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        const label = colToLetter(col) + (row + 1);
        const coordKey = label.toLowerCase();
        if (onMapCoords.size > 0 && !onMapCoords.has(coordKey)) continue;
        if (coordFilter && !coordFilter.has(coordKey)) continue;
        const cx = sx0 + col * sdx + sdx / 2;
        const cy = sy0 + row * sdy + sdy / 2;
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
      }
    }
  }

  // Figure markers: circular clip to hide white background; size-scaled to fill footprint
  // Coord is top-left for large units; center the figure on its footprint
  // 2x2 footprint = 2 cells → diameter should span ~2 cells; 2x3 = 2–3 cells
  const sizeMultipliers = { '1x1': 1, '1x2': 1.4, '2x2': 2.05, '2x3': 2.4 };
  const baseTokenSize = Math.min(Math.max(52, 64 * scale), sdx * 0.95, sdy * 0.95);
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
    const mult = sizeMultipliers[fig.figureSize] || 1;
    const tokenSize = baseTokenSize * mult;
    const clipRadius = tokenSize / 2;
    let drewImage = false;
    if (fig.imagePath) {
      const figPath = join(rootDir, fig.imagePath);
      if (existsSync(figPath)) {
        try {
          const figImg = await loadImage(figPath);
          const tw = figImg.width;
          const th = figImg.height;
          const tScale = Math.min(tokenSize / tw, tokenSize / th);
          const dw = Math.round(tw * tScale);
          const dh = Math.round(th * tScale);
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, clipRadius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(figImg, cx - dw / 2, cy - dh / 2, dw, dh);
          ctx.restore();
          ctx.strokeStyle = fig.color || '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, clipRadius, 0, Math.PI * 2);
          ctx.stroke();
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
      const labelY = cy - clipRadius * 0.6;
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
  }

  // Draw map tokens using game box images from vassal_extracted/images/tokens
  const tokenSize = Math.min(sdx, sdy) * 0.9;
  const tc = getTokenImagesConfig();
  const imagesDir = join(rootDir, 'vassal_extracted', 'images');

  const drawTokenAt = async (coord, imageFilename, fallbackStyle, fallbackShape = 'square', label = null) => {
    const { col, row } = parseCoord(coord);
    if (col < 0 || row < 0 || col >= numCols || row >= numRows) return;
    const cx = sx0 + col * sdx + sdx / 2;
    const cy = sy0 + row * sdy + sdy / 2;
    const resolved = imageFilename ? resolveImagePath(join('vassal_extracted', 'images', imageFilename), 'tokens') : null;
    const imgPath = resolved ? join(rootDir, resolved) : null;
    if (imgPath && existsSync(imgPath)) {
      try {
        const tokenImg = await loadImage(imgPath);
        const tw = tokenImg.width;
        const th = tokenImg.height;
        const tScale = Math.min(tokenSize / tw, tokenSize / th);
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
          ctx.arc(cx, cy, tokenSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(cx - tokenSize / 2, cy - tokenSize / 2, tokenSize, tokenSize);
          ctx.strokeRect(cx - tokenSize / 2, cy - tokenSize / 2, tokenSize, tokenSize);
        }
      }
    } else {
      ctx.fillStyle = fallbackStyle;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      if (fallbackShape === 'circle') {
        ctx.beginPath();
        ctx.arc(cx, cy, tokenSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(cx - tokenSize / 2, cy - tokenSize / 2, tokenSize, tokenSize);
        ctx.strokeRect(cx - tokenSize / 2, cy - tokenSize / 2, tokenSize, tokenSize);
      }
    }
    if (label) {
      const fontSize = Math.max(9, Math.round(11 * scale));
      ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const paddingH = Math.max(4, Math.round(6 * scale));
      const paddingV = Math.max(2, Math.round(3 * scale));
      const metrics = ctx.measureText(label);
      const boxW = metrics.width + paddingH * 2;
      const boxH = fontSize + paddingV * 2;
      const labelY = cy + tokenSize / 2 - boxH / 2;
      const boxX = cx - boxW / 2;
      const boxY = labelY - boxH / 2;
      ctx.fillStyle = '#000000';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = '#FFEB3B';
      ctx.fillText(label, cx, labelY);
    }
  };

  for (const coord of tokens.terminals || []) {
    await drawTokenAt(coord, tc.terminals, 'rgba(79,195,247,0.8)', 'square');
  }
  for (const coord of tokens.missionA || []) {
    await drawTokenAt(coord, tc.missionA, 'rgba(120,120,120,0.9)', 'circle', 'Panel');
  }
  for (const coord of tokens.missionB || []) {
    await drawTokenAt(coord, tc.missionB, 'rgba(255,183,77,0.8)', 'square', 'Contraband');
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
