/**
 * Normalize CC image filenames: strip C card-- prefix, sort A–Z.
 * Base: CardName.ext. IACP variants: CardName (IACP).ext when both exist.
 * No cc-names lookup — uses whatever name is in the file.
 * Run: node scripts/normalize-cc-images.js
 */

import { readdirSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ccDir = join(root, 'vassal_extracted', 'images', 'cc');

function stripPrefix(s) {
  return s
    .replace(/^Command card--/i, '')
    .trim();
}

/** Extract { cardName, ext, iacp } from filename. Returns null if unparseable. */
function extractCardName(filename) {
  let match = filename.match(/^IACP\d*_?C card--(.+)\.(png|jpg|gif)$/i);
  if (match) return { name: stripPrefix(match[1].trim()), ext: match[2].toLowerCase(), iacp: true };
  match = filename.match(/^C card--(.+)\.(png|jpg|gif)$/i);
  if (match) return { name: stripPrefix(match[1].trim()), ext: match[2].toLowerCase(), iacp: false };
  match = filename.match(/^\d+\s+(.+) Final\.(png|jpg|gif)$/i);
  if (match) return { name: match[1].trim(), ext: match[2].toLowerCase(), iacp: false };
  // Already normalized
  match = filename.match(/^(.+) \(IACP\)\.(png|jpg|gif)$/i);
  if (match) return { name: match[1].trim(), ext: match[2].toLowerCase(), iacp: true, alreadyNormalized: true };
  match = filename.match(/^(.+)\.(png|jpg|gif)$/i);
  if (match) {
    const name = match[1].trim();
    if (name.endsWith(' (IACP)')) return null;
    return { name, ext: match[2].toLowerCase(), iacp: false, alreadyNormalized: true };
  }
  return null;
}

function safeFilename(name) {
  return name.replace(/[/\\?*:|"]/g, '_');
}

function normalizeKey(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const files = readdirSync(ccDir, { withFileTypes: true }).filter((f) => f.isFile());
const byCard = new Map(); // normalizedKey -> { baseName, items: [{ path, ext, iacp, ... }] }

for (const f of files) {
  const parsed = extractCardName(f.name);
  if (!parsed) continue;
  const fullPath = join(ccDir, f.name);
  const key = normalizeKey(parsed.name);
  const baseName = parsed.name; // keep first occurrence for display
  if (!byCard.has(key)) byCard.set(key, { baseName, items: [] });
  byCard.get(key).items.push({ ...parsed, path: fullPath, name: f.name });
}

let renamed = 0;
for (const [, { baseName, items }] of byCard) {
  const iacpItems = items.filter((x) => x.iacp).sort((a, b) => (a.alreadyNormalized === b.alreadyNormalized ? 0 : a.alreadyNormalized ? -1 : 1));
  const baseItems = items.filter((x) => !x.iacp).sort((a, b) => (a.alreadyNormalized === b.alreadyNormalized ? 0 : a.alreadyNormalized ? -1 : 1));

  const processGroup = (group, label) => {
    if (group.length === 0) return;
    const preferred = group[0];
    const targetName = `${safeFilename(baseName)}${label}.${preferred.ext}`;
    const targetPath = join(ccDir, targetName);
    if (preferred.path !== targetPath) {
      if (existsSync(targetPath)) {
      const stem = `${safeFilename(baseName)}${label}`;
      const legacyName = `${stem}_legacy.${preferred.ext}`;
      const legacyPath = join(ccDir, legacyName);
      if (preferred.path !== legacyPath) renameSync(targetPath, legacyPath);
    }
      renameSync(preferred.path, targetPath);
      renamed++;
    }
    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      const stem = `${safeFilename(baseName)}${label}`;
      const legacyName = `${stem}_legacy_${i}.${item.ext}`;
      const legacyPath = join(ccDir, legacyName);
      if (item.path !== legacyPath) {
        renameSync(item.path, legacyPath);
        renamed++;
      }
    }
  };

  // Only add (IACP) when we have both base and IACP variant
  const hasBoth = iacpItems.length > 0 && baseItems.length > 0;
  processGroup(iacpItems, hasBoth ? ' (IACP)' : '');
  processGroup(baseItems, '');
}

console.log(`Normalized ${renamed} CC image(s). Base: CardName.ext. IACP: CardName (IACP).ext`);
