import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const stats = JSON.parse(readFileSync(join(__dirname, '../data/dc-stats.json'), 'utf8'));
const effects = JSON.parse(readFileSync(join(__dirname, '../data/dc-effects.json'), 'utf8'));

const mismatches = [];
for (const [name, st] of Object.entries(stats)) {
  const ef = effects[name];
  if (!ef) continue;
  const diffs = [];
  if (ef.speed != null && st.speed != null && ef.speed !== st.speed)
    diffs.push('speed: stats=' + st.speed + ' effects=' + ef.speed);
  if (ef.health != null && st.health != null && ef.health !== st.health)
    diffs.push('health: stats=' + st.health + ' effects=' + ef.health);
  if (ef.cost != null && st.cost != null && ef.cost !== st.cost)
    diffs.push('cost: stats=' + st.cost + ' effects=' + ef.cost);
  if (ef.figures != null && st.figures != null && ef.figures !== st.figures)
    diffs.push('figures: stats=' + st.figures + ' effects=' + ef.figures);
  // Check attack dice count as a basic sanity check
  const statsDice = st.attack?.dice || [];
  const effDice = ef.attack?.dice || [];
  if (statsDice.length > 0 && effDice.length > 0 && statsDice.join(',') !== effDice.join(','))
    diffs.push('dice: stats=[' + statsDice.join(',') + '] effects=[' + effDice.join(',') + ']');
  // Check defense
  const statsDef = Array.isArray(st.defense) ? st.defense.join(',') : st.defense;
  const effDef = Array.isArray(ef.defense) ? ef.defense.join(',') : ef.defense;
  if (statsDef && effDef && statsDef !== effDef)
    diffs.push('defense: stats=' + statsDef + ' effects=' + effDef);

  if (diffs.length) mismatches.push({ name, diffs });
}

if (mismatches.length === 0) {
  console.log('No mismatches found.');
} else {
  console.log('MISMATCHES (' + mismatches.length + '):');
  for (const m of mismatches) {
    console.log('\n' + m.name + ':');
    for (const d of m.diffs) console.log('  ' + d);
  }
}

// Also list dc-stats entries with non-empty specials, for manual review
console.log('\n--- DCs with specials buttons ---');
for (const [name, st] of Object.entries(stats)) {
  if (st.specials && st.specials.length > 0)
    console.log(name + ': [' + st.specials.join(', ') + ']');
}
