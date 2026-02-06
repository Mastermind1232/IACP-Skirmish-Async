/**
 * First pass: seed dc-effects.json for all DCs from dc-names, dc-keywords, and dc-stats.
 * Run: node scripts/seed-dc-effects.js
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const namesPath = join(root, 'data', 'dc-names.json');
const keywordsPath = join(root, 'data', 'dc-keywords.json');
const statsPath = join(root, 'data', 'dc-stats.json');
const outPath = join(root, 'data', 'dc-effects.json');

const namesData = JSON.parse(readFileSync(namesPath, 'utf8'));
const keywordsData = JSON.parse(readFileSync(keywordsPath, 'utf8'));
const statsData = JSON.parse(readFileSync(statsPath, 'utf8'));

const names = namesData.cards || namesData;
const kwMap = keywordsData.keywords || {};
const dcStats = statsData.dcStats || {};

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
  if (s.figures != null && s.figures > 0) parts.push(`${s.figures} figure(s)`);
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
for (const name of names) {
  const keywords = Array.isArray(kwMap[name]) ? kwMap[name] : (kwMap[name] ? [kwMap[name]] : []);
  const stats = findStats(name);
  const abilityText = stats ? statsSummary(stats) : '';
  cards[name] = {
    abilityText: abilityText || '',
    keywords,
  };
}

const out = {
  source: 'DC Effect Editor (seeded by scripts/seed-dc-effects.js)',
  cards,
};
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`Wrote ${Object.keys(cards).length} DC entries to data/dc-effects.json`);
console.log(`  With keywords: ${Object.values(cards).filter((c) => c.keywords && c.keywords.length).length}`);
console.log(`  With stats summary: ${Object.values(cards).filter((c) => c.abilityText && c.abilityText.length).length}`);
