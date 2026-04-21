#!/usr/bin/env node
/**
 * library-stub-audit.mjs
 *
 * Scans data/ability-library.json for wiredStatus:"wired" entries that
 * have neither (a) structural behavior fields nor (b) code-path references
 * to the key or label in src/. Each such entry is a suspected stub — the
 * library says it is wired, but nothing resolves it.
 *
 * Output: JSON report to stdout (and --out <path> if provided) with one
 * record per suspected stub: { key, label, type, reason, probeHints }.
 *
 * Triage buckets:
 *   STRUCTURAL_FIELDS  — library shape wiring exists (fixedAreaEffect,
 *                        surgeCost, nextAttacksBonusHits, etc.)
 *   CODE_REFERENCED    — ability key or label matched in src/ code
 *   EXEMPT_IN_LEDGER   — dc-cc-ledger marks this atom exempt
 *   SUSPECTED_STUB     — neither; likely unwired despite claim
 *   UNWIRED            — wiredStatus !== 'wired' (reported separately)
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Fields that do NOT count as behavioral wiring on their own. Anything
// outside this set is considered a structural field that indicates
// library-shape wiring.
const ADMIN_FIELDS = new Set([
  'type',
  'label',
  'description',
  'wiredStatus',
  'category',
  'trigger',
  'oncePer',
  'logMessage',
  'noOpMessage',
  'timing',
  // `informational: true` IS consumed by resolveAbility at
  // src/game/abilities.js:235/1699 to emit manual-resolution logs — it's
  // structural dispatch, not admin metadata. Keep it OUT of this set.
  // `freeAction` affects cost but not dispatch — on its own it is not
  // enough to say the ability's effect is implemented.
  'freeAction',
]);

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(p, acc);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      acc.push(p);
    }
  }
  return acc;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasStructuralFields(entry) {
  const structural = Object.keys(entry).filter((f) => !ADMIN_FIELDS.has(f));
  return structural;
}

function keyPatternVariants(key) {
  // Library keys are snake_case; source often uses camelCase or kebab.
  const variants = new Set([key]);
  variants.add(key.replace(/_/g, '-'));
  // camelCase
  const camel = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  variants.add(camel);
  // Title/Startcase variant
  variants.add(key.replace(/_/g, ' '));
  return [...variants];
}

function labelVariants(label) {
  if (!label) return [];
  return [label, label.toLowerCase()];
}

function buildMatcher(key, label) {
  const needles = [
    ...keyPatternVariants(key),
    ...labelVariants(label),
  ].filter((s) => s && s.length >= 3);
  return needles;
}

async function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  const outPath = outFlag >= 0 ? args[outFlag + 1] : null;
  const onlyBucket = args.indexOf('--bucket') >= 0 ? args[args.indexOf('--bucket') + 1] : null;

  const lib = JSON.parse(
    await readFile(path.join(ROOT, 'data/ability-library.json'), 'utf8'),
  );
  const abilities = lib.abilities || {};

  // Load ledger to read exemption status.
  let ledger = null;
  try {
    ledger = JSON.parse(
      await readFile(path.join(ROOT, 'docs/dc-cc-ledger.json'), 'utf8'),
    );
  } catch {
    ledger = null;
  }
  const exemptKeys = new Set();
  const atomsByKey = new Map();
  if (ledger?.atoms) {
    for (const atom of ledger.atoms) {
      const k = atom.abilityKey || atom.libraryKey;
      if (k) {
        atomsByKey.set(k, atom);
        if (atom.status === 'exempt') exemptKeys.add(k);
      }
    }
  }

  // Load all source files once.
  const srcFiles = await walk(path.join(ROOT, 'src'));
  const srcContents = new Map();
  for (const f of srcFiles) {
    srcContents.set(f, await readFile(f, 'utf8'));
  }

  const buckets = {
    STRUCTURAL_FIELDS: [],
    CODE_REFERENCED: [],
    EXEMPT_IN_LEDGER: [],
    SUSPECTED_STUB: [],
    UNWIRED: [],
  };

  for (const key of Object.keys(abilities)) {
    const entry = abilities[key];
    const record = {
      key,
      label: entry.label || null,
      type: entry.type || null,
      wiredStatus: entry.wiredStatus || null,
      description: entry.description || null,
    };

    if (entry.wiredStatus !== 'wired') {
      buckets.UNWIRED.push(record);
      continue;
    }

    if (exemptKeys.has(key)) {
      buckets.EXEMPT_IN_LEDGER.push({
        ...record,
        ledgerAtomId: atomsByKey.get(key)?.atomId || null,
        ledgerReason: atomsByKey.get(key)?.reason || null,
      });
      continue;
    }

    const structural = hasStructuralFields(entry);
    if (structural.length > 0) {
      buckets.STRUCTURAL_FIELDS.push({ ...record, structuralFields: structural });
      continue;
    }

    const needles = buildMatcher(key, entry.label);
    const hits = [];
    for (const [file, txt] of srcContents.entries()) {
      for (const needle of needles) {
        const rx = new RegExp(escapeRegex(needle), 'i');
        if (rx.test(txt)) {
          hits.push({ file: path.relative(ROOT, file), needle });
          break;
        }
      }
      if (hits.length >= 5) break;
    }

    if (hits.length > 0) {
      buckets.CODE_REFERENCED.push({ ...record, matches: hits });
    } else {
      buckets.SUSPECTED_STUB.push({
        ...record,
        probeHints: {
          noStructuralFields: true,
          noCodeMatches: true,
          tryKey: key,
          tryLabel: entry.label,
          resolverHint: entry.type === 'surge' ? 'surge resolver by key' : 'resolveAbility(key, ...)',
        },
      });
    }
  }

  const summary = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.length]),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    totalAbilities: Object.keys(abilities).length,
    summary,
    buckets: onlyBucket ? { [onlyBucket]: buckets[onlyBucket] || [] } : buckets,
  };

  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    await writeFile(outPath, json);
    console.error(`wrote ${outPath}`);
  }
  console.log(json);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
