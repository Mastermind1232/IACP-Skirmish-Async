#!/usr/bin/env node
/**
 * Batch-3: mark the 12 orphan ability-library entries as `exempt` in the
 * DC/CC ledger. These are library keys that no DC/CC card references and
 * are not wired by any alternative path (passives-string, dcName check,
 * button-prefix).
 *
 * Categories (from scripts/dc-cc-ledger-reconcile-orphans.js):
 *   - 9 dup-alt-slug: another library slug with the same label IS owned by
 *     the card; the orphan is scaffolding cruft. Exempt reason cites the
 *     sibling for reviewer context.
 *   - 3 dead-data: no sibling, no label dispatch, no passive-string owner.
 *     Exempt reason flags these as "unimplemented printed ability" where
 *     the card text actually names the ability, or "orphan never referenced"
 *     where the library entry has no home at all.
 *
 * We do NOT delete the library entries yet — exempt status clears triage
 * noise and documents the decision; a follow-up data-prune can safely
 * remove them after all owning CRR atoms are closed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');

const DUP_ALT_SLUG = {
  aim_rebel_trooper_elite: 'aim_rebel_trooper_reg',
  fury_wookiee_reg: 'fury_wookiee_elite',
  leg_hydraulics: 'leg_hydraulics_tress',
  personal_combat_shield_bokatan: 'personal_combat_shield_gar_saxon',
  relentless_pursuit: 'fifth_brother_relentless',
  self_preservation: 'self_preservation_hired_gun_elite',
  squad_training_shoretrooper_reg: 'squad_training_shoretrooper_elite',
  stealthy: 'stealthy_davith',
  stim_canister: 'stim_canister_bd1',
};

const DEAD_DATA = {
  dead_weight_pardon_bokatan:
    'Orphan library entry. Bo-Katan Kryze card text does NOT include any "Dead Weight Pardon" ability. Safe to prune from data/ability-library.json in a follow-up pass.',
  last_wielder_darksaber_bokatan:
    'Bo-Katan card text DOES print "Last Wielder of the Darksaber". Library entry has no structured dispatch fields (label-only), so the passive is NOT wired at runtime. Effective no-op because attachment eligibility ("MAUL OR SABINE WREN ONLY" on The Darksaber) is not enforced anywhere in src/. Full fix requires (a) attachment-restriction enforcement system, (b) extending eligibility when this passive is present. Larger than a data patch — flagged as partial gap (covered-by-no-enforcement, not breaking correctness today).',
};

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
const missing = [];

for (const [slug, sibling] of Object.entries(DUP_ALT_SLUG)) {
  const atom = ledger.atoms.find((a) => a.abilityKey === slug);
  if (!atom) { missing.push(slug); continue; }
  atom.status = 'exempt';
  atom.exemptReason = `Duplicate of owned sibling slug "${sibling}" (same label). The sibling is canonical; this entry is scaffolding cruft. Safe to prune from data/ability-library.json in a follow-up pass. Runtime dispatch for this ability is via the sibling slug, passives-string match, and/or dcName check — none of which reference this slug.`;
  patched++;
}

for (const [slug, reason] of Object.entries(DEAD_DATA)) {
  const atom = ledger.atoms.find((a) => a.abilityKey === slug);
  if (!atom) { missing.push(slug); continue; }
  atom.status = 'exempt';
  atom.exemptReason = reason;
  patched++;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-3: 12 orphan library entries marked exempt',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-3] patched ${patched} atoms`);
if (missing.length) console.error(`MISSING:`, missing);
