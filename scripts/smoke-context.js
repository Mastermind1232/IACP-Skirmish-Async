/**
 * Smoke test: verify every registered handler's ctx usage is covered
 * by its declared context group.
 *
 * Static analysis — reads handler source files as text and parses
 * ctx property accesses. Compares them against CONTEXT_GROUPS definitions.
 *
 * Catches: handler reads ctx.foo but "foo" is not in the handler's
 * declared context group → runtime crash when button is clicked.
 *
 * Also resolves one level of helper-function delegation: if a handler
 * passes ctx to a local helper, the helper's ctx accesses are included
 * in the handler's effective usage.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONTEXT_GROUPS } from '../src/context-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HANDLERS_DIR = join(ROOT, 'src', 'handlers');

/**
 * Known-benign gaps: `${functionName}:${key}` → why it is not a bug.
 *
 * Keep this SMALL and justified. Every entry is a real "handler reads a key its
 * group lacks" hit — it is on the list only because the read is optional and
 * the absence is handled. Anything that silently disables a feature belongs in
 * the group, not here.
 *
 * This allowlist is what lets the check run in `npm test`. It was written to
 * catch precisely the class of bug that killed Cleave, Fighting Knife, Heavy
 * Fire and five defeat-CCs, but it exited non-zero on these four benign cases
 * and so was never wired in — and therefore never ran. alexanbv 2026-08-11.
 */
const KNOWN_BENIGN = {
  // Documented: the closure is discarded once the window posts buttons, and
  // the close path is rebuilt from combat._aarCloseArgs instead. See the
  // ARCHITECTURE NOTE in src/handlers/after-attack-resolve.js.
  'handleAarDone:afterAttackClose': 'reconstructed from combat._aarCloseArgs; absence is the normal live path',
  // Optional continuation, never assigned anywhere in src/. Guarded at
  // src/handlers/eoa-handler.js:41. Should be wired or deleted; harmless today.
  'handleEoaFire:eoaResolvedCallback': 'optional continuation, never set in src/; guarded before use',
  'handleEoaSkipAll:eoaResolvedCallback': 'optional continuation, never set in src/; guarded before use',
  // Static-analysis artifact: handleFavRemove never reaches the modal handler
  // whose ctx access the tracer attributed to it.
  'handleFavRemove:buildSquadConfirmText': 'tracer artifact — handleFavRemove never calls the modal handler',
};

// ── Step 1: Parse handler index.js for imports and register() calls ─────────

const indexSrc = readFileSync(join(HANDLERS_DIR, 'index.js'), 'utf8');

// Build import map: functionName → relative source file
const fnToFile = new Map();
for (const m of indexSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
  const file = m[2];
  for (const raw of m[1].split(',')) {
    const name = raw.trim();
    if (name && /^\w+$/.test(name)) fnToFile.set(name, file);
  }
}

// Parse register() calls — one per line
const registrations = [];
for (const line of indexSrc.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('register(')) continue;

  const prefixM = trimmed.match(/register\('([^']+)'/);
  if (!prefixM) continue;
  const prefix = prefixM[1];

  // Group is the last quoted string before closing paren
  const groupM = trimmed.match(/,\s*'(\w+)'\s*\)\s*;?\s*$/);
  const group = groupM ? groupM[1] : null;
  if (!group) continue; // skip handlers without a group

  // Function name — direct or wrapper arrow function
  const wrapperM = trimmed.match(/\(\w+,\s*\w+\)\s*=>\s*(\w+)\(/);
  let functionName;
  if (wrapperM) {
    functionName = wrapperM[1];
  } else {
    const directM = trimmed.match(/register\('[^']+',\s*(\w+)/);
    functionName = directM ? directM[1] : null;
  }

  if (functionName) {
    registrations.push({ prefix, functionName, group });
  }
}

// ── Step 2: Parse handler source files ──────────────────────────────────────

/**
 * Extract the brace-balanced block starting at source[openIdx] (which should be '{').
 * Skips string literals to avoid counting braces inside strings.
 */
function extractBraceBlock(source, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
    else if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\') i++;
        i++;
      }
    }
    else if (ch === '`') {
      i++;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') i++;
        // Skip ${...} expressions (they may contain real ctx accesses)
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          let tdepth = 1;
          while (i < source.length && tdepth > 0) {
            if (source[i] === '{') tdepth++;
            else if (source[i] === '}') tdepth--;
            if (tdepth > 0) i++;
          }
        }
        i++;
      }
    }
    // Skip single-line comments
    else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    }
    // Skip block comments
    else if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++; // skip past '/'
    }
  }
  return source.slice(openIdx); // fallback — unclosed brace
}

/**
 * Extract ctx property keys from a code string.
 * Catches two patterns:
 *   1. const { key1, key2 } = ctx;
 *   2. ctx.key or ctx?.key
 */
function extractCtxKeys(code) {
  const keys = new Set();

  // Strip single-line comments to avoid false positives
  const stripped = code.replace(/\/\/[^\n]*/g, '');

  // Pattern 1: destructuring
  for (const m of stripped.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*ctx\b/g)) {
    for (const part of m[1].split(',')) {
      // Handle renaming (key: alias) and defaults (key = val)
      const key = part.trim().split(/[\s:=]/)[0];
      if (key && /^\w+$/.test(key)) keys.add(key);
    }
  }

  // Pattern 2: direct property access
  for (const m of stripped.matchAll(/\bctx\??\.\s*(\w+)/g)) {
    keys.add(m[1]);
  }

  return keys;
}

/**
 * Parse a handler source file. Returns a Map of functionName → Set<ctxKey>
 * for every function that takes a `ctx` parameter.
 */
function parseFunctionsFromFile(source) {
  const functions = new Map();

  // Match function declarations with ctx parameter
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;

  for (const m of source.matchAll(funcRegex)) {
    const name = m[1];
    const params = m[2];

    if (!/\bctx\b/.test(params)) continue;

    const braceIdx = m.index + m[0].length - 1;
    const body = extractBraceBlock(source, braceIdx);
    const ctxKeys = extractCtxKeys(body);

    functions.set(name, ctxKeys);
  }

  return functions;
}

// Read and parse all handler source files
const fileCache = new Map();   // filename → Map<fnName, Set<key>>
const fileSources = new Map(); // filename → source text

for (const file of new Set(fnToFile.values())) {
  const fullPath = join(HANDLERS_DIR, file);
  try {
    const source = readFileSync(fullPath, 'utf8');
    fileSources.set(file, source);
    fileCache.set(file, parseFunctionsFromFile(source));
  } catch {
    // File not found — will be caught later
  }
}

/**
 * Global fnName → ctx keys, across ALL handler files.
 *
 * A handler may forward its own ctx into a handler that belongs to a DIFFERENT
 * context group — e.g. combat-special-effects.js hands its ctx to
 * handleDcAction from dc-play-area.js. The receiver then reads keys its caller's
 * group never declared, which is invisible to a same-file-only lookup and is
 * exactly how Missile Salvo died after die selection.
 *
 * Merging by name is deliberately conservative: on a name collision across
 * files we take the union, so the check over-reports rather than under-reports.
 * A false positive is one line in KNOWN_BENIGN; a false negative is a live
 * crash. alexanbv 2026-08-11.
 */
const globalFunctions = new Map();
for (const fnMap of fileCache.values()) {
  for (const [fn, keys] of fnMap) {
    if (!globalFunctions.has(fn)) globalFunctions.set(fn, new Set());
    for (const k of keys) globalFunctions.get(fn).add(k);
  }
}

// ── Step 3: Resolve helper-function delegation ──────────────────────────────

/**
 * Get the effective ctx keys for a handler function, including keys from
 * local helper functions that receive ctx as an argument.
 */
function getEffectiveCtxKeys(functionName, file) {
  const fileFunctions = fileCache.get(file);
  if (!fileFunctions) return new Set();

  const handlerKeys = fileFunctions.get(functionName);
  if (!handlerKeys) return new Set();

  const effectiveKeys = new Set(handlerKeys);

  // Find the handler's body to look for helper calls
  const source = fileSources.get(file);
  if (!source) return effectiveKeys;

  const funcRegex = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`
  );
  const fm = source.match(funcRegex);
  if (!fm) return effectiveKeys;

  const braceIdx = fm.index + fm[0].length - 1;
  const body = extractBraceBlock(source, braceIdx);

  // Look for calls where ctx is passed as a standalone argument
  // Match: someFunction(..., ctx, ...) or someFunction(ctx)
  // Avoid matching: someFunction(ctx.foo) — that's passing a property, not ctx itself
  for (const cm of body.matchAll(/\b(\w+)\s*\([^)]*\bctx\b(?![.?\w])[^)]*\)/g)) {
    const calledFn = cm[1];
    if (calledFn === functionName) continue; // skip self-recursion
    if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(calledFn)) continue;

    // Same file first, then any handler file — a cross-file handoff forwards
    // this ctx into a function whose own group may declare different keys.
    const helperKeys = fileFunctions.get(calledFn) || globalFunctions.get(calledFn);
    if (helperKeys) {
      for (const k of helperKeys) effectiveKeys.add(k);
    }
  }

  return effectiveKeys;
}

// ── Step 4: Cross-reference registrations against context groups ────────────

let passed = 0;
let failed = 0;
const failures = [];
const checked = new Set(); // deduplicate: functionName|group

for (const { prefix, functionName, group } of registrations) {
  const groupKeys = CONTEXT_GROUPS[group];
  if (!groupKeys) {
    failures.push({ prefix, functionName, group, missingKeys: [], issue: `Unknown context group "${group}"` });
    failed++;
    continue;
  }

  const dedupeKey = `${functionName}|${group}`;
  if (checked.has(dedupeKey)) {
    // Already checked this function+group combo (different prefix, same handler)
    passed++;
    continue;
  }
  checked.add(dedupeKey);

  const file = fnToFile.get(functionName);
  if (!file) {
    // Function not found in imports — skip (startup validation catches this)
    passed++;
    continue;
  }

  const effectiveKeys = getEffectiveCtxKeys(functionName, file);

  if (effectiveKeys.size === 0) {
    // Handler doesn't use ctx (e.g. handleBotmenuKillNo) — that's fine
    passed++;
    continue;
  }

  const groupKeySet = new Set(groupKeys);
  const missingKeys = [...effectiveKeys]
    .filter((k) => !groupKeySet.has(k))
    .filter((k) => !KNOWN_BENIGN[`${functionName}:${k}`]);

  if (missingKeys.length > 0) {
    failures.push({
      prefix,
      functionName,
      group,
      missingKeys,
      issue: `ctx keys not in group "${group}": ${missingKeys.join(', ')}`,
    });
    failed++;
  } else {
    passed++;
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} handler-group pairs checked: ${passed} OK, ${failed} FAILED`);

if (failures.length) {
  console.error('\nFailing handlers:');
  for (const f of failures) {
    console.error(`  ${f.functionName} (prefix: ${f.prefix}, group: ${f.group})`);
    console.error(`    ${f.issue}`);
  }
  process.exit(1);
} else {
  console.log('All handlers have complete context coverage.');
  process.exit(0);
}
