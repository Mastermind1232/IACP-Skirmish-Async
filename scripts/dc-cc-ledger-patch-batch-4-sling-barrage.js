#!/usr/bin/env node
/**
 * Batch-4 DC/CC ledger patch: close the one real gap from batch-1 triage.
 *
 * Ewok Warrior (Elite) "Sling Barrage" — implemented end-to-end:
 *   - data/ability-library.json: structured `slingBarrageReroll: true` field.
 *   - src/game/abilities.js: dcSpecial handler sets free ranged attack +
 *     pendingSlingBarrage flag for the combat layer.
 *   - src/handlers/combat.js: pre-reroll hook counts OTHER group-mates with
 *     LOS to defender and adds that many to atkSpecialReroll.
 *   - src/game/activation-state.js: pendingSlingBarrage added to per-activation
 *     and round cleanup lists (no cross-activation leak).
 *   - tests/domain/oracle/dc-cc-sling-barrage-ewok-elite-probe.test.js pins
 *     library / DC-effects / resolveAbility / cleanup — all four layers.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const atom = ledger.atoms.find((a) => a.abilityKey === 'sling_barrage_ewok_elite');
if (!atom) throw new Error('sling_barrage_ewok_elite atom missing');

atom.status = 'covered';
atom.evidence = {
  files: [
    'data/ability-library.json',
    'src/game/abilities.js',
    'src/handlers/combat.js',
    'src/game/activation-state.js',
    'tests/domain/oracle/dc-cc-sling-barrage-ewok-elite-probe.test.js',
  ],
  assertions: [
    'slingBarrageReroll: true on sling_barrage_ewok_elite library entry',
    'Ewok Warrior (Elite) specialAbilityIds references the slug',
    'resolveAbility sets pendingSlingBarrage + freeAttackBonusPending + pendingOverrideAttackDice(ranged)',
    'combat.js reads game.pendingSlingBarrage[attackerMsgId], counts other-group-mates with LOS to target, adds that count to atkSpecialReroll',
    'activation-state per-activation + round cleanup lists both include pendingSlingBarrage',
  ],
};
atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-20' };
atom.notes = 'Live PvP correctness fix. Before this patch the Sling Barrage button was a silent no-op: the library entry had no dispatch fields, so Ewok Warrior (Elite) players lost up to 2 rerolls per Special Action attack vs printed rules. "Group" is enforced via figure-key prefix match (same DC name + dgIndex), matching the canonical definition used elsewhere for group-scoped effects. LOS check uses the shared hasLineOfSight helper with the same map-spaces resolution as sibling specials (Light It Up, Shared Calculations).';

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-4: Sling Barrage (Ewok Warrior Elite) wiring',
    patched: 1,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log('[dc-cc-ledger-patch-4] promoted sling_barrage_ewok_elite gap → covered');
