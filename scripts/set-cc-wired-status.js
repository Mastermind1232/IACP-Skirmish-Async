#!/usr/bin/env node
/**
 * Set wiredStatus on every ccEffect entry in data/ability-library.json.
 * Values: "wired" | "partial" | "unwired"
 *
 * Heuristic:
 * - Metadata-only keys: type, label, informational, logMessage.
 * - If the entry has only those (and no other keys), or only informational+logMessage → unwired.
 * - If the entry has any other key (draw, mpBonus, applyFocus, etc.) → has automation.
 *   - If label (lowercase) contains "manual" or "honor" → partial.
 *   - Else → wired.
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
  let wired = 0, partial = 0, unwired = 0;
  const byStatus = { wired: [], partial: [], unwired: [] };

  for (const [id, entry] of Object.entries(abilities)) {
    if (entry.type !== 'ccEffect') continue;
    const status = getWiredStatus(entry);
    if (status == null) continue;
    entry.wiredStatus = status;
    if (status === 'wired') { wired++; byStatus.wired.push(id); }
    else if (status === 'partial') { partial++; byStatus.partial.push(id); }
    else { unwired++; byStatus.unwired.push(id); }
  }

  console.log('wired:', wired, 'partial:', partial, 'unwired:', unwired);
  if (listOnly) {
    console.log('Sample unwired:', byStatus.unwired.slice(0, 10).join(', '));
    return;
  }

  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(data), 'utf8');
  console.log('Updated', LIBRARY_PATH);
}

main();
