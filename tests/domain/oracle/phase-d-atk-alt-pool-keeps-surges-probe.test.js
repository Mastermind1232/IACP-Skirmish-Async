/**
 * Phase-D probe: a DC figure attacking with an alternate attack pool
 * retains its own surge abilities unless the triggering ability blocks
 * them.
 *
 * PROBE-PD-ATK-004: CRR ATTACKS — "When a DC figure performs an attack
 *   using an alternate attack pool, they may still trigger their own
 *   surge abilities unless the triggering ability states otherwise."
 *
 * Implementation: `getAttackerSurgeAbilities(combat)` in
 *   `src/game/combat.js` reads the surge-ability set from the ATTACKER'S
 *   DC card, keyed on `combat.attackerDcName` (or, under Reverse
 *   Engineer, the defender's). The set has ONE opt-out: the explicit
 *   `combat.blockSurgeAbilities` flag (e.g. Tusken Cycler). The
 *   alternate-pool mechanism (`game.pendingOverrideAttackDice[msgId]`)
 *   only rewrites `attackInfo.dice` / `attackInfo.type` in
 *   `src/handlers/combat.js`; it never touches the DC-card surge set.
 *   Therefore an alternate-pool attack keeps the attacker's surges
 *   unless the triggering ability set `blockSurgeAbilities` (as Tusken
 *   Cycler does).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const G_CB_SRC = readFileSync(resolve(ROOT, 'src/game/combat.js'), 'utf8');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-ATK-004: alternate-pool attacks retain the attacker DC surge abilities by default', () => {
  it('004a: source — getAttackerSurgeAbilities reads surges keyed on attacker DC (not on dice pool)', () => {
    assert.match(G_CB_SRC,
      /export function getAttackerSurgeAbilities\(combat\) \{[\s\S]*?const surgeDcName = combat\.reverseEngineerActive \? \(combat\.defenderDcName \?\? combat\.attackerDcName\) : combat\.attackerDcName;[\s\S]*?const card = getDcEffect\(surgeDcName\);[\s\S]*?let base = card\?\.surgeAbilities \|\| \[\];/,
      'surge ability set must come from the DC card keyed on attacker name — CRR-ATK-004');
  });

  it('004b: source — the ONLY full opt-out is combat.blockSurgeAbilities (no dice-pool predicate)', () => {
    // blockSurgeAbilities suppresses the figure's NATIVE surges; Close and
    // Personal / Lightbow attach explicit replacement surges via
    // combat.bonusSurgeAbilities, which are the only thing returned when blocked.
    assert.match(G_CB_SRC,
      /if \(combat\.blockSurgeAbilities\) return \[\.\.\.\(combat\?\.bonusSurgeAbilities \|\| \[\]\)\];/,
      'blocking surge abilities must require the explicit blockSurgeAbilities flag — CRR-ATK-004');
    // There must be NO guard that returns an empty surge list based on alternate-pool / override state
    const fnBody = G_CB_SRC.match(/export function getAttackerSurgeAbilities\(combat\) \{[\s\S]*?^}/m);
    assert.ok(fnBody, 'function body must be locatable');
    assert.doesNotMatch(fnBody[0], /pendingOverrideAttackDice|attackInfo\.dice|alternate.*pool/,
      'surge-ability gathering must not consult alternate-pool state — CRR-ATK-004');
  });

  it('004c: source — the final surge list is base + doubles + bonus (all attacker-DC-derived)', () => {
    assert.match(G_CB_SRC,
      /const doubles = \(card\?\.doubleSurgeAbilities \|\| \[\]\)\.map\(\(k\) => `double:\$\{k\}`\);\s*\n\s*const bonus = combat\?\.bonusSurgeAbilities \|\| \[\];\s*\n\s*return \[\.\.\.base, \.\.\.doubles, \.\.\.bonus\];/,
      'surge-ability output must be a pure concatenation of attacker-DC-scoped lists — CRR-ATK-004');
  });

  it('004d: source — pendingOverrideAttackDice mutates attackInfo only (not the surge set)', () => {
    // The override-handling block touches attackInfo.{dice,range,attackType} and
    // pendingCombat flags, but never `combat.attackerDcName`, `card.surgeAbilities`,
    // or `combat.blockSurgeAbilities` (except when explicitly set by the override).
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by attacker
    // figureKey (_attackerFkEarly) instead of msgId.
    const ovBlock = H_CB_SRC.match(/const overrideDice = game\.pendingOverrideAttackDice\?\.\[_attackerFkEarly\];[\s\S]*?delete game\.pendingOverrideAttackDice\[_attackerFkEarly\];/);
    assert.ok(ovBlock, 'override block must be locatable');
    assert.doesNotMatch(ovBlock[0], /combat\.attackerDcName\s*=/,
      'override must not rewrite attackerDcName — CRR-ATK-004');
    assert.doesNotMatch(ovBlock[0], /card\.surgeAbilities/,
      'override must not directly mutate the DC surge-ability set — CRR-ATK-004');
  });

  it('004e: source — explicit opt-out path exists (Tusken Cycler wires blockSurgeAbilities via _pendingBlockSurgeAbilities)', () => {
    // The only code path in handlers/combat.js that sets blockSurgeAbilities
    // is the override-consumer itself, via the `blockSurgeAbilities` key on
    // the pending override. This is the "triggering ability states otherwise"
    // branch — opt-out is a POSITIVE signal from the triggering ability.
    assert.match(H_CB_SRC,
      /if \(overrideDice\.blockSurgeAbilities\) \{\s*\n\s*game\._pendingBlockSurgeAbilities = true;\s*\n\s*\}/,
      'override-level blockSurgeAbilities opt-out must be explicit — CRR-ATK-004');
  });
});
