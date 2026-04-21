#!/usr/bin/env node
/**
 * Reconcile orphan library entries — abilities registered in
 * `data/ability-library.json` that are NOT referenced by any DC card's
 * `specialAbilityIds` / `surgeAbilities` and are NOT a CC name.
 *
 * For each orphan we compute:
 *   - labelHits: count of `"<label>"` quoted-literal hits across src/
 *   - siblingSlug: another library key that SHARES the same label AND is
 *                  referenced by a DC card (strong signal of a duplicate)
 *   - nearestDcOwner: DC card (if any) whose `specialAbilityIds` contains a
 *                     slug that shares a stem with the orphan (fuzzy)
 *   - verdict: one of
 *       'dup-alt-slug'   — sibling slug exists and is owned → orphan is cruft
 *       'wired-by-label' — label has ≥1 src hit but no sibling slug owner
 *       'dead-data'      — no src label hits AND no sibling → remove from lib
 *
 * Outputs `docs/dc-cc-orphan-reconciliation.json` — a sorted report you can
 * diff after each data-cleanup pass.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LIB_PATH = resolve(ROOT, 'data/ability-library.json');
const DC_PATH = resolve(ROOT, 'data/dc-effects.json');
const CC_PATH = resolve(ROOT, 'data/cc-effects.json');
const SRC_DIR = resolve(ROOT, 'src');
const OUT_PATH = resolve(ROOT, 'docs/dc-cc-orphan-reconciliation.json');

function* walkJs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkJs(p);
    else if (p.endsWith('.js')) yield p;
  }
}
function loadFiles(dir) {
  const out = [];
  for (const p of walkJs(dir)) out.push({ path: p, src: readFileSync(p, 'utf8') });
  return out;
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8')).abilities;
const dcCards = JSON.parse(readFileSync(DC_PATH, 'utf8')).cards;
const ccCards = JSON.parse(readFileSync(CC_PATH, 'utf8')).cards;
const ccNames = new Set(Object.keys(ccCards));
const srcFiles = loadFiles(SRC_DIR);

// Reverse map: slug → [owners].
const ownersBySlug = new Map();
function addOwner(slug, owner) {
  if (!ownersBySlug.has(slug)) ownersBySlug.set(slug, []);
  ownersBySlug.get(slug).push(owner);
}
for (const [name, c] of Object.entries(dcCards)) {
  for (const id of c.specialAbilityIds || []) addOwner(id, { kind: 'spec', dc: name });
  for (const id of c.surgeAbilities || []) addOwner(id, { kind: 'surge', dc: name });
}
for (const [ccName, card] of Object.entries(ccCards)) {
  if (card.abilityId) addOwner(card.abilityId, { kind: 'cc', name: ccName });
  // CC name → library-key-is-card-name path is handled by ccNames filter below.
}

// Index: DC cards that list a given label in their passives[] array. This is
// the third dispatch path — passive abilities are matched by literal name
// against `effect.passives.includes('<Ability Name>')` at the call site.
const passiveOwnersByLabel = new Map();
for (const [name, c] of Object.entries(dcCards)) {
  for (const p of c.passives || []) {
    if (!passiveOwnersByLabel.has(p)) passiveOwnersByLabel.set(p, []);
    passiveOwnersByLabel.get(p).push(name);
  }
}

// Label → [slugs with that label]. Multiple slugs per label means variant/duplicate.
const slugsByLabel = new Map();
for (const [slug, entry] of Object.entries(lib)) {
  const lbl = entry.label;
  if (!lbl) continue;
  if (!slugsByLabel.has(lbl)) slugsByLabel.set(lbl, []);
  slugsByLabel.get(lbl).push(slug);
}

function countInSrc(needles) {
  // Match quoted literal OR word-boundary identifier. Catches both
  // `"Force Exhaustion"` dispatch strings AND bare `force_exhaustion_yes_`
  // button-prefix identifiers.
  const patterns = needles
    .filter(Boolean)
    .map((n) => new RegExp(`(?:['"\`]${escRe(n)}['"\`]|\\b${escRe(n)}\\b)`, 'g'));
  let total = 0;
  const files = [];
  for (const f of srcFiles) {
    let hits = 0;
    for (const re of patterns) { const m = f.src.match(re); if (m) hits += m.length; }
    if (hits > 0) { total += hits; files.push(relative(ROOT, f.path)); }
  }
  return { total, files };
}

// Fuzzy stem: strip trailing `_<suffix>` tails to find the core ability.
function stem(slug) {
  return String(slug).replace(/_(elite|reg|regular|bokatan|gar_saxon|child|iden|dio|aphra|terro|death_trooper_elite|death_trooper_reg|heavy_stormtrooper|jawa_elite|ewok_elite|tauntaun|trandoshan|wookiee_reg|shoretrooper_reg|jet_trooper|lothcat|ct1701|fennec|rebel_trooper_elite|ewok)$/i, '');
}

const report = [];
for (const [slug, entry] of Object.entries(lib)) {
  if (ownersBySlug.has(slug)) continue;              // not orphan
  if (ccNames.has(slug)) continue;                   // CC name → owned by CC side

  const label = entry.label || null;
  // Check BOTH the slug (as button-prefix identifier) AND the label (as
  // quoted dispatch string). Also try the stem of the slug as an identifier
  // — catches `force_exhaustion_yes_` when slug is `force_exhaustion_child`.
  const slugStem = stem(slug);
  const labelCheck = countInSrc([label, slug, slugStem !== slug ? slugStem : null]);

  // Look for a sibling slug with the same label that IS owned.
  const siblings = (slugsByLabel.get(label) || []).filter((s) => s !== slug);
  const ownedSibling = siblings.find((s) => ownersBySlug.has(s));

  // Fuzzy: look for any DC whose specialAbilityIds share a stem with this one.
  const s = stem(slug);
  let nearestDcOwner = null;
  for (const [dcName, c] of Object.entries(dcCards)) {
    for (const id of [...(c.specialAbilityIds || []), ...(c.surgeAbilities || [])]) {
      if (id !== slug && (stem(id) === s || (s.length > 4 && id.startsWith(s)))) {
        nearestDcOwner = { dc: dcName, slug: id };
        break;
      }
    }
    if (nearestDcOwner) break;
  }

  // A DC card whose passives[] contains the orphan's label → the orphan is
  // effectively cruft (the real dispatch is by passive-string).
  const passiveOwners = label ? (passiveOwnersByLabel.get(label) || []) : [];

  let verdict;
  if (ownedSibling) verdict = 'dup-alt-slug';
  else if (passiveOwners.length > 0) verdict = 'wired-by-passive-string';
  else if (labelCheck.total > 0) verdict = 'wired-by-label';
  else verdict = 'dead-data';

  report.push({
    slug,
    type: entry.type,
    label,
    labelHits: labelCheck.total,
    labelHitFiles: labelCheck.files.slice(0, 5),
    siblings,
    ownedSibling: ownedSibling || null,
    passiveOwners,
    nearestDcOwner,
    verdict,
  });
}

// Sort: dead-data first (easiest to prune), then dup, then wired-by-label.
const order = { 'dead-data': 0, 'dup-alt-slug': 1, 'wired-by-passive-string': 2, 'wired-by-label': 3 };
report.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.slug.localeCompare(b.slug));

const byVerdict = report.reduce((m, r) => { m[r.verdict] = (m[r.verdict] || 0) + 1; return m; }, {});

const out = {
  _meta: {
    generatedAt: new Date().toISOString(),
    totalOrphans: report.length,
    byVerdict,
  },
  orphans: report,
};
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log(`[reconcile-orphans] ${report.length} orphan library entries`);
console.log('  by verdict:', byVerdict);
console.log(`  wrote ${relative(ROOT, OUT_PATH)}`);
