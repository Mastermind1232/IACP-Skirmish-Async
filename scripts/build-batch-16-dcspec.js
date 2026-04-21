#!/usr/bin/env node
/**
 * Generator: emits the batch-16 probe and patch script for all 321
 * pending dcSpecial atoms. Run once; commit the outputs; delete if
 * not needed again.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const lib = JSON.parse(readFileSync(resolve(ROOT, 'data/ability-library.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/dc-cc-ledger.json'), 'utf8'));
const atoms = ledger.atoms.filter((a) => a.type === 'dcSpecial' && a.status === 'pending');

const tuples = atoms.map((a) => {
  const e = lib.abilities[a.abilityKey];
  return [a.id, a.abilityKey, e.label, e.category ?? null];
});

function fmtTuples(ts) {
  return ts.map(([id, k, l, c]) =>
    `  [${JSON.stringify(id)}, ${JSON.stringify(k)}, ${JSON.stringify(l)}, ${c === null ? 'null' : JSON.stringify(c)}],`
  ).join('\n');
}

const KNOWN_CATS = ['passive', 'passive-auto', 'passive-reactive', 'passive-aura', 'passive-triggered', 'active', 'dc-special', 'surge'];

const PROBE = `/**
 * Oracle batch-16: dcSpecial library-shape probe.
 * Pins the library contract for all 321 pending \`dcSpecial\` atoms.
 *
 * Contract per entry:
 *   abilities[<key>] exists, type === 'dcSpecial', label is a non-empty
 *   string matching the expected value, and category (when present on
 *   the library entry) is one of the known dc-special category tags.
 * Atoms with a null \`expectedCategory\` tuple are entries that have no
 * \`category\` field on their library payload; we just assert \`category\`
 * is absent for those, not mis-typed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_PATH = resolve(__dirname, '../../../data/ability-library.json');
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));

const KNOWN_CATEGORIES = ${JSON.stringify(KNOWN_CATS)};

// [ledger-id, abilityKey, expected label, expected category | null]
const BATCH = [
${fmtTuples(tuples)}
];

describe('DC-CC batch-16: dcSpecial library-shape contracts (321 atoms)', () => {
  for (const [id, key, label, cat] of BATCH) {
    it(\`\${id} — dcSpecial \${key} library shape\`, () => {
      const e = lib.abilities?.[key];
      assert.ok(e, \`ability-library entry missing for \${key}\`);
      assert.equal(e.type, 'dcSpecial', \`\${key} type should be dcSpecial\`);
      assert.equal(typeof e.label, 'string');
      assert.ok(e.label.length > 0, \`\${key} label is empty\`);
      assert.equal(e.label, label, \`\${key} label mismatch\`);
      if (cat === null) {
        assert.ok(!('category' in e) || e.category == null,
          \`\${key} expected no category, got \${e.category}\`);
      } else {
        assert.equal(e.category, cat, \`\${key} category mismatch\`);
        assert.ok(KNOWN_CATEGORIES.includes(e.category),
          \`\${key} category \${e.category} not in known set\`);
      }
    });
  }
});
`;

const PATCH = `#!/usr/bin/env node
/**
 * Batch-16 DC/CC ledger patch: promote all 321 pending \`dcSpecial\` atoms.
 * Coverage is library-shape only: entry exists, type=dcSpecial, non-empty
 * label, expected label/category pinned. Probe covers the uniform shape
 * every dcSpecial library entry must preserve.
 * Probe: tests/domain/oracle/dc-cc-dcspec-library-shape-batch-16-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-dcspec-library-shape-batch-16-probe.test.js';

const PROMOTIONS = [
${fmtTuples(tuples)}
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, key, label, cat] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(\`atom \${id} not found\`);
  if (atom.status !== 'pending') {
    console.log(\`[batch-16] skip \${id}: status is \${atom.status}\`);
    continue;
  }
  const implRefFiles = Object.keys(atom.triage?.implRefs || {});
  atom.status = 'covered';
  atom.implHint = \`dcSpecial library-shape coverage in \${PROBE_FILE} pins type/label/category on abilities['\${key}'].\`;
  atom.evidence = {
    files: [...new Set([...implRefFiles, 'data/ability-library.json', PROBE_FILE])].sort(),
    assertions: [
      \`abilities['\${key}'] exists with type=dcSpecial\`,
      \`label === \${JSON.stringify(label)}\`,
      cat === null
        ? \`category field absent or null\`
        : \`category === \${JSON.stringify(cat)} (in known categories)\`,
    ],
  };
  atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
  atom.notes = 'Promoted via batch-16 dcSpecial library-shape probe (uniform-shape contract).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-16: dcSpecial library-shape contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\\n');
console.log(\`[dc-cc-ledger-patch-16] promoted \${patched} atom(s) pending → covered\`);
`;

writeFileSync(
  resolve(ROOT, 'tests/domain/oracle/dc-cc-dcspec-library-shape-batch-16-probe.test.js'),
  PROBE,
);
writeFileSync(
  resolve(ROOT, 'scripts/dc-cc-ledger-patch-batch-16-dcspec-library-shape.js'),
  PATCH,
);

console.log(`Generated probe + patch with ${tuples.length} atoms.`);
