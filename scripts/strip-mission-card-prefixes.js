#!/usr/bin/env node
/**
 * Remove "SkMission Card--" / "Skirmish Mission" style filler from mission card filenames.
 * Current: "Map Name - SkMission Card--Map Name-A-Mission.jpg" -> "Map Name-A-Mission.jpg"
 * Also: "Skirmish Mission randomizer..." -> "randomizer...", "Skirmish Mission Card--..." -> "...", etc.
 * Updates data/mission-cards.json. Run: node scripts/strip-mission-card-prefixes.js
 */
import { readdirSync, renameSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const missionCardsDir = join(root, 'vassal_extracted', 'images', 'mission-cards');
const missionCardsJson = join(root, 'data', 'mission-cards.json');

function newName(oldName) {
  // "Map Name - SkMission Card--Map Name-A-Mission.ext" -> "Map Name-A-Mission.ext"
  if (oldName.includes(' - SkMission Card--')) {
    const after = oldName.replace(/^.* - SkMission Card--/, '');
    if (after && after !== oldName) return after;
  }
  // "SkMission Card--Map Name-A-Mission.ext" (if any left) -> "Map Name-A-Mission.ext"
  if (oldName.startsWith('SkMission Card--')) {
    return oldName.slice('SkMission Card--'.length);
  }
  // "Skirmish Mission Card--" / "Skirmish Mission card--" first (longer prefix)
  if (oldName.startsWith('Skirmish Mission Card--')) return oldName.slice('Skirmish Mission Card--'.length);
  if (oldName.startsWith('Skirmish Mission card--')) return oldName.slice('Skirmish Mission card--'.length);
  // "Skirmish Mission randomizer..." -> "randomizer..."
  if (oldName.startsWith('Skirmish Mission ')) return oldName.slice('Skirmish Mission '.length);
  // "Skirmish Card - "
  if (oldName.startsWith('Skirmish Card - ')) return oldName.slice('Skirmish Card - '.length);
  return null;
}

function main() {
  if (!existsSync(missionCardsDir)) {
    console.error('Folder not found:', missionCardsDir);
    process.exit(1);
  }

  const files = readdirSync(missionCardsDir, { withFileTypes: true }).filter((f) => f.isFile());
  const renames = [];

  for (const f of files) {
    const name = f.name;
    const n = newName(name);
    if (!n || n === name) continue;
    const oldPath = join(missionCardsDir, name);
    const newPath = join(missionCardsDir, n);
    if (existsSync(newPath) && newPath !== oldPath) {
      console.warn('Skip (target exists):', name);
      continue;
    }
    try {
      renameSync(oldPath, newPath);
      renames.push({ oldName: name, newName: n });
      console.log(name, '->', n);
    } catch (err) {
      console.error('Failed:', name, err.message);
    }
  }

  if (renames.length === 0) {
    console.log('No files renamed.');
    return;
  }

  if (!existsSync(missionCardsJson)) {
    console.log('mission-cards.json not found; skip JSON update.');
    return;
  }

  let json = readFileSync(missionCardsJson, 'utf8');
  for (const { oldName, newName: n } of renames) {
    const oldPath = 'vassal_extracted/images/mission-cards/' + oldName;
    const newPath = 'vassal_extracted/images/mission-cards/' + n;
    json = json.split(oldPath).join(newPath);
  }
  writeFileSync(missionCardsJson, json, 'utf8');
  console.log('Updated', missionCardsJson);
  console.log('Done. Renamed', renames.length, 'files.');
}

main();
