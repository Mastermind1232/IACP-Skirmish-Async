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

describe('PROBE-PD-OBJ-005: object damage flows via the unified object-damage pipeline', () => {
  it('005a: state — objectHealth is declared in game-state.js as the unified per-id HP container', () => {
    // Slice 3 (alexanbv 2026-05-10): legacy crateHealth removed; HP for
    // every damageable mission object lives in objectHealth[objectId].
    assert.match(GS_SRC, /'objectHealth', 'objectPositions', 'objectMeta'/,
      'game-state.js must declare objectHealth/objectPositions/objectMeta as the unified object-damage state — CRR-OBJ-005');
    assert.doesNotMatch(GS_SRC, /'crateHealth'/,
      'legacy crateHealth must NOT remain in game-state.js OBJECT_FLAGS — CRR-OBJ-005');
  });

  it('005b: state — no per-class HP fields (doorHealth / tokenHealth / terrainHealth / rubbleHealth) exist; everything routes through objectHealth', () => {
    assert.doesNotMatch(GS_SRC, /doorHealth|tokenHealth|terrainHealth|rubbleHealth|deviceHealth/i,
      'no per-class object-HP field may exist; use objectHealth via mission rules.damageableObjects — CRR-OBJ-005');
  });

  it('005c: source — no src/ file uses legacy crateHealth[origCoord] decrement; damage now flows via applyDamageToObject', () => {
    const legacyDmgSites = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/game\.crateHealth\[origCoord\]\s*=\s*Math\.max\(0,\s*game\.crateHealth\[origCoord\]\s*-/.test(src)) {
        legacyDmgSites.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(legacyDmgSites, [],
      'no src file may use the legacy crateHealth decrement pattern — Slice 3 routes through applyDamageToObject');
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
