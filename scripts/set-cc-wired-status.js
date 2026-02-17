#!/usr/bin/env node
/**
 * Set wiredStatus on every ccEffect entry in data/ability-library.json.
 * Values: "wired" | "partial" | "unwired" | "testready" | "gameready"
 *
 * Heuristic (only for entries that don't already have wiredStatus === "gameready"):
 * - Metadata-only keys: type, label, informational, logMessage, wiredStatus.
 * - If the entry has only those (and no other keys), or only informational+logMessage → unwired.
 * - If the entry has any other key (draw, mpBonus, applyFocus, etc.) → has automation.
 *   - If label (lowercase) contains "manual" or "honor" → partial.
 *   - Else → wired.
 *
 * "testready" = wired + card is in a scenario's cards list in data/test-scenarios.json
 *   where that scenario has status "testready" (ready for Discord testing).
 * "gameready" is never set by this script — it means "tested in Discord via testgame flow";
 * existing gameready entries are left unchanged.
 *
 * Run: node scripts/set-cc-wired-status.js
 * Option: --list — print counts and sample IDs only (no write).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const METADATA_KEYS = new Set(['type', 'label', 'informational', 'logMessage', 'wiredStatus']);
const LIBRARY_PATH = path.join(__dirname, '..', 'data', 'ability-library.json');
const SCENARIOS_PATH = path.join(__dirname, '..', 'data', 'test-scenarios.json');

function getTestreadyCardSet() {
  try {
    const data = JSON.parse(fs.readFileSync(SCENARIOS_PATH, 'utf8'));
    const scenarios = data.scenarios || {};
    const set = new Set();
    for (const s of Object.values(scenarios)) {
      if (s?.status === 'testready' && Array.isArray(s.cards)) {
        for (const c of s.cards) set.add(String(c).trim());
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

function hasAutomation(entry) {
  for (const key of Object.keys(entry)) {
    if (key === 'vpCondition') continue; // used with other keys; alone doesn't trigger resolution
    if (!METADATA_KEYS.has(key)) return true;
  }
  return false;
}

function isPartialByLabel(entry) {
  const label = (entry.label || '').toLowerCase();
  return label.includes('manual') || label.includes('honor');
}

function getWiredStatus(entry) {
  if (entry.type !== 'ccEffect') return null;
  if (!hasAutomation(entry)) return 'unwired';
  return isPartialByLabel(entry) ? 'partial' : 'wired';
}

function main() {
  const listOnly = process.argv.includes('--list');
  const json = fs.readFileSync(LIBRARY_PATH, 'utf8');
  const data = JSON.parse(json);
  const abilities = data.abilities || {};
  const testreadyCards = getTestreadyCardSet();
  let wired = 0, partial = 0, unwired = 0, testready = 0, gameready = 0;
  const byStatus = { wired: [], partial: [], unwired: [], testready: [], gameready: [] };

  for (const [id, entry] of Object.entries(abilities)) {
    if (entry.type !== 'ccEffect') continue;
    if (entry.wiredStatus === 'gameready') {
      gameready++;
      byStatus.gameready.push(id);
      continue; // never overwrite gameready
    }
    let status = getWiredStatus(entry);
    if (status == null) continue;
    if (status === 'wired' && testreadyCards.has(id)) status = 'testready';
    entry.wiredStatus = status;
    if (status === 'wired') { wired++; byStatus.wired.push(id); }
    else if (status === 'partial') { partial++; byStatus.partial.push(id); }
    else if (status === 'testready') { testready++; byStatus.testready.push(id); }
    else { unwired++; byStatus.unwired.push(id); }
  }

  console.log('gameready:', gameready, 'testready:', testready, 'wired:', wired, 'partial:', partial, 'unwired:', unwired);
  if (listOnly) {
    if (byStatus.testready.length) console.log('Sample testready:', byStatus.testready.slice(0, 10).join(', '));
    console.log('Sample unwired:', byStatus.unwired.slice(0, 10).join(', '));
    return;
  }

  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(data), 'utf8');
  console.log('Updated', LIBRARY_PATH);
}

main();
