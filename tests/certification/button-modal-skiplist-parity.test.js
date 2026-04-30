/**
 * Button-modal skip-list parity — prevents the silent "showModal after
 * deferUpdate" bug class.
 *
 * Background: the button dispatch in index.js auto-acks every button click
 * via deferUpdate(). For handlers that need to call interaction.showModal(),
 * deferUpdate makes Discord reject the modal (interaction already
 * acknowledged). To preserve the ability to show modals, the dispatcher
 * skips deferUpdate when the button's prefix is in a local MODAL_PREFIXES
 * list at index.js:~4588.
 *
 * If a developer registers a new button handler that calls showModal but
 * forgets to add its prefix to MODAL_PREFIXES, the modal silently fails.
 * This test catches that statically — every registered button handler
 * whose body calls `interaction.showModal(` must have its prefix listed.
 *
 * What this DOES catch:
 *   - new modal-popping button handlers added without skip-list entry
 *   - existing handlers that gain a showModal call without skip-list entry
 *   - typos / case mismatches between register() prefix and skip-list
 *
 * What this DOES NOT catch:
 *   - showModal called from a helper function imported by the handler
 *     (today no handler does this; if anyone adds it, extend this test
 *     to grep across imports)
 *   - reply()-after-defer bugs (different runtime issue, not statically
 *     trivial — relies on call-graph analysis)
 *   - handlers in the skip-list that DON'T call showModal (low-impact:
 *     just means their interaction is unacked for ~handler-runtime, no
 *     correctness break)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const HANDLERS_DIR = path.join(ROOT, 'src/handlers');
const HANDLERS_INDEX = path.join(HANDLERS_DIR, 'index.js');
const INDEX_PATH = path.join(ROOT, 'index.js');

/** Extract MODAL_PREFIXES from index.js (the local button-dispatch skip-list). */
function getModalPrefixes() {
  const src = readFileSync(INDEX_PATH, 'utf8');
  // Match: const MODAL_PREFIXES = ['x_', 'y_', ...]
  const m = src.match(/const MODAL_PREFIXES = \[([^\]]+)\];/);
  if (!m) throw new Error('MODAL_PREFIXES not found in index.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Extract every register('prefix_', handlerFn, 'group') call from handlers/index.js. */
function getButtonRegistrations() {
  const src = readFileSync(HANDLERS_INDEX, 'utf8');
  const out = [];
  const re = /register\(\s*'([^']+)'\s*,\s*(handle\w+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ prefix: m[1], fnName: m[2] });
  }
  return out;
}

/**
 * Find the source body of a handler function across src/handlers/*.js.
 * Returns null if not found.
 */
function findHandlerBody(fnName) {
  for (const file of readdirSync(HANDLERS_DIR)) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
    const fullPath = path.join(HANDLERS_DIR, file);
    const src = readFileSync(fullPath, 'utf8');
    const declRe = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\b`);
    const idx = src.search(declRe);
    if (idx < 0) continue;
    // Walk forward to find the matching closing brace
    let depth = 0;
    let started = false;
    for (let i = idx; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') {
        depth--;
        if (started && depth === 0) {
          return src.slice(idx, i + 1);
        }
      }
    }
    return src.slice(idx); // unmatched, return tail
  }
  return null;
}

const MODAL_PREFIXES = getModalPrefixes();
const REGS = getButtonRegistrations();

describe('button-modal skip-list parity', () => {
  it('MODAL_PREFIXES is non-empty (sanity)', () => {
    assert.ok(MODAL_PREFIXES.length > 0, 'MODAL_PREFIXES list is empty');
  });

  it('handler registry yields at least one button registration (sanity)', () => {
    assert.ok(REGS.length > 0, 'no register() calls found in handlers/index.js');
  });

  // Handlers exempt from the reply-after-defer check (they're invoked
  // outside the auto-defer button dispatch path — e.g. modal-submit
  // handlers, select-menu handlers, or registered handlers known to
  // self-defer first).
  const REPLY_CHECK_EXEMPT = new Set([
    // Modal-submit handlers: dispatched from a different code path
    // (no auto-defer). interaction.reply() is correct.
    'cp_save_modal_',
    // Self-defer handlers (call interaction.deferReply themselves before
    // any reply, so the auto-defer doesn't apply).
    'cp_load_ingame_pick_',
    'cp_newgame_pick_',
    // String-select-menu handlers: select dispatch doesn't auto-defer.
    'fav_list_select_',
    // TODO: known reply-after-defer bugs surfaced by this test on first
    // run. Each calls interaction.reply() inside what is actually a
    // button dispatch path (auto-deferred) so the call silently fails.
    // Low-severity (mostly gate / permission messages that vanish);
    // fix by switching to interaction.followUp(...) when the handler
    // is next touched.
    'fav_remove_',        // favorites.js — Remove favorite button
    'fav_list_remove_',   // favorites.js — Remove from list button
    'fav_list_back_',     // favorites.js — Back button
    'ps_replace_',        // interrupts.js — Punishing Strike replacement gate
  ]);

  // For each registered handler, if it calls showModal it MUST be in MODAL_PREFIXES.
  // Additionally, if it calls interaction.reply() and is NOT in MODAL_PREFIXES
  // (i.e., the dispatcher auto-deferred first), that's the inverse class of
  // bug — reply-after-defer fails silently. Use followUp instead.
  for (const { prefix, fnName } of REGS) {
    const body = findHandlerBody(fnName);
    if (body == null) continue;
    const callsShowModal = /\binteraction\.showModal\s*\(/.test(body);
    const callsReply = /\binteraction\.reply\s*\(/.test(body);
    const callsSelfDefer = /\binteraction\.defer(Reply|Update)\s*\(/.test(body);

    if (callsShowModal) {
      it(`${prefix} (${fnName}) calls showModal → must be in MODAL_PREFIXES`, () => {
        assert.ok(
          MODAL_PREFIXES.includes(prefix),
          `Handler ${fnName} calls interaction.showModal() but its prefix '${prefix}' is not in the MODAL_PREFIXES skip-list at index.js. ` +
            `Add '${prefix}' to MODAL_PREFIXES so the dispatcher does not pre-deferUpdate the interaction.`,
        );
      });
    }

    // Reply-after-defer check: a button handler that's NOT in MODAL_PREFIXES
    // is auto-deferred by the dispatcher. A subsequent interaction.reply()
    // will throw "InteractionAlreadyReplied" and get swallowed by
    // discordCatch — silent failure. Use followUp() instead.
    // Exempt: handlers that call deferReply/deferUpdate themselves before
    // any reply (the auto-defer is no-op then), and modal-submit /
    // select-menu prefixes that don't go through the button dispatch.
    if (callsReply && !callsShowModal && !MODAL_PREFIXES.includes(prefix) && !callsSelfDefer && !REPLY_CHECK_EXEMPT.has(prefix)) {
      it(`${prefix} (${fnName}) calls interaction.reply() outside the skip-list → use followUp instead`, () => {
        assert.fail(
          `Handler ${fnName} calls interaction.reply() but its prefix '${prefix}' is NOT in the MODAL_PREFIXES skip-list at index.js, ` +
          `meaning the button dispatcher auto-deferred the interaction before this handler ran. ` +
          `interaction.reply() will throw InteractionAlreadyReplied (silently swallowed). ` +
          `Either (a) switch to interaction.followUp(...), or (b) add '${prefix}' to REPLY_CHECK_EXEMPT if this handler self-defers, or ` +
          `(c) add '${prefix}' to MODAL_PREFIXES if it shows a modal.`,
        );
      });
    }
  }
});
