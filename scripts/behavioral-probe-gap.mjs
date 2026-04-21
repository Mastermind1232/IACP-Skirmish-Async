#!/usr/bin/env node
/**
 * behavioral-probe-gap.mjs
 *
 * Enumerates the 675 currently-covered DC/CC ledger atoms and classifies
 * each by its actual coverage kind (structural-only vs. behavioral).
 * Used to drive the Phase 2 probe-grind plan.
 *
 * Heuristic: an atom has "behavioral coverage" if
 *  (a) its triage.testRefs map contains an oracle/probe file whose
 *      contents invoke resolveAbility() with the atom's abilityKey or
 *      label, OR
 *  (b) there exists an oracle test file that invokes resolveAbility with
 *      that key/label and makes assertions on dcHealthState/game mutation.
 * Otherwise the atom is structural-only.
 *
 * Output: prioritized list { abilityKey, label, type, riskTier, kind,
 * recommendedProbeTarget }. STDOUT JSON; --out writes to file.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

async function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  const outPath = outFlag >= 0 ? args[outFlag + 1] : null;
  const riskOnly = args.indexOf('--risk') >= 0 ? args[args.indexOf('--risk') + 1] : null;

  const ledger = JSON.parse(
    await readFile(path.join(ROOT, 'docs/dc-cc-ledger.json'), 'utf8'),
  );
  const covered = (ledger.atoms || []).filter((a) => a.status === 'covered');

  // Pre-scan oracle test files for resolveAbility invocations + assertions.
  const testFiles = await walk(path.join(ROOT, 'tests/domain/oracle'));
  const fileTexts = new Map();
  for (const f of testFiles) fileTexts.set(f, await readFile(f, 'utf8'));

  // Also scan certification tests and any other integration tests.
  const certFiles = await (async () => {
    try { return await walk(path.join(ROOT, 'tests/certification')); } catch { return []; }
  })();
  for (const f of certFiles) fileTexts.set(f, await readFile(f, 'utf8'));
  const domainFiles = await walk(path.join(ROOT, 'tests/domain'));
  for (const f of domainFiles) if (!fileTexts.has(f)) fileTexts.set(f, await readFile(f, 'utf8'));

  const BEHAVIORAL_MARKERS = [
    /resolveAbility\s*\(/,
    /dcHealthState\s*\.\s*get/,
    /figureConditions/,
    /assert\.deepStrictEqual\s*\(.*dcHealthState/,
  ];

  function hasBehavioralCoverage(atomKey, label) {
    const keyRx = new RegExp(`resolveAbility\\s*\\(\\s*['\"\`]${escapeRegex(atomKey)}['\"\`]`);
    const labelRx = label
      ? new RegExp(`resolveAbility\\s*\\(\\s*['\"\`]${escapeRegex(label)}['\"\`]`)
      : null;
    for (const [f, txt] of fileTexts.entries()) {
      if (keyRx.test(txt) || (labelRx && labelRx.test(txt))) {
        // Also verify the file contains at least one mutation assertion.
        if (BEHAVIORAL_MARKERS.some((r) => r.test(txt))) {
          return f.replace(ROOT + '/', '');
        }
      }
    }
    return null;
  }

  const result = [];
  for (const atom of covered) {
    const behavioralFile = hasBehavioralCoverage(atom.abilityKey, atom.label);
    const kind = behavioralFile ? 'behavioral' : 'structural-only';
    result.push({
      atomId: atom.id,
      abilityKey: atom.abilityKey,
      label: atom.label,
      type: atom.type,
      riskTier: atom.triage?.riskTier || 'none',
      dispatchKind: atom.triage?.dispatchKind || null,
      structuredFields: atom.triage?.structuredFields || [],
      kind,
      behavioralFile,
    });
  }

  const filtered = riskOnly ? result.filter((r) => r.riskTier === riskOnly) : result;

  const summary = {
    total: result.length,
    byKind: {
      behavioral: result.filter((r) => r.kind === 'behavioral').length,
      structuralOnly: result.filter((r) => r.kind === 'structural-only').length,
    },
    byRisk: {
      high: {
        total: result.filter((r) => r.riskTier === 'high').length,
        behavioral: result.filter((r) => r.riskTier === 'high' && r.kind === 'behavioral').length,
        structuralOnly: result.filter((r) => r.riskTier === 'high' && r.kind === 'structural-only').length,
      },
      medium: {
        total: result.filter((r) => r.riskTier === 'medium').length,
        behavioral: result.filter((r) => r.riskTier === 'medium' && r.kind === 'behavioral').length,
        structuralOnly: result.filter((r) => r.riskTier === 'medium' && r.kind === 'structural-only').length,
      },
      low: {
        total: result.filter((r) => r.riskTier === 'low').length,
        behavioral: result.filter((r) => r.riskTier === 'low' && r.kind === 'behavioral').length,
        structuralOnly: result.filter((r) => r.riskTier === 'low' && r.kind === 'structural-only').length,
      },
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    atoms: filtered.sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2, none: 3 };
      if (riskOrder[a.riskTier] !== riskOrder[b.riskTier]) {
        return riskOrder[a.riskTier] - riskOrder[b.riskTier];
      }
      if (a.kind !== b.kind) return a.kind === 'structural-only' ? -1 : 1;
      return a.abilityKey.localeCompare(b.abilityKey);
    }),
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
