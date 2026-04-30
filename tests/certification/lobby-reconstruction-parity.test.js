/**
 * Lobby reconstruction parity — every field set on a lobby in the
 * create path (`maybeSetupLobbyFromFirstMessage`) must also be
 * detectable in the reconstruction path that runs on bot restart.
 *
 * Why: lobbies live in an in-memory Map (`src/lobby-state.js`).
 * Bot restarts (Railway redeploys) lose the Map; reconstruction walks
 * #new-games active threads and rebuilds. If a flag is set in the
 * create path but not re-detected in reconstruction, restarting drops
 * the flag — exactly the loadCheckpoint bug we shipped.
 *
 * What this DOES catch:
 *   - new lobby fields added to the create path without a matching
 *     reconstruction lookup
 *   - typos / case mismatches between the two sites
 *
 * What this DOES NOT catch:
 *   - reconstruction reads the right thing but stores it under a
 *     different key (need stricter shape check)
 *   - fields that are detectable but require a tag to be applied AND
 *     re-detection logic that's been silently broken (e.g. tag rename)
 *
 * Allowlist: fields the create path sets that are intentionally NOT
 * carried across restart (e.g. status which is recomputed from thread
 * name prefix).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const INDEX_PATH = path.join(ROOT, 'index.js');

/** Fields excluded because reconstruction recomputes them differently. */
const RECONSTRUCTION_EXCLUSIONS = new Set([
  'creatorId',  // recomputed from embed mention
  'joinedId',   // recomputed from embed mention OR isSkirboLobby
  'status',     // recomputed from thread name prefix
]);

/** Extract the function body of a named async function from a file. */
function extractFunctionBody(src, fnName) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = src.match(re);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length - 1; // position of opening {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') {
      depth--;
      if (started && depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return src.slice(startIdx);
}

/**
 * Scan a function body for fields set on a lobby object via:
 *   - object-literal: `lobby = { x, y: foo, z: bar }`
 *   - direct assignment: `lobby.x = ...` / `lobby.X ??= ...`
 *   - destructured set: `if (X) lobby.x = true`
 * Returns a Set of field names.
 */
function getLobbyFieldsSet(body) {
  if (!body) return new Set();
  const fields = new Set();
  // Only scan object literals assigned to a lobby-shaped variable.
  // Patterns:
  //   const lobby = { ... }
  //   reconstructed_lobby = { ... }
  //   setLobby(threadId, { ... })
  //   ? { ... } : { ... }   (ternary lobby form)
  const lobbyAssignmentRes = [
    // const/let lobby = ... ? { ... } : { ... }
    /const\s+lobby\s*=\s*[\s\S]*?\?\s*\{([^{}]+)\}\s*:\s*\{([^{}]+)\}/g,
    // const/let lobby = { ... }
    /(?:const|let)\s+(?:reconstructed_)?lobby\s*=\s*\{([^{}]+)\}/g,
    // setLobby(arg, { ... })
    /setLobby\s*\([^,]+,\s*\{([^{}]+)\}/g,
  ];
  const extractKeys = (objInner) => {
    const parts = objInner.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // `...spread` → skip (it's not a literal field name)
      if (trimmed.startsWith('...')) continue;
      const key = trimmed.split(':')[0].trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) fields.add(key);
    }
  };
  for (const re of lobbyAssignmentRes) {
    let m;
    while ((m = re.exec(body)) !== null) {
      // Capture group(s) are the inner contents of {…}
      for (let i = 1; i < m.length; i++) {
        if (m[i]) extractKeys(m[i]);
      }
    }
  }
  // Direct property assignment to lobby/reconstructed_lobby
  const direct = body.matchAll(/(?:^|\s)(?:lobby|reconstructed_lobby)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g);
  for (const m of direct) fields.add(m[1]);
  return fields;
}

const SRC = readFileSync(INDEX_PATH, 'utf8');
const createBody = extractFunctionBody(SRC, 'maybeSetupLobbyFromFirstMessage');

// Reconstruction is inline in the ready event handler, not a named
// function. Extract by anchor text.
function extractReconstructionBody(src) {
  const startMarker = src.indexOf('Reconstructed');
  // Backtrack to the surrounding for-loop start; forward to the end.
  // Simplest: take a 4000-char window centered on the for-loop that calls
  // setLobby in the reconstruction path. This is rough but adequate for
  // a static field-name scan.
  const setLobbyIdx = src.lastIndexOf('setLobby(', startMarker);
  if (setLobbyIdx < 0) return null;
  const start = Math.max(0, setLobbyIdx - 2500);
  const end = Math.min(src.length, setLobbyIdx + 500);
  return src.slice(start, end);
}
const reconstructionBody = extractReconstructionBody(SRC);

const createFields = getLobbyFieldsSet(createBody);
const reconstructionFields = getLobbyFieldsSet(reconstructionBody);

describe('lobby-reconstruction parity', () => {
  it('create path is locatable (sanity)', () => {
    assert.ok(createBody, 'maybeSetupLobbyFromFirstMessage body not found');
    assert.ok(createFields.size > 0, 'no lobby fields detected in create path');
  });

  it('reconstruction path is locatable (sanity)', () => {
    assert.ok(reconstructionBody, 'lobby reconstruction body not found');
    assert.ok(reconstructionFields.size > 0, 'no lobby fields detected in reconstruction path');
  });

  for (const field of createFields) {
    if (RECONSTRUCTION_EXCLUSIONS.has(field)) continue;
    it(`field '${field}' set in create path is detectable in reconstruction`, () => {
      assert.ok(
        reconstructionFields.has(field),
        `Lobby field '${field}' is set in maybeSetupLobbyFromFirstMessage but ` +
        `the lobby reconstruction code on bot restart does not set it. ` +
        `On Railway redeploy the flag will be silently dropped. ` +
        `Either add detection logic to the reconstruction path or ` +
        `add '${field}' to RECONSTRUCTION_EXCLUSIONS with a reason.`,
      );
    });
  }
});
