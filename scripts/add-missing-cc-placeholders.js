#!/usr/bin/env node
/**
 * Add placeholder entries for command cards in cc-names.json that are not yet in cc-effects.json.
 * Run: node scripts/add-missing-cc-placeholders.js
 * Preserves existing cc-effects entries; adds placeholders for missing cards.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ccNamesPath = join(root, 'data', 'cc-names.json');
const ccEffectsPath = join(root, 'data', 'cc-effects.json');

const ccNames = JSON.parse(readFileSync(ccNamesPath, 'utf8'));
const ccEffects = JSON.parse(readFileSync(ccEffectsPath, 'utf8'));

const allNames = ccNames.cards || [];
const existing = ccEffects.cards || {};
const placeholder = {
  cost: null,
  playableBy: 'Any Figure',
  timing: 'other',
  effect: '',
  effectType: 'manual',
};

let added = 0;
for (const name of allNames) {
  if (!existing[name]) {
    existing[name] = { ...placeholder };
    added++;
  }
}

ccEffects.cards = existing;
writeFileSync(ccEffectsPath, JSON.stringify(ccEffects, null, 2), 'utf8');
console.log(`Added ${added} placeholder entries. Total cards: ${Object.keys(existing).length}`);