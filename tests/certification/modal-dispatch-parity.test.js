/**
 * Modal-dispatch parity — every registered modal handler prefix must
 * be present in the router's MODAL_PREFIXES list at src/router.js.
 *
 * Why: modals submit through a separate dispatch (router.getHandlerKey
 * with 'modal' type) that uses a hand-maintained MODAL_PREFIXES array.
 * If a registered modal handler's prefix isn't in that array,
 * `getHandlerKey` returns null and the modal dispatcher returns early
 * without invoking the handler — exactly the cp_save_modal_ bug we
 * shipped (handler registered, modal opened, submit went nowhere).
 *
 * What this DOES catch:
 *   - new register('X_modal_', ...) without a router MODAL_PREFIXES entry
 *   - typos / case mismatches between the two
 *
 * What this DOES NOT catch:
 *   - register prefixes that don't match the *_modal_ naming convention
 *     (the test uses the convention to detect modal handlers)
 *   - modal prefixes that ARE in the router list but missing from any
 *     dispatch branch (i.e., the inline if/else in index.js can still
 *     fail to call the handler — that path now has a table-driven
 *     fallthrough to register()-based dispatch, which is the safety net)
 *
 * Allowlist: registered prefixes that are not modal handlers despite
 * matching the *_modal_ convention. None today.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const HANDLERS_INDEX = path.join(ROOT, 'src/handlers/index.js');
const ROUTER_PATH = path.join(ROOT, 'src/router.js');

/** Registered modal handlers that intentionally don't appear in the router list. */
const MODAL_PARITY_ALLOWLIST = new Set([]);

function getRegisteredModalPrefixes() {
  const src = readFileSync(HANDLERS_INDEX, 'utf8');
  const out = [];
  const re = /register\(\s*'([^']+_modal_)'\s*,/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function getRouterModalPrefixes() {
  const src = readFileSync(ROUTER_PATH, 'utf8');
  // Find the MODAL_PREFIXES array (handles multi-line array, with sort).
  const m = src.match(/const MODAL_PREFIXES = \[([\s\S]*?)\]/);
  if (!m) throw new Error('MODAL_PREFIXES not found in src/router.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const REGISTERED = getRegisteredModalPrefixes();
const ROUTER_LIST = getRouterModalPrefixes();
const ROUTER_SET = new Set(ROUTER_LIST);

describe('modal-dispatch parity', () => {
  it('router.js MODAL_PREFIXES is non-empty (sanity)', () => {
    assert.ok(ROUTER_LIST.length > 0, 'router MODAL_PREFIXES is empty');
  });

  for (const prefix of REGISTERED) {
    if (MODAL_PARITY_ALLOWLIST.has(prefix)) continue;
    it(`${prefix} (registered modal handler) — must be in router MODAL_PREFIXES`, () => {
      assert.ok(
        ROUTER_SET.has(prefix),
        `Modal handler '${prefix}' is registered via register() but is missing from ` +
        `the MODAL_PREFIXES list at src/router.js. The modal dispatcher uses ` +
        `getHandlerKey(customId, 'modal') which only matches prefixes in that list, ` +
        `so the modal will silently submit to nothing. Add '${prefix}' to ` +
        `the MODAL_PREFIXES array in src/router.js.`,
      );
    });
  }
});
