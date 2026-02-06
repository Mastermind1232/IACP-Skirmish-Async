/**
 * First pass: seed dc-effects.json for ALL 226 DCs using dc-names, dc-keywords,
 * dc-stats, and iaspec deployments (kingargyle/iaskirmish-data).
 * Run: node scripts/seed-dc-effects-full.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const namesPath = join(root, 'data', 'dc-names.json');
const keywordsPath = join(root, 'data', 'dc-keywords.json');
const statsPath = join(root, 'data', 'dc-stats.json');
const iaspecPath = join(root, 'scripts', 'deployments-iaspec.json');
const outPath = join(root, 'data', 'dc-effects.json');

const namesData = JSON.parse(readFileSync(namesPath, 'utf8'));
const keywordsData = JSON.parse(readFileSync(keywordsPath, 'utf8'));
const statsData = JSON.parse(readFileSync(statsPath, 'utf8'));

const names = namesData.cards || namesData;
const kwMap = keywordsData.keywords || {};
const dcStats = statsData.dcStats || {};

let iaspecList = [];
if (existsSync(iaspecPath)) {
  const raw = JSON.parse(readFileSync(iaspecPath, 'utf8'));
  iaspecList = raw.deployments || [];
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function keyFromOurName(ourName) {
  const n = ourName.replace(/^\[|\]$/g, '').trim();
  const base = n.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const elite = /\s*\(Elite\)\s*$/i.test(n);
  const reg = /\s*\(Regular\)\s*$/i.test(n);
  const suffix = elite ? '_elite' : reg ? '_reg' : '';
  return normalize(base) + suffix;
}
function keyFromIaspec(d) {
  let name = (d.name || '').trim();
  name = name.replace(/^\s*Elite\s+/i, '').trim(); // "Elite Snowtrooper" -> "Snowtrooper"
  const base = name.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const elite = d.elite === 1;
  const suffix = elite ? '_elite' : '_reg';
  return normalize(base) + suffix;
}

const iaspecByKey = new Map();
const iaspecByName = new Map();
for (const entry of iaspecList) {
  const d = entry.deployment || entry;
  if (d.type === 'upgrade' && !d.health && !d.attack) continue; // skip pure upgrades for figure text
  const k = keyFromIaspec(d);
  if (!iaspecByKey.has(k)) iaspecByKey.set(k, d);
  let nameOnly = (d.name || '').replace(/^\s*Elite\s+/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  nameOnly = normalize(nameOnly);
  if (!iaspecByName.has(nameOnly)) iaspecByName.set(nameOnly, d);
  if (d.unique === 1) {
    const q = normalize(d.name || '');
    if (!iaspecByName.has(q)) iaspecByName.set(q, d);
  }
}

const ourNameToIaspecAlias = {
  'Onar Koma': 'onar komar',
  'C1-10P "Chopper"': 'c1-10p',
  'C-3P0': 'c-3p0',
};
function findIaspec(ourName) {
  const alias = ourNameToIaspecAlias[ourName];
  if (alias) {
    const n = normalize(alias);
    for (const [key, d] of iaspecByKey) {
      if (normalize((d.name || '').toLowerCase()) === n || key.replace(/_elite|_reg$/, '') === n) return d;
    }
    if (iaspecByName.has(n)) return iaspecByName.get(n);
  }
  const k = keyFromOurName(ourName);
  if (iaspecByKey.has(k)) return iaspecByKey.get(k);
  const bare = ourName.replace(/^\[|\]$/g, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const n = normalize(bare);
  if (iaspecByName.has(n)) return iaspecByName.get(n);
  for (const [key, d] of iaspecByKey) {
    const base = key.replace(/_elite|_reg$/, '');
    if (base === n || n === base) return d;
  }
  return null;
}

function formatAbilities(abilities) {
  if (!abilities || !abilities.length) return '';
  const parts = [];
  for (const a of abilities) {
    const group = a.ability?.group || a.group || [];
    const tokens = group.map((g) => {
      const type = (g.type === 'surge' || g.type === 'doublesurge') ? 'Surge' : '';
          const affect = (g.affect || '').toString();
          const amt = g.affectAmount != null && g.affectAmount !== 0 ? ` ${g.affectAmount}` : '';
          if (affect === 'massive') return 'MASSIVE';
          if (affect === 'mobile') return 'MOBILE';
          if (affect === 'reach') return 'Reach';
          if (affect === 'block') return `Block ${g.affectAmount || 1}`;
          if (type) return `${type}: ${affect}${amt}`;
          return `${affect}${amt}`;
        }).filter(Boolean);
    if (tokens.length) parts.push(tokens.join('; '));
  }
  return parts.join('. ');
}

function buildAbilityTextFromIaspec(d) {
  const lines = [];
  if (d.restrictions && d.restrictions.length) {
    const traits = d.restrictions.map((r) => String(r).toUpperCase()).join(', ');
    lines.push(`Traits: ${traits}.`);
  }
  if (d.attack && d.attack.type !== 'none') {
    const dice = (d.attack.dice || []).join(', ');
    const type = d.attack.type === 'melee' ? 'Melee' : 'Range';
    lines.push(`Attack (${type}): ${dice || '—'}.`);
  }
  if (d.defense && d.defense.length && d.defense[0] !== 'none') {
    lines.push(`Defense: ${(d.defense || []).join(', ')}.`);
  }
  const ab = formatAbilities(d.abilities);
  if (ab) lines.push(ab);
  return lines.join(' ');
}

function findStats(name) {
  if (dcStats[name]) return dcStats[name];
  const lower = name.toLowerCase();
  const key = Object.keys(dcStats).find((k) => k.toLowerCase() === lower);
  return key ? dcStats[key] : null;
}

function statsSummary(s) {
  const parts = [];
  if (s.cost != null) parts.push(`Cost ${s.cost}`);
  if (s.health != null) parts.push(`Health ${s.health}`);
  if (s.speed != null) parts.push(`Speed ${s.speed}`);
  if (s.specials && s.specials.length) parts.push(`Specials: ${s.specials.join(', ')}`);
  if (s.attack) {
    const dice = (s.attack.dice || []).join('+');
    const r = s.attack.range;
    const rangeStr = r && r.length === 2 ? `range ${r[0]}-${r[1]}` : '';
    parts.push(`Attack: ${dice || '—'} ${rangeStr}`.trim());
  }
  if (s.defense) parts.push(`Defense: ${s.defense}`);
  return parts.join('. ');
}

const cards = {};
let fromIaspec = 0;
let fromStats = 0;
let fromKeywords = 0;

for (const name of names) {
  const keywords = Array.isArray(kwMap[name]) ? kwMap[name] : (kwMap[name] ? [kwMap[name]] : []);
  if (keywords.length) fromKeywords++;

  let abilityText = '';
  const iaspec = findIaspec(name);
  if (iaspec) {
    abilityText = buildAbilityTextFromIaspec(iaspec);
    if (abilityText) fromIaspec++;
  }
  if (!abilityText) {
    const stats = findStats(name.replace(/^\[|\]$/g, '').trim());
    if (stats) {
      abilityText = statsSummary(stats);
      if (abilityText) fromStats++;
    }
  }
  if (!abilityText && name.startsWith('[')) {
    const iaspecUpgrade = iaspecList.find((e) => {
      const d = e.deployment || e;
      const theirName = (d.name || '').trim();
      const ourBare = name.replace(/^\[|\]$/g, '').trim();
      return normalize(theirName) === normalize(ourBare);
    });
    if (iaspecUpgrade) {
      const d = iaspecUpgrade.deployment || iaspecUpgrade;
      abilityText = (d.restrictions && d.restrictions.length)
        ? `Upgrade. Restrictions: ${d.restrictions.join(', ')}.`
        : 'Upgrade (see card).';
      if (abilityText) fromIaspec++;
    }
  }
  if (!abilityText) {
    abilityText = 'TBD (IACP – verify from card).';
  }

  cards[name] = {
    abilityText: abilityText || '',
    keywords,
  };
}

const out = {
  source: 'DC Effect Editor (seeded by scripts/seed-dc-effects-full.js; iaspec + dc-keywords + dc-stats)',
  cards,
};
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`Wrote ${Object.keys(cards).length} DC entries to data/dc-effects.json`);
console.log(`  From iaspec: ${fromIaspec}`);
console.log(`  From dc-stats only: ${fromStats}`);
console.log(`  With keywords: ${fromKeywords}`);
console.log(`  With non-empty abilityText: ${Object.values(cards).filter((c) => c.abilityText && c.abilityText.length).length}`);
