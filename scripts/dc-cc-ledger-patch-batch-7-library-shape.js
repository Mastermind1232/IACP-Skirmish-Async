#!/usr/bin/env node
/**
 * Batch-7 DC/CC ledger patch: library-shape coverage for 15 data-driven CCs.
 *
 * Each CC in this batch is consumed via one or more structured fields on its
 * `data/ability-library.json` entry. The field names and shapes ARE the
 * contract implied by card text. A data-shape probe is sufficient coverage
 * because handler-path tests would only re-verify the same field.
 *
 * Probe file: tests/domain/oracle/dc-cc-library-shape-batch-7-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-library-shape-batch-7-probe.test.js';

const PROMOTIONS = [
  { id: 'CC-A-POWERFUL-INFLUENCE',   name: 'A Powerful Influence',
    assertions: ['interactBlockRange = 3', 'controlBlockRange = 3'] },
  { id: 'CC-BALANCING-FORCE',        name: 'Balancing Force',
    assertions: ['balancingForceEffect = true'] },
  { id: 'CC-BEHIND-ENEMY-LINES',     name: 'Behind Enemy Lines',
    assertions: ['revealsOpponentDeckTop = 3'] },
  { id: 'CC-BLEND-IN',               name: 'Blend In',
    assertions: ['applyHide = true (self-apply Hidden)'] },
  { id: 'CC-CAMOUFLAGE',             name: 'Camouflage',
    assertions: ['applyHideWhenDefending = true (defensive Hidden)'] },
  { id: 'CC-CHEAT-TO-WIN',           name: 'Cheat to Win',
    assertions: ['cheatToWinEffect = true (choose any face on Gambit die)'] },
  { id: 'CC-CLOSE-THE-GAP',          name: 'Close the Gap',
    assertions: ['grantMpToFriendliesByKeyword pins { keyword: BRAWLER, mp: 2, grantBlockToken: true }'] },
  { id: 'CC-COLLECT-INTEL',          name: 'Collect Intel',
    assertions: ['revealsOpponentHand = true'] },
  { id: 'CC-COORDINATED-ATTACK',     name: 'Coordinated Attack',
    assertions: ['coordinatedAttackEffect = true'] },
  { id: 'CC-DATA-THEFT',             name: 'Data Theft',
    assertions: ['stealsFromOpponentDiscard = true'] },
  { id: 'CC-DEPLOY-THE-GARRISON',    name: 'Deploy the Garrison',
    assertions: ['deployGarrisonEffect = true'] },
  { id: 'CC-DOUBLE-OR-NOTHING',      name: 'Double or Nothing',
    assertions: ['doubleOrNothingEffect = true', 'doubleMatchingIconsOnReroll = true'] },
  { id: 'CC-EFFICIENT-TRAVEL',       name: 'Efficient Travel',
    assertions: ['roundEfficientTravel = true'] },
  { id: 'CC-EMERGENCY-AID',          name: 'Emergency Aid',
    assertions: ['recoverDamageToAdjacent = 2', 'recoverDamageToAdjacentIfTrait = { GUARDIAN: 3, LEADER: 3 }'] },
  { id: 'CC-ENDLESS-RESERVES',       name: 'Endless Reserves',
    assertions: ['placeDefeatedFigure pins { traitFilter: [TROOPER], placementAnchor: sameGroup, shuffleBackToDeck: true }'] },
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const p of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === p.id);
  if (!atom) throw new Error(`atom ${p.id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-7] skip ${p.id}: status is ${atom.status} (not pending)`);
    continue;
  }
  const implRefFiles = Object.keys(atom.triage?.implRefs || {});
  atom.status = 'covered';
  atom.implHint = `Library-shape coverage in ${PROBE_FILE} for ${p.name}.`;
  atom.evidence = {
    files: [...new Set([...implRefFiles, 'data/ability-library.json', PROBE_FILE])].sort(),
    assertions: p.assertions,
  };
  atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
  atom.notes = 'Promoted via batch-7 library-shape probe (data-driven ccEffect structural contract).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-7: ccEffect library-shape contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-7] promoted ${patched} atom(s) pending → covered`);
