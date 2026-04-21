#!/usr/bin/env node
/**
 * Apply manual verdicts to the 18 high-risk atoms from the first triage pass.
 *
 * Categories:
 *  A. REAL GAP — sling_barrage_ewok_elite: 0 src hits for slug OR label.
 *  B. ORPHAN  — dead_weight_pardon_bokatan: no owning DC, 0 hits (dead data).
 *  C. SURGE-COMBO DATA-DRIVEN — 3 keys parsed at runtime by parseSurgeEffect
 *     (src/game/combat.js:174, comma-split additive). Triage is false-positive.
 *  D. WIRED UNDER LABEL — 13 atoms where the slug is data but the runtime
 *     uses the printed card name. Not a gap, but needs direct evidence review
 *     before we can mark `covered`. Leave status=pending, attach implHint.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');

const verdicts = {
  // A — real gap
  sling_barrage_ewok_elite: {
    status: 'gap',
    notes: 'IMPLEMENTATION GAP: no src/ hits for slug OR label "Sling Barrage". Card text: perform a ranged attack with +1 reroll per nearby friendly Ewok. Other Ewok Warrior (Elite) ability "Forest Fighters" is wired at src/handlers/combat.js (ForestFighters), so the DC is partially implemented. Needs handler.',
  },

  // B — orphan library entry
  dead_weight_pardon_bokatan: {
    status: 'exempt',
    exemptReason: 'Orphan library entry — no owning DC references this slug in data/dc-effects.json. Either a retired key or scaffolded for a future card that was never added. Safe to ignore.',
  },

  // C — surge combos parsed by parseSurgeEffect
  'accuracy 2, damage 2': {
    status: 'covered',
    evidence: {
      files: ['src/game/combat.js', 'tests/domain/oracle/dc-cc-surge-combo-parse-probe.test.js'],
      assertions: ['parseSurgeEffect comma-splits and accumulates damage/accuracy'],
    },
    reviewedBy: { name: 'claude-opus-4-7', date: '2026-04-20' },
    notes: 'Data-driven: parseSurgeEffect (src/game/combat.js:174) comma-splits the key and adds each primitive modifier. Library entry carries only label; runtime composition is additive. Oracle dc-cc-surge-combo-parse-probe.test.js pins accumulation.',
  },
  'damage 1, accuracy 1': {
    status: 'covered',
    evidence: {
      files: ['src/game/combat.js', 'tests/domain/oracle/dc-cc-surge-combo-parse-probe.test.js'],
      assertions: ['parseSurgeEffect comma-splits and accumulates damage/accuracy'],
    },
    reviewedBy: { name: 'claude-opus-4-7', date: '2026-04-20' },
    notes: 'Data-driven via parseSurgeEffect; composition is additive, library entry is name-only.',
  },
  'pierce 1, hide': {
    status: 'covered',
    evidence: {
      files: ['src/game/combat.js', 'tests/domain/oracle/dc-cc-surge-combo-parse-probe.test.js'],
      assertions: ['parseSurgeEffect handles pierce N', 'hide is self-condition surge'],
    },
    reviewedBy: { name: 'claude-opus-4-7', date: '2026-04-20' },
    notes: 'Data-driven: pierce N via generic regex, hide via surgeSelfHide branch in parseSurgeEffect.',
  },

  // D — wired under printed-card label; needs direct evidence pass before `covered`
  attached_dio: { implHint: 'wired under label "Attached" (17 src hits); needs direct review' },
  droid_kit_iden: { implHint: 'wired under label "Droid Kit" (6 src hits); needs direct review' },
  dubious_counterparts_aphra: { implHint: 'wired under label "Dubious Counterparts" (5 src hits); needs direct review' },
  flamethrower_terro: { implHint: 'wired under label "Flamethrower" (7 src hits); needs direct review' },
  field_tactics_death_trooper_elite: { implHint: 'wired under label "Field Tactics" (10 src hits); needs direct review' },
  field_tactics_death_trooper_reg: { implHint: 'wired under label "Field Tactics" (10 src hits); needs direct review' },
  modular_heavy_stormtrooper: { implHint: 'wired under label "Modular" (3 src hits); needs direct review' },
  scavenged_stock_jawa_elite: { implHint: 'wired under label "Scavenged Stock" (1 src hit); needs direct review' },
  advanced_weapons_research: { implHint: 'wired under label "Advanced Weapons Research" (11 src hits); needs direct review' },
  force_exhaustion_child: { implHint: 'wired under label "Force Exhaustion" (12 src hits); needs direct review' },
  relentless_pursuit: { implHint: 'NAME DRIFT: label is "Relentless Pursuit" but src uses shortened "Relentless" at src/handlers/combat.js:1711 (3 hits). Needs direct review.' },
  last_wielder_darksaber_bokatan: { implHint: 'wired under label "Darksaber" (30 src hits); needs direct review' },
  personal_combat_shield_bokatan: { implHint: 'wired under label "Personal Combat Shield" (7 src hits); needs direct review' },
};

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
const missing = [];
for (const [key, verdict] of Object.entries(verdicts)) {
  const atom = ledger.atoms.find((a) => a.abilityKey === key);
  if (!atom) { missing.push(key); continue; }
  if (verdict.status) atom.status = verdict.status;
  if (verdict.exemptReason) atom.exemptReason = verdict.exemptReason;
  if (verdict.evidence) atom.evidence = verdict.evidence;
  if (verdict.reviewedBy) atom.reviewedBy = verdict.reviewedBy;
  if (verdict.notes) atom.notes = verdict.notes;
  if (verdict.implHint) atom.implHint = verdict.implHint;
  patched++;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-1: 18 triage-high-risk resolutions',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-1] patched ${patched} atoms`);
if (missing.length) console.error(`MISSING keys (not found in ledger):`, missing);
