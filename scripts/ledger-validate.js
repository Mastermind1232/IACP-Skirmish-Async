#!/usr/bin/env node
/**
 * CRR Ledger validator.
 *
 * Reads docs/crr-ledger.json and docs/crr-ledger-schema.json and checks:
 *   1. Each atom conforms to the schema (hand-rolled — no ajv dep).
 *   2. Every covered atom's evidence.files path exists.
 *   3. Every covered atom's evidence.assertions substring is grep-findable
 *      in at least one of its evidence.files.
 *   4. CRR line ranges are within docs/consolidated-rules-raw.txt bounds
 *      and well-ordered.
 *   5. For covered atoms, crr.sha256 matches the sha256 of the cited lines
 *      in the CRR source (drift detector).
 *   6. seeAlso targets resolve to other atoms in the ledger.
 *   7. IDs are unique.
 *
 * CLI usage:
 *   node scripts/ledger-validate.js          # exit 0 on success, 1 on failure
 *   UPDATE_CRR_LEDGER=1 node scripts/ledger-validate.js
 *     → backfills crr.sha256 for covered atoms from the CRR source and
 *       writes docs/crr-ledger.json. Used for the one-time Phase-A seed.
 *
 * This validator is pilot-scoped: it runs only against atoms in the ledger,
 * and does NOT require every CRR section to have atoms. The completeness
 * test (tests/certification/crr-ledger-completeness.test.js) gates CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const LEDGER_PATH = path.join(ROOT, 'docs/crr-ledger.json');
const SCHEMA_PATH = path.join(ROOT, 'docs/crr-ledger-schema.json');
const CRR_PATH = path.join(ROOT, 'docs/consolidated-rules-raw.txt');

const ID_PATTERN = /^CRR-[A-Z]{2,6}-[0-9]{3}$/;
const SHA_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ALLOWED_STATUSES = new Set(['covered', 'gap', 'exempt', 'covered_by_ref']);
const ALLOWED_SCOPES = new Set(['skirmish', 'definitional']);
const ALLOWED_EVIDENCE_TYPES = new Set([
  'direct_oracle', 'certification', 'invariant_pin',
  'data_validation', 'headless_selfplay', 'unit_test',
]);

function sha256OfLines(crrLines, start, end) {
  // Inclusive [start, end] using 1-based CRR line numbers.
  const slice = crrLines.slice(start - 1, end).join('\n');
  return crypto.createHash('sha256').update(slice).digest('hex');
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

export function validateLedger({ updateShas = false } = {}) {
  const errors = [];
  const warnings = [];

  const ledger = loadJson(LEDGER_PATH);
  const crrText = fs.readFileSync(CRR_PATH, 'utf8');
  const crrLines = crrText.split('\n');
  const crrLineCount = crrLines.length;

  // Basic top-level shape.
  if (!ledger._meta || typeof ledger._meta !== 'object') {
    errors.push('_meta missing or not an object');
  }
  if (!Array.isArray(ledger.atoms)) {
    errors.push('atoms missing or not an array');
    return { ok: false, errors, warnings, mutated: false };
  }

  const seenIds = new Set();
  const atomsById = new Map();
  for (const atom of ledger.atoms) atomsById.set(atom.id, atom);

  let mutated = false;

  for (const atom of ledger.atoms) {
    const ctx = atom.id || '<unidentified>';

    // id.
    if (!atom.id || !ID_PATTERN.test(atom.id)) {
      errors.push(`[${ctx}] id missing or malformed (expected CRR-PREFIX-NNN)`);
    }
    if (seenIds.has(atom.id)) {
      errors.push(`[${ctx}] duplicate id`);
    }
    seenIds.add(atom.id);

    // summary.
    if (!atom.summary || atom.summary.length < 10) {
      errors.push(`[${ctx}] summary missing or too short`);
    }

    // scope.
    if (!ALLOWED_SCOPES.has(atom.scope)) {
      errors.push(`[${ctx}] scope '${atom.scope}' not in ${[...ALLOWED_SCOPES].join('|')}`);
    }

    // status.
    if (!ALLOWED_STATUSES.has(atom.status)) {
      errors.push(`[${ctx}] status '${atom.status}' not in ${[...ALLOWED_STATUSES].join('|')}`);
    }

    // crr block.
    const crr = atom.crr;
    if (!crr || typeof crr !== 'object') {
      errors.push(`[${ctx}] crr block missing`);
      continue;
    }
    if (!crr.section) errors.push(`[${ctx}] crr.section missing`);
    if (!Array.isArray(crr.lines) || crr.lines.length !== 2) {
      errors.push(`[${ctx}] crr.lines must be [start, end]`);
    } else {
      const [start, end] = crr.lines;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        errors.push(`[${ctx}] crr.lines malformed: [${start}, ${end}]`);
      } else if (end > crrLineCount) {
        errors.push(`[${ctx}] crr.lines end=${end} exceeds CRR length=${crrLineCount}`);
      } else {
        // SHA checks apply only to covered atoms.
        if (atom.status === 'covered') {
          const computedSha = sha256OfLines(crrLines, start, end);
          if (updateShas && crr.sha256 !== computedSha) {
            crr.sha256 = computedSha;
            mutated = true;
          } else if (!crr.sha256) {
            errors.push(
              `[${ctx}] crr.sha256 missing for covered atom; ` +
              `rerun with UPDATE_CRR_LEDGER=1 to backfill (expected ${computedSha})`
            );
          } else if (!SHA_PATTERN.test(crr.sha256)) {
            errors.push(`[${ctx}] crr.sha256 is not a 64-char hex string`);
          } else if (crr.sha256 !== computedSha) {
            errors.push(
              `[${ctx}] crr.sha256 drift — cited text changed. ` +
              `Stored: ${crr.sha256}. Computed from CRR lines ${start}-${end}: ${computedSha}. ` +
              `Review the atom summary and (if still correct) rerun with UPDATE_CRR_LEDGER=1.`
            );
          }
        }
      }
    }

    // Status-specific requirements.
    if (atom.status === 'covered') {
      if (!atom.evidence || typeof atom.evidence !== 'object') {
        errors.push(`[${ctx}] covered atom must have evidence block`);
      } else {
        const ev = atom.evidence;
        if (!ALLOWED_EVIDENCE_TYPES.has(ev.type)) {
          errors.push(`[${ctx}] evidence.type '${ev.type}' not in allowed set`);
        }
        if (!Array.isArray(ev.files) || ev.files.length === 0) {
          errors.push(`[${ctx}] evidence.files must be a non-empty array`);
        }
        if (!Array.isArray(ev.assertions) || ev.assertions.length === 0) {
          errors.push(`[${ctx}] evidence.assertions must be a non-empty array`);
        }
        // File existence.
        for (const relPath of ev.files || []) {
          const abs = path.join(ROOT, relPath);
          if (!fs.existsSync(abs)) {
            errors.push(`[${ctx}] evidence.files path does not exist: ${relPath}`);
          }
        }
        // Each assertion string must appear in at least one of the files.
        if (Array.isArray(ev.files) && Array.isArray(ev.assertions)) {
          const fileContents = ev.files.map((relPath) => {
            const abs = path.join(ROOT, relPath);
            if (!fs.existsSync(abs)) return '';
            return fs.readFileSync(abs, 'utf8');
          });
          for (const assertion of ev.assertions) {
            const found = fileContents.some((content) => content.includes(assertion));
            if (!found) {
              errors.push(
                `[${ctx}] evidence.assertions substring not grep-findable in any listed file: ` +
                `"${assertion}"`
              );
            }
          }
        }
      }

      if (!atom.reviewedBy || !atom.reviewedBy.name || !atom.reviewedBy.date) {
        errors.push(`[${ctx}] covered atom must have reviewedBy.name and reviewedBy.date`);
      } else if (!DATE_PATTERN.test(atom.reviewedBy.date)) {
        errors.push(`[${ctx}] reviewedBy.date must be YYYY-MM-DD`);
      }
    }

    if (atom.status === 'covered_by_ref') {
      if (!Array.isArray(atom.seeAlso) || atom.seeAlso.length === 0) {
        errors.push(`[${ctx}] covered_by_ref atom must have non-empty seeAlso`);
      }
    }

    // seeAlso targets must resolve to actual atoms.
    if (Array.isArray(atom.seeAlso)) {
      for (const ref of atom.seeAlso) {
        if (!atomsById.has(ref)) {
          warnings.push(`[${ctx}] seeAlso ${ref} does not resolve to a ledger atom (may be from a not-yet-atomized section)`);
        }
      }
    }
  }

  if (updateShas && mutated) {
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
  }

  return { ok: errors.length === 0, errors, warnings, mutated, atomCount: ledger.atoms.length };
}

// CLI entrypoint.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  const updateShas = process.env.UPDATE_CRR_LEDGER === '1';
  const { ok, errors, warnings, mutated, atomCount } = validateLedger({ updateShas });

  if (mutated) {
    console.log(`[ledger-validate] updated crr.sha256 for covered atoms; wrote ${LEDGER_PATH}`);
  }

  for (const w of warnings) console.warn(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  console.log(`[ledger-validate] ${atomCount} atoms; ${errors.length} errors, ${warnings.length} warnings`);

  process.exit(ok ? 0 : 1);
}
