import { parseVsav } from '../src/vsav-parser.js';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Minimal inline normalization — we just need to resolve unclassified cards
// and normalize names. Load dc-effects and cc-effects directly.
const dcEffects = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'dc-effects.json'), 'utf-8'));
const ccEffects = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'cc-effects.json'), 'utf-8'));
const dcNames = new Set(Object.keys(dcEffects.cards || dcEffects));
const ccNames = new Set(Object.keys(ccEffects.cards || {}));

function resolveName(name, knownSet) {
  if (knownSet.has(name)) return name;
  // Case-insensitive
  for (const k of knownSet) {
    if (k.toLowerCase() === name.toLowerCase()) return k;
  }
  // Bracket fallback for upgrades
  if (!name.startsWith('[') && knownSet.has(`[${name}]`)) return `[${name}]`;
  // Regular/Elite fallback
  if (knownSet.has(`${name} (Regular)`)) return `${name} (Regular)`;
  if (knownSet.has(`${name} (Elite)`)) return `${name} (Elite)`;
  return name;
}

const dir = '/Users/adammeehan/Downloads/Test Cases for Corndog';
const files = readdirSync(dir);
const decks = [];
for (const f of files.sort()) {
  const content = readFileSync(join(dir, f), 'utf-8');
  const parsed = parseVsav(content);
  if (!parsed || (parsed.dcList.length === 0 && parsed.ccList.length === 0)) {
    console.error('FAILED:', f);
    continue;
  }
  const name = f.replace(/\.vsav$/i, '').replace(/^IA List \[[^\]]+\] - /, '');

  // Classify unclassified
  const dcList = [...parsed.dcList];
  const ccList = [...parsed.ccList];
  for (const u of (parsed.unclassified || [])) {
    const resolvedDc = resolveName(u, dcNames);
    const resolvedCc = resolveName(u, ccNames);
    if (dcNames.has(resolvedDc)) {
      dcList.push(resolvedDc);
    } else if (ccNames.has(resolvedCc)) {
      ccList.push(resolvedCc);
    } else {
      console.error(`  UNRESOLVED in ${f}: ${u}`);
      dcList.push(u); // put in DC so validation catches it
    }
  }

  // Resolve final names
  const finalDcList = dcList.map(n => resolveName(n, dcNames));
  const finalCcList = ccList.map(n => resolveName(n, ccNames));

  decks.push({ name, dcList: finalDcList, ccList: finalCcList });
}
const outPath = join(import.meta.dirname, '..', 'data', 'destruct-test-decks.json');
writeFileSync(outPath, JSON.stringify(decks, null, 2) + '\n');
console.log(`Wrote ${decks.length} decks to ${outPath}`);
