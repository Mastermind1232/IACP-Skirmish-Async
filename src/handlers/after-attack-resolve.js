/**
 * Step-8 / after-attack-resolves window handlers.
 *
 * destruct 2026-05-08 spec: every step-8 effect (Blast, Cleave, Recover,
 * surge-conditions, after-resolve DC abilities, after-resolve CCs)
 * prompts the player rather than firing automatically. Multiple effects
 * fire in the player's chosen order. Each effect has its own button;
 * a Skip-this-effect button is offered for optional ones; a "Done"
 * button finishes the player's window.
 *
 * Window order:
 *   1. After main-target damage applies (step 7 done), enqueue eligible
 *      step-8 effects via enqueueAfterAttackEffect (see after-attack-queue.js).
 *   2. postAttackerPostResolveWindow — attacker clicks effects in any
 *      order; Done advances to defender window.
 *   3. postDefenderPostResolveWindow — defender resolves their own
 *      step-8 effects (Slippery, Force Deflection, Return Fire, etc.)
 *      and after-resolve CCs from hand.
 *   4. Defender Done → existing _finishCombatResolution closes combat.
 *
 * The fire handlers for each effect type (`fireRecover`, `fireBlast`,
 * `fireCleave`, `fireCondition`, ...) live in src/handlers/after-attack-fire.js
 * and are invoked from this module's button click router.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  enqueueAfterAttackEffect,
  getAfterAttackEffects,
  consumeAfterAttackEffect,
  hasPendingAfterAttackEffects,
  clearAfterAttackEffects,
} from '../engine/after-attack-queue.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchCombatThread } from '../discord/channel-helpers.js';
import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { parseCustomId } from '../discord/custom-id.js';
import { requireGame } from '../utils/guards.js';
import { fireEffect } from './after-attack-fire.js';

/**
 * Enqueue all step-8 effects pending for the attacker side based on
 * current combat state. Called after main-target damage applies.
 *
 * Reads combat fields written during steps 1-7:
 *   surgeRecover, surgeBlast/bonusBlast, surgeCleave/passiveCleave,
 *   bonusConditions, cleaveSources, etc.
 *
 * Per-DC after-resolve abilities (Tress Leg Hydraulics, Heavy Fire,
 * Cover Fire, Stalk Prey, ...) get enqueued here in follow-up commits;
 * for now the keyword effects (Blast, Cleave, Recover, conditions) are
 * the minimum-viable set so the button window has something to render.
 */
export function enqueueAttackerStep8Effects(combat) {
  if (!combat) return;
  const hit = combat._step7Hit ?? true;
  const damage = combat._step7Damage ?? 0;

  // Recover N — heal attacker. Sustained by Rage blocks own Recover.
  // (Blocked elsewhere; here we just enqueue if the keyword fired.)
  if ((combat.surgeRecover || 0) > 0 && combat.attackerMsgId != null) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'recover',
      label: `Recover ${combat.surgeRecover}`,
      payload: { amount: combat.surgeRecover },
    });
  }

  // Blast N — applies to figures adjacent to target's pre-defeat coord.
  // Only fires when attack hit AND main-target damage > 0 (CRR step 8).
  const totalBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
  if (hit && damage > 0 && totalBlast > 0) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'blast',
      label: `Apply Blast ${totalBlast}`,
      payload: { amount: totalBlast },
    });
  }

  // Cleave (one entry per accumulation site; multiple Cleaves resolve
  // in attacker's chosen order, CRR-CLV-005). cleaveSources holds the
  // list when populated by step-1/2; falls back to a single source for
  // the simple effectiveCleave path.
  if (hit && damage > 0) {
    const cleaveSources = Array.isArray(combat.cleaveSources) && combat.cleaveSources.length > 0
      ? combat.cleaveSources
      : ((combat.surgeCleave || 0) + (combat.passiveCleave || 0)) > 0
        ? [{ value: (combat.surgeCleave || 0) + (combat.passiveCleave || 0), label: `Cleave ${(combat.surgeCleave || 0) + (combat.passiveCleave || 0)}` }]
        : [];
    for (const src of cleaveSources) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'cleave',
        label: src.label || `Cleave ${src.value}`,
        payload: { amount: src.value, sourceLabel: src.label },
      });
    }
  }

  // Step-8 conditions: every surge / passive / CC condition becomes its
  // own button — attacker clicks to apply (or skips). Damage-gating +
  // recipient routing already happened in combat-bridge.js when
  // _step8Conditions was assembled. fireCondition handles immunity +
  // Fireproof + Punishing Strike at click time.
  const condList = Array.isArray(combat._step8Conditions) ? combat._step8Conditions : [];
  for (const entry of condList) {
    const cond = entry?.condition;
    if (!cond) continue;
    const recipient = entry.recipient || (cond === 'Focus' || cond === 'Hide' ? 'attacker' : 'target');
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'condition',
      label: `Apply ${cond}${recipient === 'attacker' ? ' (self)' : ''}`,
      payload: { condition: cond, recipient },
    });
  }
}

/**
 * Per-DC attacker-side after-resolve abilities. Reads attacker DC's
 * specialAbilityIds and enqueues a button per matching ability.
 *
 * Wired so far:
 *   - Leg Hydraulics (Tress Hacnua) — gain 1 MP
 * Pending follow-up commits: Stun Batons, Jets, Locked and Loaded,
 *   Open-Minded, Distracting Fire, Flame Trooper Incinerate, Stalk
 *   Prey, Cover Fire (CT-1701), Fighting Knife, Concussive Bolt,
 *   Spread the Pain, Fell Swoop, Sidewinder, Boltslinger,
 *   Indiscriminate Fire, Heavy Fire, Havoc Shot, Lure of the Dark
 *   Side, Defensive Fire, Dual-Wield Pistols, Bladestorm, Wanton
 *   Destruction (Saw).
 */
export function enqueueAttackerPerDcEffects(combat, game, deps) {
  if (!combat || !combat.attackerFigureKey) return;
  const getDcEffects = deps?.getDcEffects;
  if (!getDcEffects) return;
  const _atkDcName = combat.attackerDcName;
  const _atkEff = _atkDcName ? getDcEffects()?.[_atkDcName] : null;
  const _atkIds = _atkEff?.specialAbilityIds || [];
  // Leg Hydraulics (Tress Hacnua): "after resolving an attack, gain 1 MP"
  if (_atkIds.includes('leg_hydraulics_tress') && combat.attackerMsgId) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'leg_hydraulics',
      label: 'Leg Hydraulics: gain 1 MP',
    });
  }
  // Vader's Finest (Attack+Move special action): "after the attack
  // resolves, move up to 1 space" — Move-X picker, bypassCosts true.
  // Triggered by the per-msgId vadersFinestPostAttackMove flag set
  // when the special action button was clicked.
  if (combat.attackerMsgId && game?.vadersFinestPostAttackMove?.[combat.attackerMsgId]) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'vaders_finest_move',
      label: "Vader's Finest: move up to 1 space",
    });
    delete game.vadersFinestPostAttackMove[combat.attackerMsgId];
    if (Object.keys(game.vadersFinestPostAttackMove).length === 0) delete game.vadersFinestPostAttackMove;
  }
  // Stun Batons (Riot Trooper E/R attacker passive): on damage, target
  // suffers 1 Strain. Enqueue probe enabled 2026-05-09 alongside the
  // inline removal in combat-bridge.js. Routes through applyStrain so
  // Fireproof / Headhunter / Under Duress / when-damaged hooks fire.
  if (combat._step7Hit && combat._step7Damage > 0 && combat.attackerDcName && combat.target?.figureKey) {
    const _sbAttEff = getDcEffects?.()?.[combat.attackerDcName];
    if ((_sbAttEff?.passives || []).includes('Stun Batons')) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'stun_batons',
        label: 'Stun Batons: target suffers 1 Strain',
      });
    }
  }
  // Stalk Prey (CC, attacker side): triggered by combat.surgeStalkPrey
  // set when the CC was played. Hit-gated.
  if (combat.surgeStalkPrey && combat._step7Hit && combat.attackerMsgId && combat.attackerFigureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'stalk_prey',
      label: 'Stalk Prey: +2 MP + 1 Damage Token',
    });
  }
  // Burst Fire (Imperial Loadout): on damage, stun all figures adjacent
  // to the target (excluding target). Per-msgId pre-attack flag from
  // game.burstFirePendingMsgId; consumed by fireBurstFire.
  if (game?.burstFirePendingMsgId?.[combat.attackerMsgId] && combat._step7Hit && combat._step7Damage > 0) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'burst_fire',
      label: 'Burst Fire: Stun all adjacent to target',
    });
  }
  // Crippling Blow (Imperial Loadout): if attack didn't miss, stun the
  // defender. Hit-gated; damage not required.
  if (game?.cripplingBlowPending?.[combat.attackerMsgId] && combat._step7Hit && combat.target?.figureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'crippling_blow',
      label: 'Crippling Blow: Stun defender',
    });
  }
  // Disruptor Rifle (Imperial Loadout): if attack hit AND defender at
  // exactly 1 HP, deal 1 more damage (defeat). Eligibility re-checked at
  // fire time because step-8 effects may have lowered HP further.
  if (game?.disruptorRiflePending?.[combat.attackerMsgId] && combat._step7Hit && combat.target?.figureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'disruptor_rifle',
      label: 'Disruptor Rifle: Execute (1 HP)',
    });
  }
  // Electro-pulse (Electrohammer post-attack): each other figure adjacent
  // to the target's space suffers 1 Damage. Source PT excluded; target
  // included (CRR slice 6.11 destruct fix).
  if (combat.loadoutPostAttack === 'electro_pulse' && combat.target?.figureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'electro_pulse',
      label: 'Electro-pulse: 1 Damage to adjacent',
    });
  }
  // Quick Strike (Electrostaff post-attack): if defender modified dice
  // (rerolled, +1, etc.), defender suffers 1 Damage. Hit-gated.
  if (combat.loadoutPostAttack === 'quick_strike' && combat._step7Hit && combat.defenderRerolledOrModified && combat.target?.figureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'quick_strike',
      label: 'Quick Strike: 1 Damage to defender',
    });
  }
  // Tonfa Strike (Imperial Loadout): "after this attack, you may make
  // an additional attack." No prep besides the prompt; arms
  // freeAttackBonusPending. Per user spec the new attack must wait for
  // defender step 8 — fireTonfaStrike defers via combat._pendingChainAttacks.
  if (combat.attackerMsgId && game?.tonfaStrikeSecondAttack?.[combat.attackerMsgId]) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'tonfa_strike',
      label: '🗡️ Tonfa Strike: chain attack →',
    });
  }
  // Barrage (CT-1701): "after first attack, perform a second attack
  // (target within 3 of first; defender +1 white die)." Fire handler
  // stages target-window + defense bonus on combat.
  if (combat.attackerMsgId && game?.barrageSecondAttack?.[combat.attackerMsgId]) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'barrage',
      label: '🔫 Barrage: chain attack →',
    });
  }
  // Flurry of Blows (Electrobaton loadout post-attack): hit-gated.
  // 1-green-die melee with +1 Hit, once per activation. Fire handler
  // does dice override + chain-attack staging.
  if (combat.loadoutPostAttack === 'flurry_of_blows' && combat._step7Hit && combat.attackerMsgId) {
    const _fobKey = `flurryOfBlows_${combat.attackerMsgId}`;
    if (!game?.roundFigureAbilityUsed?.[_fobKey]) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'flurry_of_blows',
        label: '🥊 Flurry of Blows: chain attack →',
      });
    }
  }
  // Fell Swoop (Davith Elso): "After this attack resolves, become Hidden,
  // move up to 2 spaces, then perform an attack. Limit once per round."
  // The Move 2 picker fires on click; the new attack is staged for
  // after defender step 8 closes.
  if (combat.surgeFellSwoop && combat.attackerFigureKey) {
    const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
    if (!game?.roundFigureAbilityUsed?.[fsKey]) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'fell_swoop',
        label: '🗡️ Fell Swoop: Hide + Move 2 + chain attack →',
      });
    }
  }
  // Bladestorm (CC effect): after attack resolves, all hostiles within N
  // spaces of the attacker suffer N AoE damage. Triggered by combat.postAttackAoeDamage > 0.
  if (combat.postAttackAoeDamage > 0 && combat._step7Hit && combat.attackerFigureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'bladestorm',
      label: `Bladestorm: AoE ${combat.postAttackAoeDamage} damage`,
    });
  }
  // Wild Fury (post-activation conditions): after the attacker's final
  // free attack of the chain, apply Stun + Bleed to attacker figure.
  if (combat.attackerMsgId && Array.isArray(game?.pendingPostAttackConditions?.[combat.attackerMsgId]) && game.pendingPostAttackConditions[combat.attackerMsgId].length > 0 && combat.attackerFigureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'wild_fury',
      label: 'Wild Fury: Apply post-activation conditions',
    });
  }
  // Sidewinder (Jyn Odan): "after this attack, suffer 1 Strain to move
  // up to 2 spaces. Limit once per round." Fire handler posts the
  // existing yes/skip prompt; handleSidewinderApply handles the rest.
  if (_atkIds.includes('sidewinder') && combat.attackerMsgId && combat.attackerFigureKey) {
    const swKey = combat.attackerFigureKey + '_sidewinder';
    if (!game?.roundFigureAbilityUsed?.[swKey]) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'sidewinder',
        label: 'Sidewinder: 1 Strain → Move 2',
      });
    }
  }
  // Boltslinger (Vinto Hreeda): always enqueued when the ability is on
  // the attacker DC; eligibility (within-3 hostiles) is re-checked at
  // fire time and the fire handler returns early if no targets.
  if (_atkIds.includes('boltslinger') && combat.attackerFigureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'boltslinger',
      label: 'Boltslinger: 1 Damage to nearby hostile',
    });
  }
  // Indiscriminate Fire (Bossk): hit-gated. Eligibility deeper checks
  // (non-red dice exist + adjacent figures) re-validated at fire time.
  if (_atkIds.includes('indiscriminate_fire') && combat._step7Hit && combat.target?.figureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'indiscriminate_fire',
      label: 'Indiscriminate Fire: splash from non-red die',
    });
  }
  // Heavy Fire (Skirmish Upgrade, army-wide): the [Heavy Fire] DC must
  // be in the army and not exhausted, attacker must be VEHICLE or
  // HEAVY WEAPON. fireHeavyFire re-validates and returns early otherwise.
  if (combat.attackerDcName && combat.attackerFigureKey) {
    const _hfDcList = deps?.getDcList?.(game, combat.attackerPlayerNum) || [];
    if (_hfDcList.some((dc) => dc?.dcName === '[Heavy Fire]')) {
      enqueueAfterAttackEffect(combat, {
        side: 'attacker',
        type: 'heavy_fire',
        label: 'Heavy Fire: 1 Damage to N hostiles',
      });
    }
  }
  // Havoc Shot (Fenn Signis): hit-gated. Eligibility (LOS to splash
  // candidates) re-validated at fire time.
  if (_atkIds.includes('havoc_shot') && combat._step7Hit && combat.target?.figureKey) {
    enqueueAfterAttackEffect(combat, {
      side: 'attacker',
      type: 'havoc_shot',
      label: 'Havoc Shot: 1 Strain → splash up to 2',
    });
  }
}

/**
 * Enqueue defender-side step-8 effects. Called when attacker's window
 * closes (Done). Each defender after-resolve ability gets a button.
 * Reads game/combat state to detect eligibility — this runs after
 * step-7 damage has already applied, so it sees the post-damage
 * board state.
 *
 * Per destruct 2026-05-08: nothing auto. If an ability fires today,
 * its enqueue check belongs here and its inline auto-apply in
 * combat-bridge.js should be removed.
 *
 * Wired so far:
 *   - Slippery (Alliance Smuggler E/R)
 * Pending follow-up commits:
 *   - Force Deflection (Yoda), Return Fire (Han / Migs),
 *     Deflect (Luke JK), and the Deflection CC from defender hand.
 */
export function enqueueDefenderStep8Effects(combat, game, deps) {
  if (!combat || !combat.target?.figureKey) return;
  const getDcEffects = deps?.getDcEffects;
  const findDcMessageIdForFigure = deps?.findDcMessageIdForFigure;
  if (!getDcEffects || !findDcMessageIdForFigure) return;
  const dcNameFromFigureKey = deps.dcNameFromFigureKey;
  const _slipDcName = dcNameFromFigureKey?.(combat.target.figureKey);
  const _slipEff = _slipDcName ? getDcEffects()?.[_slipDcName] : null;
  const _slipIds = _slipEff?.specialAbilityIds || [];
  if (_slipIds.includes('slippery_smuggler_elite') || _slipIds.includes('slippery_smuggler_reg')) {
    const _slipMsgId = findDcMessageIdForFigure(game.gameId, combat.defenderPlayerNum ?? null, combat.target.figureKey);
    if (_slipMsgId) {
      enqueueAfterAttackEffect(combat, {
        side: 'defender',
        type: 'slippery',
        label: 'Slippery: gain 2 MP',
        payload: {
          msgId: _slipMsgId,
          defenderDcName: _slipDcName,
          figureKey: combat.target.figureKey,
          playerNum: combat.defenderPlayerNum ?? null,
          threadId: combat.combatThreadId,
        },
      });
    }
  }
}

/**
 * Render and post the post-resolve window for one side. Each pending
 * effect for that side gets a Primary button with its label; a Done
 * button finishes the window. If the queue is empty for this side,
 * skips the prompt and advances directly.
 */
export async function postPostResolveWindow(thread, game, combat, side, ctx) {
  if (!combat) return;
  // Auto-drain conditions:
  //   - selfPlay (live Discord bot-vs-bot games)
  //   - !thread (no Discord thread to post into)
  //   - fake client (headless oracle/fixture tests)
  // Live human games keep the buttons + require a Done click.
  if (game.selfPlay || !thread || ctx?.client?._isFakeClient) {
    // Snapshot the queue for this side before drain consumes it.
    // Oracle/headless tests inspect combat._step8Snapshot[side] to verify
    // what would have been offered as buttons; live play never reads it.
    combat._step8Snapshot = combat._step8Snapshot || {};
    combat._step8Snapshot[side] = getAfterAttackEffects(combat, side).map((e) => ({ ...e }));
    await _selfPlayDrain(thread, game, combat, side, ctx);
    return;
  }
  // destruct 2026-05-08: window must NEVER auto-advance even when the
  // queue is empty for this side — the player needs the chance to
  // play after-attack CCs from hand and then press Done. Always post
  // at least a Done button.
  const ownerPN = side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = getPlayerId(game, ownerPN);
  const effects = getAfterAttackEffects(combat, side);
  const buttons = effects.slice(0, 24).map((eff) =>
    new ButtonBuilder()
      .setCustomId(`aar_fire_${game.gameId}_${eff.id}`)
      .setLabel(eff.label.slice(0, 80))
      .setStyle(ButtonStyle.Primary),
  );
  // Two literal customId variants so the handler-emit parity scanner
  // can find both `aar_done_atk_` and `aar_done_def_` prefixes in src/.
  const _doneId = side === 'attacker'
    ? `aar_done_atk_${game.gameId}`
    : `aar_done_def_${game.gameId}`;
  buttons.push(
    new ButtonBuilder()
      .setCustomId(_doneId)
      .setLabel('Done (skip remaining)')
      .setStyle(ButtonStyle.Secondary),
  );
  // Discord caps a row at 5 buttons; chunk into rows of 5.
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }
  const sideLabel = side === 'attacker' ? 'Attacker' : 'Defender';
  const mention = ownerId ? `<@${ownerId}> ` : '';
  await withDiscordRetry(() => thread.send({
    content: `${mention}**After Attack Resolves — ${sideLabel}:** click any pending effect to apply it (any order). Click **Done** when finished.`,
    components: rows.slice(0, 5),
    allowedMentions: ownerId ? { users: [ownerId] } : undefined,
  }));
}

/**
 * Click handler for `aar_fire_<gameId>_<effectId>` — fires the effect
 * via fireEffect (after-attack-fire.js), removes it from the queue,
 * and re-renders the window with remaining buttons.
 */
export async function handleAarFire(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^aar_fire_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, effectId] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) return;
  // Disable buttons on the source message — prevents double-clicks.
  try {
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch { /* non-fatal */ }
  const effect = consumeAfterAttackEffect(combat, effectId);
  if (!effect) return;
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (!thread) return;
  // Permission: only the side's owner may click their button.
  const ownerPN = effect.side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = getPlayerId(game, ownerPN);
  if (ownerId && interaction.user.id !== ownerId && !game.isTestGame) {
    // Not the right player — re-enqueue the effect so the rightful
    // owner can still click it.
    enqueueAfterAttackEffect(combat, effect);
    saveGames?.(game.gameId);
    return;
  }
  await fireEffect(thread, game, combat, effect, ctx);
  // After firing, re-post the window so the player can fire more
  // pending effects, play after-attack CCs from hand, or click Done.
  // destruct 2026-05-08: never auto-advance — Done is mandatory.
  await postPostResolveWindow(thread, game, combat, effect.side, ctx);
  saveGames?.(game.gameId);
}

/**
 * Click handler for `aar_done_atk_<gameId>` and `aar_done_def_<gameId>`.
 * The owning side has chosen to skip all remaining (optional) effects.
 * Drain that side's queue without firing, then advance.
 */
export async function handleAarDone(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isAtk = interaction.customId.startsWith('aar_done_atk_');
  const side = isAtk ? 'attacker' : 'defender';
  const gameId = parseCustomId(interaction.customId, isAtk ? 'aar_done_atk_' : 'aar_done_def_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) return;
  // Disable buttons on the source message.
  try {
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch { /* non-fatal */ }
  const ownerPN = side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = getPlayerId(game, ownerPN);
  if (ownerId && interaction.user.id !== ownerId && !game.isTestGame) return;
  // Drain remaining effects on this side. Skipped effects do NOT fire.
  const remaining = getAfterAttackEffects(combat, side);
  for (const e of remaining) consumeAfterAttackEffect(combat, e.id);
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (thread) await _advanceFromSide(thread, game, combat, side, ctx);
  saveGames?.(game.gameId);
}

/**
 * Internal: advance from one side's window to the next. After
 * attacker → enqueue defender effects + post defender window. After
 * defender → run existing combat-close cleanup.
 */
async function _advanceFromSide(thread, game, combat, side, ctx) {
  if (side === 'attacker') {
    enqueueDefenderStep8Effects(combat, game, ctx);
    await postPostResolveWindow(thread, game, combat, 'defender', ctx);
    return;
  }
  // Defender done — close combat. Caller passes the existing
  // _finishCombatResolution handle through ctx.afterAttackClose.
  clearAfterAttackEffects(combat);
  if (typeof ctx.afterAttackClose === 'function') {
    await ctx.afterAttackClose(thread, game, combat);
  }
}

/**
 * Self-play: fire each pending effect with the auto-pick path, then
 * advance. Used by headless training so the bot never stalls waiting
 * for a button click.
 */
async function _selfPlayDrain(thread, game, combat, side, ctx) {
  while (hasPendingAfterAttackEffects(combat, side)) {
    const effects = getAfterAttackEffects(combat, side);
    const eff = effects[0];
    consumeAfterAttackEffect(combat, eff.id);
    await fireEffect(thread, game, combat, eff, ctx);
  }
  await _advanceFromSide(thread, game, combat, side, ctx);
}
