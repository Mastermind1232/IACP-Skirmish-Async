/**
 * Handler-emit parity — every registered button/select/modal prefix
 * must have at least one UI somewhere that emits a customId starting
 * with that prefix. Catches the "I registered a handler but no UI
 * emits its customId" class of dead-code bug (e.g. the `squad_select_`
 * orphan we found earlier).
 *
 * Inverse of button-modal-skiplist-parity (which catches missing
 * skip-list entries). Together they form a closed loop:
 *   register() ↔ UI emitter ↔ skip-list ↔ dispatch
 *
 * What this DOES catch:
 *   - register('foo_', fn) with no `customId: \`foo_${...}\`` or
 *     `setCustomId(\`foo_${...}\`)` anywhere in src/
 *   - typos / case mismatches between register() prefix and emit site
 *
 * What this DOES NOT catch:
 *   - Handlers reachable via dynamic prefix construction (none in this
 *     codebase today)
 *   - Single-time emit prefixes that legitimately exist but are
 *     emitted from external integrations (none today)
 *
 * Allowlist: prefixes whose emitter lives outside the scanned tree
 * (e.g. emitted from an external bot or webhook). Empty today.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const HANDLERS_DIR = path.join(ROOT, 'src/handlers');
const HANDLERS_INDEX = path.join(HANDLERS_DIR, 'index.js');

/**
 * Prefixes whose emitter is intentionally outside the scanned source
 * tree, OR known-dead handlers awaiting cleanup. Each entry should
 * include a TODO comment with the disposition. New entries should be
 * justified — most of the time the right answer is to delete the
 * unreachable handler, not to add it here.
 */
const EMIT_ALLOWLIST = new Set([
  // TODO: confirmed dead (no UI emits); delete handler + register call.
  // Surfaced by this parity test on first run; allow-listed pending
  // user confirmation before deletion.
  'refresh_all_',           // game-tools.js:119 handleRefreshAll — superseded by resync_
  'default_deck_',          // game-tools.js:470 handleDefaultDeck — never wired to UI
  'botmenu_recover_',       // recover.js:26 handleBotmenuRecover — superseded by resync_
  // TODO: confirmed dead. handleVanguardDiePick (dc-play-area.js) — its only UI
  // emitter was the legacy pre-target die-swap picker (the `if (false)` block in
  // dc-play-area.js), deleted 2026-06-24 in the gate-machine cleanup. Vanguard
  // die-swap is now driven live by the on-declare window (od_dieswap_ /
  // handleOnDeclareDieSwap). Handler + register + the combat.js:~4828
  // pendingVanguardSwap revert block are now dead; left for user-confirmed removal.
  'vanguard_pick_',
  'slow_on_draw_resume_',   // alexanbv 2026-05-09 architectural fix: SoTD migrated to combatStack push/pop, no Resume button posted; handler kept for legacy state recovery only
  // handleCcDiscardSelect (cc-hand.js) is the LIVE StringSelectMenu handler for the
  // hand-discard flow (also routed via the domain command-router → DiscardCommandCard).
  // Its only static `cc_discard_select_` emitter lived inside handleCcDiscard, which
  // was an unregistered, unreachable dead handler removed 2026-06-24. The select
  // handler is kept (still wired through the command path); its prefix is allowlisted
  // because the static scan no longer sees a setCustomId literal for it.
  'cc_discard_select_',
  // zillo_pierce_* is the LIVE post-surge pierce-cancel handler
  // (handleZilloPierceCancel). Its prompt is emitted from the gate engine
  // (combat-abilities-zillo.js), not from a static customId literal the scan
  // can see, so it stays allowlisted.
  'zillo_pierce_use_',          // handleZilloPierceCancel — engine resolver zillo_technique_pierce_cancel
  'zillo_pierce_skip_',         // handleZilloPierceCancel — engine resolver zillo_technique_pierce_cancel
  // Emitted via the shared sc-hand-protection.js offer helper using a dynamic
  // `${idPrefix}_open_`/`_skip_` template (idPrefix='sc_hh'), so the static
  // scan can't see them. Live emission verified in sc-hand-protection.js.
  'sc_hh_open_',
  'sc_hh_skip_',
  'sc_cc_open_',
  'sc_cc_skip_',
]);

function getRegistrations() {
  const src = readFileSync(HANDLERS_INDEX, 'utf8');
  const out = [];
  const re = /register\(\s*'([^']+)'\s*,\s*(handle\w+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ prefix: m[1], fnName: m[2] });
  }
  return out;
}

function walkJsFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip worktrees, node_modules, tests
      if (entry === 'node_modules' || entry.startsWith('.') || entry === 'worktrees') continue;
      walkJsFiles(full, acc);
    } else if (entry.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Find every customId prefix emitted in the source tree. Captures the
 * prefix portion of any literal string that looks like a customId
 * (snake_case ending with `_` before a template interpolation or close
 * quote). Covers:
 *   - setCustomId(`prefix_...`)
 *   - customId: `prefix_...` / customId: 'prefix_...'
 *   - cellPrefix: `prefix_...`        (space-picker factory pattern)
 *   - return `prefix_...`             (action-types customId factories)
 *   - prefix factory literals: return `${prefix}_` (escaped variants)
 */
function getEmittedPrefixes() {
  const files = walkJsFiles(path.join(ROOT, 'src'));
  files.push(path.join(ROOT, 'index.js'));
  const prefixes = new Set();
  // Backtick template literals beginning with snake_case prefix.
  // Matches `setCustomId(\`prefix_`, `customId: \`prefix_`, `cellPrefix: \`prefix_`,
  // `return \`prefix_`, `\`prefix_${...}\`` general template literals starting
  // with snake_case followed by underscore + interpolation.
  const reBacktick = /`([a-z][a-z0-9_]+_)\$\{/g;
  const reSetCustom = /(?:setCustomId\(|customId:\s*|cellPrefix:\s*|pickPrefix:\s*|prefix:\s*)`([a-z][a-z0-9_]+_?)`?/g;
  const reSingle = /(?:setCustomId\(|customId:\s*|cellPrefix:\s*|pickPrefix:\s*|prefix:\s*)'([a-z][a-z0-9_]+_)'/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let m;
    while ((m = reBacktick.exec(src)) !== null) prefixes.add(m[1]);
    while ((m = reSetCustom.exec(src)) !== null) prefixes.add(m[1]);
    while ((m = reSingle.exec(src)) !== null) prefixes.add(m[1]);
  }
  return prefixes;
}

const REGS = getRegistrations();
const EMITTED = getEmittedPrefixes();

describe('handler-emit parity', () => {
  it('handler registry yields registrations (sanity)', () => {
    assert.ok(REGS.length > 0, 'no register() calls found');
  });

  it('emitted prefix set is non-empty (sanity)', () => {
    assert.ok(EMITTED.size > 0, 'no customId prefixes extracted from src/');
  });

  for (const { prefix, fnName } of REGS) {
    if (EMIT_ALLOWLIST.has(prefix)) continue;
    it(`${prefix} (${fnName}) — at least one UI must emit this prefix`, () => {
      // A prefix is "emitted" if some literal customId starts with it,
      // i.e. an emitted-prefix exists that begins with `prefix`.
      const matched = [...EMITTED].some((emitted) => emitted.startsWith(prefix));
      assert.ok(matched,
        `Handler ${fnName} is registered for prefix '${prefix}' but no customId in src/ emits it. ` +
        `Either remove the register() call (dead code) or add a UI that emits this customId.`);
    });
  }
});
