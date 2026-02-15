#!/usr/bin/env node
/**
 * Rename mission card files so they start with the map name (for alphabetical grouping).
 * Pattern: "SkMission Card--{Map Name}-{A|B}-{Mission}.ext" -> "{Map Name} - SkMission Card--..."
 * Only renames files that start with "SkMission Card--". Updates data/mission-cards.json.
 * Run: node scripts/rename-mission-cards-by-map.js
 */
import { readdirSync, renameSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const missionCardsDir = join(root, 'vassal_extracted', 'images', 'mission-cards');
const missionCardsJson = join(root, 'data', 'mission-cards.json');

const PREFIX = 'SkMission Card--';

function extractMapName(filename) {
  if (!filename.startsWith(PREFIX)) return null;
  const rest = filename.slice(PREFIX.length);
  const aIdx = rest.indexOf('-A-');
  const bIdx = rest.indexOf('-B-');
  let idx = -1;
  if (aIdx >= 0 && bIdx >= 0) idx = Math.min(aIdx, bIdx);
  else if (aIdx >= 0) idx = aIdx;
  else if (bIdx >= 0) idx = bIdx;
  if (idx < 0) return null;
  return rest.slice(0, idx).trim();
}

function main() {
  if (!existsSync(missionCardsDir)) {
    console.error('Folder not found:', missionCardsDir);
    process.exit(1);
  }

  const files = readdirSync(missionCardsDir, { withFileTypes: true }).filter((f) => f.isFile());
  const renames = []; // { oldName, newName }

  for (const f of files) {
    const name = f.name;
    if (!name.startsWith(PREFIX)) continue;
    const mapName = extractMapName(name);
    if (!mapName) continue;
    const newName = mapName + ' - ' + name;
    if (newName === name) continue;
    const oldPath = join(missionCardsDir, name);
    const newPath = join(missionCardsDir, newName);
    if (existsSync(newPath) && newPath !== oldPath) {
      console.warn('Skip (target exists):', name);
      continue;
    }
    try {
      renameSync(oldPath, newPath);
      renames.push({ oldName: name, newName });
      console.log('Renamed:', name, '->', newName);
    } catch (err) {
      console.error('Failed:', name, err.message);
    }
  }

  const renameMap = Object.fromEntries(renames.map((r) => [r.oldName, r.newName]));
  if (renames.length === 0) {
    console.log('No files renamed.');
    return;
  }

  if (!existsSync(missionCardsJson)) {
    console.log('mission-cards.json not found; skip JSON update.');
    return;
  }

  let json = readFileSync(missionCardsJson, 'utf8');
  for (const [oldName, newName] of Object.entries(renameMap)) {
    const oldPath = 'vassal_extracted/images/mission-cards/' + oldName;
    const newPath = 'vassal_extracted/images/mission-cards/' + newName;
    json = json.split(oldPath).join(newPath);
  }
  writeFileSync(missionCardsJson, json, 'utf8');
  console.log('Updated', missionCardsJson);
  console.log('Done. Renamed', renames.length, 'files.');
}

main();
