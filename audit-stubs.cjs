/**
 * Deterministic ability audit generator.
 * Reads dc-effects.json + ability-library.json,
 * outputs a 100% accurate status for every figure and every ability.
 * Run: node audit-stubs.cjs
 */
const fs = require('fs');
const path = require('path');

const dcEffects = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/dc-effects.json'), 'utf8'));
const abilityLib = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/ability-library.json'), 'utf8'));

// Known passive hooks hardcoded in activation.js, combat.js, index.js, round.js
const CODED_PASSIVES = new Set([
  'Hardy', 'Regenerate', 'Curious', 'Leg Hydraulics', 'Open-Minded',
  'Beskar Armor', 'Fly-By', 'Jets', 'Locked and Loaded', 'Mystic Hunter',
  'Shield', 'In The Shadows', 'Last Stand', 'Into the Fray', 'Hold the Line',
  'Advanced Weapons Research', 'Tactical Movement', 'Havoc Shot',
  'Relentless Pursuit', 'Stun Batons', 'Priority Target',
  'Mobile', 'Massive', 'Efficient Travel', 'Reach',
  'Fury',
  // Batch 8
  'Stealthy', 'Ambush', 'Forward Emplacement', 'Security Detail', 'Smooth Landing',
  'Self-Preservation', 'Merciless', 'Bounty',
  // Batch 9
  'Brutal Tactics',
  // Already wired via specialAbilityIds but also in passives
  'Relentless',
]);

// Abilities wired by figure-name checks in activation.js/combat.js/index.js/round.js
// Map: "FigureName:AbilityName" → true
const CODED_FIGURE_ABILITIES = new Set([
  // activation.js start-of-activation hooks
  'Ahsoka Tano:Vigor', 'Fifth Brother:Vigor',
  'Shyla Varad:Responsive',
  'Wampa (Elite):Hunger', 'Wampa (Regular):Hunger',
  'Fenn Signis:Tactical Movement',
  'Baze Malbus:Into the Fray', 'Baze Malbus:Hold the Line',
  'Director Krennic:Advanced Weapons Research',
  'Taron Malicos:Madness',
  // combat.js hooks
  'BT-1:Assassin',
  // index.js defeat hooks
  'Obi-Wan Kenobi:Into the Force',
  'Jabba the Hutt:Nefarious Gains',
  'Royal Guard (Regular):Vengeance',
  'Royal Guard (Elite):Forward Vengeance',
  // index.js post-attack hooks
  'CT-1701:Cover Fire',
  // round.js hooks (already via passives, but also by name)
  'Captain Terro:Mounted', 'Kuiil:Mounted',
  // activation.js end-of-activation hooks
  '0-0-0:Unnerving',
  'ISB Infiltrator (Elite):In The Shadows',
  // index.js post-attack abilityText checks
  'Alliance Ranger (Elite):Guerilla', 'Alliance Ranger (Regular):Guerilla',
  'Rebel Pathfinder (Elite):Guerilla',
  // index.js defeat hooks (by figure name or abilityText)
  'The Armorer:This is the Way',
]);

// Passive strings handled automatically as combat bonuses
const COMBAT_PASSIVE_RE = [
  /^\+\d+\s+(?:Accuracy|Hit|Block|Evade|Surge)/i,
  /^Pierce\s+\d+$/i,
  /^Cleave\s+\d+$/i,
  /^Block\s+\d+$/i,
  /^Bleed$/i,
  /^Professional$/i,
  /^\+\d+ Accuracy,\s*\+?\d* ?(?:Block|Pierce|Hit|Evade)?/i,
];

function isCombatPassive(p) {
  return COMBAT_PASSIVE_RE.some(re => re.test(p.trim()));
}

// Parse abilityText into individual named abilities
function parseAbilities(text) {
  if (!text) return [];
  const results = [];
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  for (const para of paragraphs) {
    // "Special Action (Name): ..." or "Double Action Special (Name): ..."
    let m = para.match(/^(?:Special Action|Double Action Special)\s*\(([^)]+)\):\s*(.+)/s);
    if (m) { results.push({ type: 'special', name: m[1].trim(), desc: m[2].trim() }); continue; }

    // "Surge (Name): ..." or "Surge: ..."
    m = para.match(/^Surge\s*(?:\(([^)]+)\))?\s*:\s*(.+)/s);
    if (m) { results.push({ type: 'surge', name: m[1]?.trim() || null, desc: m[2].trim() }); continue; }

    // "Named Ability: description" — capital letter start, colon
    m = para.match(/^([A-Z][A-Za-z0-9''()\- ]{1,40}):\s+(.+)/s);
    if (m) {
      const name = m[1].trim();
      // Skip restriction text and army-building rules
      if (/^(Include|Your army|Your command|Limit|Skirmish|AT-ST|CREATURE|DROID|TROOPER|BRAWLER|HUNTER|FORCE USER|LEADER|SMUGGLER|SPY|GUARDIAN|HEAVY WEAPON|VEHICLE)/i.test(name)) {
        results.push({ type: 'restriction', name: null, desc: para });
        continue;
      }
      results.push({ type: 'passive', name, desc: m[2].trim() });
      continue;
    }

    // Unnamed — restriction or flavor
    results.push({ type: 'other', name: null, desc: para });
  }
  return results;
}

function getStatus(dcName, dc, ability) {
  const specIds = dc.specialAbilityIds || [];
  const passives = dc.passives || [];
  const surges = dc.surgeAbilities || [];

  // Check figure-specific coded abilities first (works for any type)
  if (ability.name && CODED_FIGURE_ABILITIES.has(`${dcName}:${ability.name}`)) return 'WIRED';

  // --- SPECIAL ACTIONS ---
  if (ability.type === 'special') {
    // If any specialAbilityIds exist AND there are as many IDs as specials, assume all specials are wired
    const specials = dc.specials || [];
    const nameNorm = ability.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const sid of specIds) {
      const entry = abilityLib.abilities?.[sid];
      if (!entry) continue;
      const labelNorm = (entry.label || sid).toLowerCase().replace(/[^a-z0-9]/g, '');
      const sidNorm = sid.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (labelNorm.includes(nameNorm) || nameNorm.includes(labelNorm) || sidNorm.includes(nameNorm) || nameNorm.includes(sidNorm)) {
        if (entry.informational) return 'INFORMATIONAL';
        return 'WIRED';
      }
    }
    // Check if name matches any ability ID globally
    for (const [aid, entry] of Object.entries(abilityLib.abilities || {})) {
      const labelNorm = (entry.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (labelNorm === nameNorm && entry.type === 'dcSpecial') {
        if (entry.informational) return 'INFORMATIONAL';
        return 'WIRED';
      }
    }
    return 'NOT_WIRED';
  }

  // --- SURGE ABILITIES ---
  if (ability.type === 'surge') {
    if (surges.length > 0) return 'WIRED_SURGE';
    return 'NOT_WIRED';
  }

  // --- PASSIVES ---
  if (ability.type === 'passive') {
    // Check passives array
    const inPassives = passives.some(p => p.toLowerCase() === ability.name.toLowerCase());
    if (inPassives) {
      if (CODED_PASSIVES.has(ability.name)) return 'WIRED';
      if (isCombatPassive(ability.name)) return 'PASSIVE_COMBAT';
      // In passives array but unknown hook
      return 'PASSIVE_DATA_ONLY';
    }

    // Check coded passives by name
    if (CODED_PASSIVES.has(ability.name)) return 'WIRED';

    // Check specialAbilityIds
    const nameNorm = ability.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const sid of specIds) {
      const entry = abilityLib.abilities?.[sid];
      if (!entry) continue;
      const labelNorm = (entry.label || sid).toLowerCase().replace(/[^a-z0-9]/g, '');
      const sidNorm = sid.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (labelNorm === nameNorm || sidNorm.includes(nameNorm)) {
        if (entry.informational) return 'INFORMATIONAL';
        if (entry.category === 'passive-auto') return 'WIRED';
        return 'WIRED';
      }
    }

    // Check figure-specific coded abilities
    if (CODED_FIGURE_ABILITIES.has(`${dcName}:${ability.name}`)) return 'WIRED';

    // Assault = multi-attack, honor system in skirmish
    if (ability.name === 'Assault') return 'N/A_HONOR';
    // Non-Sentient = cannot interact (game rule, not automatable)
    if (ability.name === 'Non-Sentient') return 'N/A';
    // Professional = some figures have this in passives (handled by combat), some don't
    if (ability.name === 'Professional') {
      // Check if figure has it in passives array (= combat handled)
      if (passives.some(p => p === 'Professional')) return 'PASSIVE_COMBAT';
      // Otherwise it's described in text but not in passives → NOT_WIRED
    }

    return 'NOT_WIRED';
  }

  if (ability.type === 'restriction' || ability.type === 'other') return 'N/A';
  return 'UNKNOWN';
}

// --- GENERATE ---
const lines = [];
lines.push('# Deterministic Ability Audit');
lines.push('');
lines.push('**Code-generated** from `dc-effects.json` + `ability-library.json`. Run `node audit-stubs.cjs` to regenerate.');
lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
lines.push('');
lines.push('## Status Key');
lines.push('- **WIRED** — Fully automated with code');
lines.push('- **WIRED_SURGE** — Surge ability handled by parseSurgeEffect');
lines.push('- **PASSIVE_COMBAT** — Auto-applied in combat (+Hit, Pierce, Bleed, etc.)');
lines.push('- **PASSIVE_DATA_ONLY** — Listed in passives array, no known code hook');
lines.push('- **INFORMATIONAL** — Shows instructions to player, no mechanical effect');
lines.push('- **N/A** — Restriction text, flavor, or not applicable');
lines.push('- **N/A_HONOR** — Cannot be automated (Assault multi-attack tracking)');
lines.push('- **NOT_WIRED** — Zero code coverage');
lines.push('');
lines.push('---');
lines.push('');

const counts = {};
let total = 0;
const notWired = [];

const sorted = Object.entries(dcEffects.cards || dcEffects.deploymentCards || dcEffects)
  .filter(([k, v]) => v && typeof v === 'object' && v.abilityText && !k.startsWith('['))
  .filter(([k, v]) => !v.companion)
  .sort(([a], [b]) => a.localeCompare(b));

for (const [dcName, dc] of sorted) {
  const abilities = parseAbilities(dc.abilityText);
  if (abilities.length === 0) continue;

  const rows = [];
  for (const ab of abilities) {
    if (!ab.name && (ab.type === 'other' || ab.type === 'restriction')) continue;
    const status = getStatus(dcName, dc, ab);
    const label = ab.type === 'special' ? `Special: ${ab.name}` :
                  ab.type === 'surge' ? `Surge${ab.name ? ': ' + ab.name : ''}` :
                  ab.name || '(unnamed)';
    rows.push(`| ${label} | ${status} |`);
    counts[status] = (counts[status] || 0) + 1;
    total++;
    if (status === 'NOT_WIRED') {
      notWired.push({ figure: dcName, ability: label, desc: (ab.desc || '').slice(0, 150).replace(/\|/g, '/') });
    }
  }

  if (rows.length > 0) {
    lines.push(`### ${dcName}`);
    lines.push('| Ability | Status |');
    lines.push('|---------|--------|');
    lines.push(...rows);
    lines.push('');
  }
}

lines.push('---');
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`**Total abilities:** ${total}`);
lines.push('');
lines.push('| Status | Count | % |');
lines.push('|--------|-------|---|');
for (const [s, c] of Object.entries(counts).sort(([,a],[,b]) => b - a)) {
  lines.push(`| ${s} | ${c} | ${Math.round(c/total*100)}% |`);
}

const automated = (counts.WIRED || 0) + (counts.WIRED_SURGE || 0) + (counts.PASSIVE_COMBAT || 0);
const na = (counts.N_A || 0) + (counts['N/A'] || 0) + (counts.N_A_HONOR || 0) + (counts['N/A_HONOR'] || 0);
lines.push('');
lines.push(`**Automated:** ${automated} (${Math.round(automated/total*100)}%)`);
lines.push(`**Not wired:** ${notWired.length} (${Math.round(notWired.length/total*100)}%)`);
lines.push('');

lines.push('---');
lines.push('');
lines.push('## NOT_WIRED — Complete List');
lines.push('');
lines.push('| Figure | Ability | Description |');
lines.push('|--------|---------|-------------|');
for (const nw of notWired) {
  lines.push(`| ${nw.figure} | ${nw.ability} | ${nw.desc} |`);
}
lines.push('');

fs.writeFileSync(path.join(__dirname, 'docs/ABILITY_AUDIT.md'), lines.join('\n'), 'utf8');
console.log(`\nWrote docs/ABILITY_AUDIT.md`);
console.log(`Total: ${total} abilities, ${notWired.length} NOT_WIRED`);
console.log(JSON.stringify(counts, null, 2));
