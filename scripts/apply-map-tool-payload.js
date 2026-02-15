/**
 * Writes map-tool-save-payload.json into project data/ folder.
 * Use after "Save to file" in the map tool when the server isn't reachable.
 *
 *   node scripts/apply-map-tool-payload.js
 *   node scripts/apply-map-tool-payload.js "C:\Users\...\Downloads\map-tool-save-payload.json"
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');

const defaultPath = join(root, 'map-tool-save-payload.json');
const payloadPath = process.argv[2] ? process.argv[2].replace(/^["']|["']$/g, '') : defaultPath;

try {
  const raw = readFileSync(payloadPath, 'utf8');
  const payload = JSON.parse(raw);
  let wrote = 0;
  if (payload.mapSpaces != null) {
    writeFileSync(join(dataDir, 'map-spaces.json'), JSON.stringify(payload.mapSpaces, null, 2), 'utf8');
    wrote++;
  }
  if (payload.tournamentRotation != null) {
    writeFileSync(join(dataDir, 'tournament-rotation.json'), JSON.stringify(payload.tournamentRotation, null, 2), 'utf8');
    wrote++;
  }
  if (payload.deploymentZones != null) {
    writeFileSync(join(dataDir, 'deployment-zones.json'), JSON.stringify(payload.deploymentZones, null, 2), 'utf8');
    wrote++;
  }
  if (payload.mapTokens != null) {
    writeFileSync(join(dataDir, 'map-tokens.json'), JSON.stringify(payload.mapTokens, null, 2), 'utf8');
    wrote++;
  }
  if (payload.missionCards != null) {
    writeFileSync(join(dataDir, 'mission-cards.json'), JSON.stringify(payload.missionCards, null, 2), 'utf8');
    wrote++;
  }
  console.log('Applied', wrote, 'file(s) from', payloadPath, 'to data/.');
} catch (err) {
  console.error('Failed:', err.message);
  if (err.code === 'ENOENT') {
    console.error('Put map-tool-save-payload.json in the project folder, or run:');
    console.error('  node scripts/apply-map-tool-payload.js "<path-to-downloaded-file>"');
  }
  process.exit(1);
}
