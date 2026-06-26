/**
 * Composite dice-roll image renderer.
 * Loads vassal dice face JPGs and stitches them into a horizontal row PNG.
 *
 * Discord-only: not used by headless / oracle / engine paths.
 */
import { createCanvas, loadImage } from 'canvas';
import { AttachmentBuilder } from 'discord.js';
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

function _cap(s) {
  return (s?.[0]?.toUpperCase() || '') + (s?.slice(1) || '');
}

/**
 * Compact text description of one or more rolled dice faces, reused for the
 * image-render fallback and for terse out-of-combat roll reveals.
 * Attack example: "Red: 2 Damage, 1 Surge" or "Yellow: Blank".
 * Defense example: "White: 1 Block, 1 Evade" or "White: Dodge" / "White: Blank".
 * `dice` items carry the resolved face fields (acc/dmg/surge or block/evade/dodge).
 */
export function formatDieFaces(dice, defense = false) {
  if (!Array.isArray(dice) || dice.length === 0) return '';
  return dice
    .map((d) => {
      const color = _cap(d?.color || '');
      const parts = [];
      if (defense) {
        if (d?.dodge) parts.push('Dodge');
        if (d?.block) parts.push(`${d.block} Block`);
        if (d?.evade) parts.push(`${d.evade} Evade`);
      } else {
        if (d?.dmg) parts.push(`${d.dmg} Damage`);
        if (d?.surge) parts.push(`${d.surge} Surge`);
        if (d?.acc) parts.push(`${d.acc} Accuracy`);
      }
      const body = parts.length ? parts.join(', ') : 'Blank';
      return color ? `${color}: ${body}` : body;
    })
    .join('; ');
}

/**
 * Shared out-of-combat roll reveal: renders the rolled die face image and posts
 * it to the activation thread (mirroring how combat shows the face). Never throws
 * into the ability flow — all Discord/render calls are `.catch`-guarded.
 *
 * - `thread`  the activation thread (may be null in headless/self-play → text no-op)
 * - `content` the message text (e.g. "X rolled a die")
 * - `dice`    array of `{ color, faceIdx, ...faceFields }`
 * - `defense` true to render/format as a defense die
 *
 * On image success, posts `{ content, files:[die-roll.png] }`. On render failure
 * (or no thread / no faces), posts `content` plus a compact text fallback.
 */
export async function postDieRollResult(thread, { content, dice, defense = false } = {}) {
  const fallback = formatDieFaces(dice, defense);
  const textMsg = fallback ? `${content}  [${fallback}]` : content;
  if (!thread || typeof thread.send !== 'function') return;
  const render = defense ? renderDefenseDiceImage : renderAttackDiceImage;
  const img = await render(dice).catch(() => null);
  if (img) {
    await thread
      .send({ content, files: [new AttachmentBuilder(img, { name: 'die-roll.png' })] })
      .catch(() => {});
  } else {
    await thread.send(textMsg).catch(() => {});
  }
}
