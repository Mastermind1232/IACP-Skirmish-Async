/**
 * Renders IA Skirmish maps with coordinate grid overlay (a1, b2, etc.)
 * Uses Vassal grid params from map-registry.json
 */

import { createCanvas, loadImage } from 'canvas';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let registryCache = null;

function getRegistry() {
  if (!registryCache) {
    const path = join(rootDir, 'data', 'map-registry.json');
    registryCache = JSON.parse(readFileSync(path, 'utf8'));
  }
  return registryCache;
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
  const { figures = [], showGrid = true, maxWidth = 1200 } = options;
  const mapDef = getMap(mapId);
  if (!mapDef) throw new Error(`Map not found: ${mapId}`);

  const imagePath = join(rootDir, mapDef.imagePath);
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
    ctx.font = '24px sans-serif';
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
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.font = `${Math.max(10, Math.round(12 * scale))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        const label = colToLetter(col) + (row + 1);
        const cx = sx0 + col * sdx + sdx / 2;
        const cy = sy0 + row * sdy + sdy / 2;
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
      }
    }
  }

  // Figure markers: circular clip to hide white background; size-scaled for 2x2/2x3 units
  const sizeMultipliers = { '1x1': 1, '1x2': 1.2, '2x2': 1.5, '2x3': 1.8 };
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
    const cx = sx0 + col * sdx + sdx / 2;
    const cy = sy0 + row * sdy + sdy / 2;
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
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
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
    if (!drewImage) {
      console.error(`Map figure image missing for DC "${fig.dcName || '?'}" at ${fig.coord} - run: node scripts/extract-figure-images.js`);
      ctx.fillStyle = fig.color || '#f00';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, 8 * scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
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
