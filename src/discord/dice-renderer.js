/**
 * Composite dice-roll image renderer.
 * Loads vassal dice face JPGs and stitches them into a horizontal row PNG.
 *
 * Discord-only: not used by headless / oracle / engine paths.
 */
import { createCanvas, loadImage } from 'canvas';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const DICE_DIR = join(ROOT, 'vassal_extracted', 'images', 'dice');

const FACE_SIZE = 96;
const GAP = 10;
const PADDING = 8;

// Module-level image cache. Each face JPG is ~15-25 KB; loading lazily keeps
// startup cheap and the cache is bounded (6 colors × 6 faces = 36 images max).
const _imageCache = new Map();

function _capitalize(s) {
  return (s?.[0]?.toUpperCase() || '') + (s?.slice(1) || '');
}

async function _loadFace(color, faceIdx) {
  const key = `${color}|${faceIdx}`;
  if (_imageCache.has(key)) return _imageCache.get(key);
  const fileName = `Dice-${_capitalize(color)} ${faceIdx + 1}.jpg`;
  const path = join(DICE_DIR, fileName);
  if (!existsSync(path)) return null;
  try {
    const img = await loadImage(path);
    _imageCache.set(key, img);
    return img;
  } catch {
    return null;
  }
}

/**
 * Render a horizontal row of dice faces and return a PNG buffer.
 * `dice` items must have `{color, faceIdx}` (others fields are ignored).
 * Returns null when no faces could be loaded — caller should fall back to text.
 */
async function _renderRow(dice) {
  if (!Array.isArray(dice) || dice.length === 0) return null;
  const faces = await Promise.all(
    dice.map((d) => (d?.faceIdx >= 0 ? _loadFace(d.color, d.faceIdx) : null))
  );
  const valid = faces.filter(Boolean);
  if (valid.length === 0) return null;
  const width = PADDING * 2 + faces.length * FACE_SIZE + (faces.length - 1) * GAP;
  const height = PADDING * 2 + FACE_SIZE;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2d31'; // Discord dark-mode neutral background
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < faces.length; i++) {
    const x = PADDING + i * (FACE_SIZE + GAP);
    const y = PADDING;
    if (faces[i]) {
      ctx.drawImage(faces[i], x, y, FACE_SIZE, FACE_SIZE);
    } else {
      ctx.fillStyle = '#444';
      ctx.fillRect(x, y, FACE_SIZE, FACE_SIZE);
    }
  }
  return canvas.toBuffer('image/png');
}

export async function renderAttackDiceImage(diceResults) {
  return _renderRow(diceResults);
}

export async function renderDefenseDiceImage(diceResults) {
  return _renderRow(diceResults);
}
