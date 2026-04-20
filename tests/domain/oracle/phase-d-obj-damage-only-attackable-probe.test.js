/**
 * Phase-D probe: abilities that apply damage to objects only affect
 * objects that can be attacked. In skirmish, crates are the sole
 * attackable object, and they are the sole object with an HP field;
 * every damage-to-object site in `src/` targets `game.crateHealth` and
 * no other.
 *
 * PROBE-PD-OBJ-005: CRR OBJECTS — "Abilities that apply damage to
 *   objects only affect objects that can be attacked."
 *
 * Implementation: in skirmish, `game.crateHealth` is the ONLY
 *   object-HP field declared in `src/game-state.js` (other object
 *   containers — cratePositions, crateTokens, deviceTokens,
 *   ancillaryTokens, orbitalBombardmentTokens, openedDoors — are
 *   position/marker data with no HP). Every site that decrements
 *   object HP in `src/` writes to `game.crateHealth[origCoord]`:
 *     - direct-attack damage (combat-bridge.js ~line 307)
 *     - Blast splash damage (combat-bridge.js ~line 1317)
 *   Cleave target-selection adds only crates (`isCrate: true`) from
 *   cratePositions, not doors/tokens/terrain. CRR-AOJ-001 already
 *   pins crates as the sole skirmish object with destruction flow;
 *   this probe pins the complementary "only-attackable-target"
 *   shape of CRR-OBJ-005.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const GS_SRC = readFileSync(resolve(ROOT, 'src/game-state.js'), 'utf8');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-OBJ-005: object damage in skirmish only flows to crates (the sole attackable object)', () => {
  it('005a: state — crateHealth is declared in game-state.js as a per-coord HP container', () => {
    assert.match(GS_SRC, /'cratePositions', 'crateHealth', 'crateTokens', 'deviceTokens'/,
      'game-state.js must declare crateHealth alongside other object containers — CRR-OBJ-005');
  });

  it('005b: state — no OTHER object-HP field exists in game-state.js (no doorHealth / tokenHealth / terrainHealth / rubbleHealth)', () => {
    assert.doesNotMatch(GS_SRC, /doorHealth|tokenHealth|terrainHealth|rubbleHealth|deviceHealth|objectHealth/i,
      'no non-crate object may have an HP field — CRR-OBJ-005');
  });

  it('005c: source — every site that decrements object HP in src/ writes to game.crateHealth[origCoord] (no other HP-bearing object container is mutated)', () => {
    const crateDmgSites = [];
    const forbidden = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/game\.crateHealth\[origCoord\]\s*=\s*Math\.max\(0,\s*game\.crateHealth\[origCoord\]\s*-/.test(src)) {
        crateDmgSites.push(p.replace(ROOT + '/', ''));
      }
      // No other object-HP decrement sites may exist
      if (/game\.(doorHealth|tokenHealth|terrainHealth|rubbleHealth|deviceHealth|objectHealth)\[[^\]]+\]\s*=\s*Math\.max\(0/.test(src)) {
        forbidden.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(crateDmgSites, ['src/engine/combat-bridge.js'],
      'only combat-bridge.js may apply damage to objects — CRR-OBJ-005');
    assert.deepEqual(forbidden, [],
      'no src file may apply Math.max(0, -) damage decrement to any non-crate object container — CRR-OBJ-005');
  });

  it('005d: source — Cleave target-selection adds only crates (isCrate: true) from cratePositions, not doors/tokens/rubble', () => {
    // computeCleaveEligibleTargets helper pushes into a local `targets` array
    // (one site for melee, one for ranged); each push sets isCrate: true for
    // crate entries. The regex matches either the helper's `targets.push` or
    // the legacy `cleaveTargets.push` name.
    const cleaveCrateAdds = CB_SRC.match(/(?:cleaveTargets|targets)\.push\(\{[\s\S]*?isCrate:\s*true[\s\S]*?crateOrigCoord:/g) || [];
    assert.ok(cleaveCrateAdds.length >= 2,
      `Cleave must have ≥2 crate-adding sites (melee + ranged); found ${cleaveCrateAdds.length} — CRR-OBJ-005`);
    // Cleave must not add any non-crate object-flag as a target
    assert.doesNotMatch(CB_SRC,
      /(?:cleaveTargets|targets)\.push\(\{[\s\S]*?(?:isDoor|isToken|isRubble|isDevice|isMissionToken):\s*true/,
      'Cleave must not target non-crate objects — CRR-OBJ-005');
  });

  it('005e: source — the initial-attack target picker in combat-bridge.js does not build damage targets from deviceTokens, ancillaryTokens, orbitalBombardmentTokens, rubbleTokens, or openedDoors', () => {
    // Non-crate object containers must never be read to populate attack-damage targets.
    // (They are read for positioning/LOS/mission-rule purposes, but never as damage targets.)
    assert.doesNotMatch(CB_SRC,
      /(?:deviceTokens|ancillaryTokens|orbitalBombardmentTokens|rubbleTokens|openedDoors)\[[^\]]+\]\s*=\s*Math\.max\(0,/,
      'no non-crate object container may be subject to damage math — CRR-OBJ-005');
  });

  it('005f: cross-ref — CRR-AOJ-001 pins crate-destruction flow; this probe pins the complementary only-attackable-target scope', () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/crr-ledger.json'), 'utf8'));
    const aoj001 = ledger.atoms.find(a => a.id === 'CRR-AOJ-001');
    assert.ok(aoj001, 'CRR-AOJ-001 must exist in the ledger');
    assert.equal(aoj001.status, 'covered',
      'CRR-AOJ-001 must be covered (crate-destruction flow pinned) — CRR-OBJ-005 context');
  });
});
