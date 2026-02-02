/**
 * Utilities for DC card images (e.g. rotate for Exhausted state)
 */

import { createCanvas, loadImage } from 'canvas';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/**
 * Rotate an image 90 degrees clockwise. Returns PNG buffer or null.
 * @param {string} imagePath - Path relative to project root (e.g. vassal_extracted/images/D card-Imp--X.jpg)
 * @returns {Promise<Buffer|null>}
 */
export async function rotateImage90(imagePath) {
  if (!imagePath) return null;
  const fullPath = join(rootDir, imagePath);
  if (!existsSync(fullPath)) return null;
  try {
    const img = await loadImage(fullPath);
    const w = img.width;
    const h = img.height;
    const canvas = createCanvas(h, w); // swapped for 90° rotation
    const ctx = canvas.getContext('2d');
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('rotateImage90 error:', err);
    return null;
  }
}
