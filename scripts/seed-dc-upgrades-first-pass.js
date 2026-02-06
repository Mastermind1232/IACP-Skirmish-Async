/**
 * First pass: seed cost and ability text for DC Skirmish Upgrades (figureless) from deployments-iaspec.json.
 * Merges into existing dc-effects.json; only fills missing or TBD fields.
 * Run: node scripts/seed-dc-upgrades-first-pass.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const dcImagesPath = join(root, 'data', 'dc-images.json');
const dcEffectsPath = join(root, 'data', 'dc-effects.json');
const iaspecPath = join(root, 'scripts', 'deployments-iaspec.json');

const UPGRADE_PATH_MARKER = 'DC Skirmish Upgrades';

function normalize(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/['']/g, "'").trim();
}

const dcImages = JSON.parse(readFileSync(dcImagesPath, 'utf8')).dcImages || {};
const upgradeNames = Object.keys(dcImages).filter((k) => dcImages[k] && dcImages[k].includes(UPGRADE_PATH_MARKER));

let iaspecList = [];
if (existsSync(iaspecPath)) {
  const raw = JSON.parse(readFileSync(iaspecPath, 'utf8'));
  iaspecList = (raw.deployments || []).filter((e) => (e.deployment || e).type === 'upgrade');
}

// Map iaspec name (normalized) -> deployment
const iaspecByNorm = new Map();
for (const entry of iaspecList) {
  const d = entry.deployment || entry;
  const name = (d.name || '').trim();
  const n = normalize(name);
  if (!iaspecByNorm.has(n)) iaspecByNorm.set(n, d);
  const alt = normalize(name.replace(/\s+/g, ''));
  if (!iaspecByNorm.has(alt)) iaspecByNorm.set(alt, d);
}

function findIaspec(ourBracketName) {
  const bare = ourBracketName.replace(/^\[|\]$/g, '').trim();
  const n = normalize(bare);
  if (iaspecByNorm.has(n)) return iaspecByNorm.get(n);
  const noSpaces = normalize(bare.replace(/\s+/g, ''));
  if (iaspecByNorm.has(noSpaces)) return iaspecByNorm.get(noSpaces);
  for (const [key, d] of iaspecByNorm) {
    if (key.includes(n) || n.includes(key)) return d;
  }
  return null;
}

function buildAbilityFromIaspec(d) {
  const parts = ['Upgrade.'];
  if (d.restrictions && d.restrictions.length) {
    const traits = d.restrictions.map((r) => String(r).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
    parts.push(` Restrictions: ${traits}.`);
  } else {
    parts.push(' (see card).');
  }
  return parts.join('');
}

const effects = JSON.parse(readFileSync(dcEffectsPath, 'utf8'));
const cards = effects.cards || {};

let updatedCost = 0;
let updatedAbility = 0;

for (const name of upgradeNames) {
  const existing = cards[name] || {};
  const iaspec = findIaspec(name);

  let cost = existing.cost;
  if (cost === undefined || cost === null) {
    cost = iaspec && iaspec.deploymentCost != null ? iaspec.deploymentCost : 0;
    if (iaspec || cost !== 0) updatedCost++;
  }

  let abilityText = existing.abilityText || '';
  const isTbd = !abilityText || /TBD|see card\)\.?$/i.test(abilityText.trim());
  if (isTbd && iaspec) {
    abilityText = buildAbilityFromIaspec(iaspec);
    updatedAbility++;
  } else if (!abilityText) {
    abilityText = 'Upgrade (see card).';
    updatedAbility++;
  }

  cards[name] = {
    ...existing,
    abilityText: abilityText.trim(),
    cost,
    keywords: existing.keywords != null ? existing.keywords : [],
  };
  if (existing.isIACPVariant !== undefined) cards[name].isIACPVariant = existing.isIACPVariant;
}

effects.cards = cards;
effects.source = effects.source || 'DC Effect Editor';
writeFileSync(dcEffectsPath, JSON.stringify(effects, null, 2), 'utf8');
console.log('Seed complete. Upgrade cards:', upgradeNames.length);
console.log('  Costs filled/updated:', updatedCost);
console.log('  Ability text filled/updated:', updatedAbility);
console.log('  Wrote data/dc-effects.json');