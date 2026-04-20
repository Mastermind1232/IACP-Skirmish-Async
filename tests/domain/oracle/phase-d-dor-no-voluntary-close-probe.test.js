/**
 * Phase-D probe: figures cannot voluntarily close doors.
 *
 * PROBE-PD-DOR-005: CRR DOORS — "If an effect closes a door, place a door
 *   token on the map as shown on the mission's map; figures cannot
 *   voluntarily close doors."
 *
 * Implementation: `game.openedDoors` is an append-only array of edge keys.
 *   The only mutation sites are `src/handlers/interact.js` (user clicks
 *   open_door_) and `src/handlers/map-events.js` (Massive-figure movement
 *   opens a door automatically) — both `.push(ek)` with duplicate guard.
 *   No code path removes an edge from `openedDoors`, and the interact
 *   menu surfaces no `close_door_` option, so a voluntary close is
 *   structurally impossible.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SRC_DIR = resolve(ROOT, 'src');
const INTERACT_SRC = readFileSync(resolve(SRC_DIR, 'handlers/interact.js'), 'utf8');
const MAP_EVENTS_SRC = readFileSync(resolve(SRC_DIR, 'handlers/map-events.js'), 'utf8');

function walkJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkJsFiles(p));
    else if (/\.js$/.test(name) && !/\.test\.js$/.test(name)) out.push(p);
  }
  return out;
}

describe('PROBE-PD-DOR-005: figures cannot voluntarily close doors', () => {
  it('005a: interact handler surfaces only open_door_ options — no close_door_', () => {
    assert.match(INTERACT_SRC, /open_door_/,
      'interact must surface open_door_ options — CRR-DOR-005');
    assert.doesNotMatch(INTERACT_SRC, /close_door_/,
      'no close_door_ option can exist in interact — CRR-DOR-005 (no voluntary close)');
  });

  it('005b: openedDoors mutation sites are all append-only (.push)', () => {
    assert.match(INTERACT_SRC,
      /game\.openedDoors\.push\(ek\)/,
      'interact opens a door by pushing the edge key — CRR-DOR-005');
    assert.match(MAP_EVENTS_SRC,
      /game\.openedDoors\.push\(openedEdgeKey\)/,
      'map-events (Massive auto-open) pushes the edge key — CRR-DOR-005');
  });

  it('005c: no file under src/ contains a closeDoor / close_door / openedDoors.splice / pop / shift call', () => {
    const files = walkJsFiles(SRC_DIR);
    const forbidden = [
      /closeDoor\b/,
      /close_door\b/,
      /openedDoors\.splice\b/,
      /openedDoors\.pop\b/,
      /openedDoors\.shift\b/,
    ];
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const rx of forbidden) {
        if (rx.test(src)) offenders.push(`${f}: ${rx}`);
      }
    }
    assert.deepEqual(offenders, [],
      'no source file may contain door-close code — CRR-DOR-005 (found: ' + offenders.join(', ') + ')');
  });
});
