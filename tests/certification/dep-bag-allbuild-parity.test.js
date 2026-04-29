/**
 * Static-parse parity check between CONTEXT_GROUPS and the production
 * `buildAllDeps()` bag in index.js.
 *
 * Why this exists: the existing dep-bag-parity test only validates the
 * headless deps bag. The PRODUCTION bag (used by the live Discord bot)
 * lives in index.js's `buildAllDeps()` function. If a context group
 * adds a required key but index.js isn't updated, tests pass but the
 * bot crashes at startup with the runtime validator (index.js:3451):
 *
 *   Error: buildAllDeps() missing keys used by CONTEXT_GROUPS: ...
 *
 * That exact crash hit production once. This test is the pre-deploy
 * guard so it can never happen again.
 *
 * Approach: read index.js as text, locate the buildAllDeps() function
 * body, extract the keys it includes in its returned object literal,
 * and compare against `getAllRequiredDepKeys()`. No runtime evaluation
 * — just text parsing, so no Discord/DB/handler side effects fire.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllRequiredDepKeys } from '../../src/context-factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');
const INDEX_SRC = readFileSync(resolve(ROOT, 'index.js'), 'utf8');

/**
 * Extract the source text of `buildAllDeps()`'s body (just the returned
 * object literal). Tracks brace depth from the first `{` after `return`
 * through the matching `}`.
 */
function extractBuildAllDepsBody(src) {
  const fnMatch = src.match(/function buildAllDeps\(\)\s*\{[\s\S]*?return\s*\{/);
  if (!fnMatch) throw new Error('Could not find function buildAllDeps() in index.js');
  // Position of the `{` that opens the returned object literal.
  const startIdx = fnMatch.index + fnMatch[0].length - 1;
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  throw new Error('buildAllDeps() return object literal not closed');
}

/**
 * Walk through the object literal and pull out top-level keys.
 * Supports:
 *   - shorthand:       `getGame,`
 *   - explicit:        `getGame: someThing,`
 *   - aliased:         `'foo': bar,`
 * Skips spread (`...x`) entries and inline-defined properties.
 *
 * To keep parsing simple, we ignore anything inside nested braces /
 * parens / brackets — only top-level property identifiers count.
 */
function stripComments(text) {
  // Remove block comments first, then line comments. Naive (doesn't
  // respect strings) but the buildAllDeps body is plain identifiers
  // and comments — no string literals — so it's safe.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractTopLevelKeys(body) {
  // Strip comments + outer braces.
  const inner = stripComments(body).replace(/^\s*\{|\}\s*$/g, '');
  const keys = new Set();
  let depth = 0;
  let buf = '';
  const flush = () => {
    const seg = buf.trim();
    buf = '';
    if (!seg) return;
    if (seg.startsWith('...')) return;
    // Each top-level property is one of:
    //   identifier             (shorthand)
    //   identifier: <value>    (key: value)
    //   'string': <value>      (string-keyed)
    // We only need the identifier part.
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

const body = extractBuildAllDepsBody(INDEX_SRC);
const providedKeys = extractTopLevelKeys(body);
const requiredKeys = [...getAllRequiredDepKeys()].sort();
const missing = requiredKeys.filter(k => !providedKeys.has(k));

describe('Dep-bag parity (production buildAllDeps in index.js)', () => {
  it('every CONTEXT_GROUPS-required key is present in buildAllDeps()', () => {
    if (missing.length) {
      assert.fail(
        `${missing.length} required dep(s) missing from buildAllDeps() in index.js — ` +
        `the live bot will crash at startup with this exact list:\n\n` +
        missing.map(k => `  • ${k}`).join('\n') +
        `\n\nFix: add the missing keys to the returned object literal in ` +
        `\`function buildAllDeps()\` (index.js, around line 3333).`
      );
    }
    assert.ok(true);
  });
});
