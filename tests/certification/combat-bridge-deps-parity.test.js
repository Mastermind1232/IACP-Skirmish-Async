/**
 * Static-parse parity check between combat-bridge.js's deps destructures
 * and the wrapper bags in index.js that pass deps to those functions.
 *
 * Why this exists: combat-bridge.js's exported functions destructure their
 * `deps` argument. When a new key is added to a destructure, the production
 * wrapper in index.js must include the new key — otherwise the function
 * blows up at runtime with "X is not a function" the moment the new code
 * path executes.
 *
 * This actually happened in production: commit d6842d1 added
 * `hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints` to the
 * applyDamageAndFinishCombat destructure but didn't update the wrapper.
 * The bug stayed latent until a defender with Distracting Fire (Rebel
 * Pathfinder Elite) had LOS to an attacker post-attack-resolution.
 *
 * Headless tests didn't catch it because headless-deps.js builds its own
 * deps bag with all the keys present.
 *
 * This test parses both files as text — no runtime evaluation, no Discord
 * side effects.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');
const IDX_SRC = readFileSync(resolve(ROOT, 'index.js'), 'utf8');

/**
 * Extract destructured key names from a `const { ... } = deps;` block.
 * Handles renames (`a: b`), nested defaults aren't expected here.
 */
function extractDestructuredKeys(source) {
  const inner = source
    // Strip block comments + line comments to avoid noise
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const keys = new Set();
  let depth = 0;
  let buf = '';
  const flush = () => {
    const seg = buf.trim();
    buf = '';
    if (!seg) return;
    if (seg.startsWith('...')) return;
    // `key: alias` → take key. Otherwise, identifier.
    const m = seg.match(/^['"]?([A-Za-z_$][A-Za-z0-9_$]*)['"]?/);
    if (m) keys.add(m[1]);
  };
  for (const ch of inner) {
    if (ch === '{' || ch === '(' || ch === '[') { depth++; buf += ch; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; buf += ch; continue; }
    if (depth === 0 && ch === ',') { flush(); continue; }
    buf += ch;
  }
  flush();
  return keys;
}

/** Find the body of `function NAME(...)` and return the source up to its closing `}`. */
function extractFunctionBody(src, namePattern) {
  const re = new RegExp(`(?:async\\s+)?function ${namePattern}\\s*\\([^)]*\\)\\s*\\{`);
  const m = src.match(re);
  if (!m) throw new Error(`Could not find function ${namePattern}`);
  const startIdx = m.index + m[0].length - 1; // position of the opening `{`
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`Function ${namePattern} body not closed`);
}

/** Pull out the inside of the FIRST `const { ... } = deps;` block in a function body. */
function extractFirstDepsDestructure(fnBody) {
  const re = /const\s*\{([\s\S]*?)\}\s*=\s*deps;/;
  const m = fnBody.match(re);
  if (!m) throw new Error('No `const { ... } = deps` block found');
  return m[1];
}

/**
 * Pull out the inside of the deps object literal passed at the given
 * positional argument index to a `_pure(...)` call in an index.js wrapper.
 * Walks balanced braces; assumes the deps object is the LAST positional arg.
 */
function extractWrapperDepsObject(idxSrc, pureCallName, depsArgIndex) {
  const callRe = new RegExp(`${pureCallName}\\s*\\(`);
  const m = idxSrc.match(callRe);
  if (!m) throw new Error(`Could not find ${pureCallName}( call in index.js`);
  let i = m.index + m[0].length;
  let depth = 1;
  let argIdx = 0;
  let objStart = -1;
  for (; i < idxSrc.length && depth > 0; i++) {
    const ch = idxSrc[i];
    if (ch === '(' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === ']') { depth--; if (depth === 0) break; continue; }
    if (ch === '{') {
      if (depth === 1 && argIdx === depsArgIndex) { objStart = i; break; }
      depth++;
      continue;
    }
    if (ch === '}') { depth--; continue; }
    if (ch === ',' && depth === 1) argIdx++;
  }
  if (objStart === -1) throw new Error(`Could not locate arg ${depsArgIndex} object in ${pureCallName}( call`);
  let bd = 0;
  for (let j = objStart; j < idxSrc.length; j++) {
    const c = idxSrc[j];
    if (c === '{') bd++;
    else if (c === '}') {
      bd--;
      if (bd === 0) return idxSrc.slice(objStart + 1, j);
    }
  }
  throw new Error(`Object literal in ${pureCallName} not closed`);
}

/**
 * Each combat-bridge.js function that destructures `deps` has a paired wrapper
 * in index.js that builds the deps bag and forwards. Mismatch = runtime crash.
 *
 * Format: [combat-bridge function name, index.js _pure call name, 0-indexed
 *          position of the deps object in the wrapper's call signature].
 */
const PARITY_CASES = [
  ['applyNpcDamageToFigure',   '_applyNpcDamageToFigurePure',     5],
  ['applyDirectDamageToFigure','_applyDirectDamageToFigurePure',  8],
  ['resolveCombatAfterRolls',  '_resolveCombatAfterRollsPure',    3],
  ['applyDamageAndFinishCombat','_applyDamageAndFinishCombatPure',4],
  ['checkPostCombatSurges',    '_checkPostCombatSurgesPure',      7],
  ['finishCombatResolution',   '_finishCombatResolutionPure',     5],
  ['runAfterResolveWindow',    '_runAfterResolveWindowPure',      5],
];

describe('Combat-bridge deps parity (production wrappers in index.js)', () => {
  for (const [fnName, pureCallName, depsArgIndex] of PARITY_CASES) {
    it(`${fnName}: every destructured dep key is provided by ${pureCallName} wrapper`, () => {
      const fnBody = extractFunctionBody(CB_SRC, fnName);
      const required = extractDestructuredKeys(extractFirstDepsDestructure(fnBody));
      const wrapperBag = extractWrapperDepsObject(IDX_SRC, pureCallName, depsArgIndex);
      const provided = extractDestructuredKeys(wrapperBag);
      const missing = [...required].filter((k) => !provided.has(k));
      if (missing.length) {
        assert.fail(
          `${missing.length} dep(s) destructured by ${fnName} are missing from the wrapper at index.js (deps bag passed to ${pureCallName}):\n\n` +
          missing.map((k) => `  • ${k}`).join('\n') +
          `\n\nFix: add the missing keys to the wrapper. This bug-class crashed prod once (commit d6842d1 added 3 keys to applyDamageAndFinishCombat's destructure but missed its wrapper).`
        );
      }
      assert.ok(true);
    });
  }
});
