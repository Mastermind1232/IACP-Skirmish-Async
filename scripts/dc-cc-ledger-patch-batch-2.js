#!/usr/bin/env node
/**
 * Batch-2 DC/CC ledger patch: Rebel Trooper (Elite) "Get into Position" wiring.
 *
 * Promotes DC-SPEC-GET-INTO-POSITION from pending → covered after the
 * three-part fix (library actionCost field, data-loader propagation, card
 * specialAbilityIds link).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const atom = ledger.atoms.find((a) => a.abilityKey === 'get_into_position');
if (!atom) throw new Error('get_into_position atom missing');

atom.status = 'covered';
atom.evidence = {
  files: [
    'data/ability-library.json',
    'data/dc-effects.json',
    'src/data-loader.js',
    'src/game/abilities.js',
    'tests/domain/oracle/dc-cc-rebel-trooper-elite-get-into-position-probe.test.js',
  ],
  assertions: [
    'get_into_position library entry has actionCost=2 and mpBonus=4',
    'Rebel Trooper (Elite) specialAbilityIds includes get_into_position',
    'getDcStats returns specialCosts=2 for the ability',
  ],
};
atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-20' };
atom.notes = 'Double-action special. Runtime dispatch via generic dcSpecial handler at src/game/abilities.js (mpBonus + applyFocus branch). The new library-level actionCost field (respected by data-loader.js getDcStats) is the canonical way to express N-action costs for specials without per-card specialCosts overrides. Rebel Trooper (Elite) was the card that motivated the schema — its card text declares "Double Action Special" but the slug had never been linked.';

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-2: Rebel Trooper Elite Get into Position wiring',
    patched: 1,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log('[dc-cc-ledger-patch-2] promoted get_into_position → covered');
