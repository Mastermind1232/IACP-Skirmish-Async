/**
 * EoA pipeline coverage — every end-of-activation ability must have a home.
 *
 * This is the re-audit made executable. The window-1 inventory was swept from
 * docs/combat-spec.csv by hand on 2026-08-12; hand sweeps rot the moment
 * someone adds a row. This asserts the mapping instead.
 *
 * Every `end_of_activation` row in the spec must be exactly one of:
 *
 *   DESCRIPTOR   enumerated in eoa-orchestrator.js and resolved by the chooser
 *   CC_WINDOW    an optional Command Card play from hand — deliberately NOT a
 *                descriptor (a descriptor would prompt every activation), held
 *                open instead by the eoa_cc_window placeholder
 *   TERMINATION  automatic, not a choice, so it correctly runs in the teardown
 *                continuation AFTER the window closes
 *
 * A new row in none of those categories fails this test, which is the point:
 * the failure mode being guarded against is an ability that quietly resolves
 * after teardown, which is how Force Surge, Blaze of Glory, Son of Skywalker and
 * the Clan of Two placement were all broken.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');

function specRows() {
  const raw = read('docs/combat-spec.csv').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const iCard = head.indexOf('card');
  const iAbility = head.indexOf('ability');
  const iTiming = head.indexOf('timing');
  return lines.slice(1).map((l) => {
    const f = l.split(',');
    return { card: f[iCard], ability: f[iAbility], timing: f[iTiming] };
  });
}

/** Explicit classification for everything that is NOT a wired descriptor. */
const CC_WINDOW = new Set(['Force Surge', 'Rebel Graffiti']);
const TERMINATIONS = new Map([
  ['Wild Fury', 'queued conditions applied automatically at end of activation; no choice, so it belongs after the window'],
]);

/** CSV card/ability -> the subPromptKey that resolves it. */
const DESCRIPTOR_FOR = new Map([
  ['0-0-0|Unnerving', 'unnerving'],
  ['Baze Malbus|Hold the Line', 'hold_the_line'],
  ['ISB Infiltrator (Elite)|In The Shadows', 'in_the_shadows'],
  ['Riot Trooper (Elite)|Shield', 'shield'],
  ['Riot Trooper (Regular)|Shield', 'shield'],
  ['Jyn Erso|Trust Goes Both Ways', 'trust_both_ways_eoa'],
  ['[Clan of Two]|[Clan of Two]', 'clan_of_two_teleport'],
  ['[On a Diplomatic Mission]|On a Diplomatic Mission', 'diplomatic_mission'],
]);

describe('EoA pipeline coverage', () => {
  const orchestrator = read('src/game/eoa-orchestrator.js');
  const handler = read('src/handlers/eoa-handler.js');
  const rows = specRows().filter((r) => r.timing === 'end_of_activation');

  test('the spec still has window-1 rows to check', () => {
    assert.ok(rows.length >= 10, `expected the window-1 inventory, got ${rows.length}`);
  });

  test('every end_of_activation ability is descriptor, CC-window or termination', () => {
    const unclassified = [];
    for (const r of rows) {
      const key = `${r.card}|${r.ability}`;
      if (DESCRIPTOR_FOR.has(key)) continue;
      if (CC_WINDOW.has(r.card)) continue;
      if (TERMINATIONS.has(r.card)) continue;
      unclassified.push(key);
    }
    assert.deepStrictEqual([...new Set(unclassified)], [],
      'these end-of-activation abilities have no home in the window. Wire a descriptor in '
      + 'eoa-orchestrator.js, or classify it here as CC_WINDOW / TERMINATION with the reason. '
      + 'Leaving one unclassified means it resolves after teardown, which is how Force Surge and '
      + 'the Clan of Two placement were broken.');
  });

  test('every mapped descriptor is actually enumerated AND resolvable', () => {
    for (const [key, subPromptKey] of DESCRIPTOR_FOR) {
      assert.ok(orchestrator.includes(`'${subPromptKey}'`),
        `${key}: eoa-orchestrator.js never enumerates ${subPromptKey}`);
      const resolvable = handler.includes(`'${subPromptKey}'`)
        || handler.includes('EOA_AUTO_APPLY_KEYS');
      assert.ok(resolvable, `${key}: eoa-handler.js cannot resolve ${subPromptKey}`);
    }
  });

  test('the companion hand-off is enumerated even though it has no spec row', () => {
    // It is an ordering affordance rather than a card ability, so it will never
    // appear in combat-spec.csv. Asserted separately so it cannot be dropped.
    assert.match(orchestrator, /subPromptKey: 'companion_activate'/);
    assert.match(handler, /desc\.subPromptKey === 'companion_activate'/);
  });

  test('every descriptor branch consumes, so no pick can strand the activation', () => {
    // A branch that posts a prompt and returns WITHOUT consuming leaves the
    // bucket open forever, and teardown is deferred behind it since slice 1.
    for (const key of ['clan_of_two_teleport', 'companion_activate', 'diplomatic_mission', 'eoa_cc_window']) {
      const idx = handler.indexOf(`desc.subPromptKey === '${key}'`);
      assert.ok(idx > 0, `${key} branch missing`);
      const branch = handler.slice(idx, idx + 2400);
      const consumes = /consumeDescriptor\(game, desc\.id\)/.test(branch)
        || /eoa_fire_/.test(branch); // fire path consumes downstream
      assert.ok(consumes, `${key} neither consumes nor routes to a fire button — it can strand`);
    }
  });
});
