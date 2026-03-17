/**
 * Universal figure defeat handler.
 *
 * Single source of truth for the common defeat sequence. Every code path
 * that defeats a figure (combat, Blast, Cleave, Strain, NPC damage, etc.)
 * should call this instead of inlining the steps.
 *
 * Handles:
 *  1. Remove position + conditions + device tokens
 *  2. Calculate and award VP (companion guard via calculateKillVp)
 *  3. Log defeat
 *  4. Decrement activation counter if group fully defeated
 *  5. Clear CC attachments for the defeated DC
 *  6. Check passive CC redraws (Shared Experience, etc.)
 *  7. Check Nefarious Gains (Jabba VP)
 *  8. Check Hunt Dissent (Kallus block token)
 *  8b. Check Heroic Effort (draw/return CC on unique defeat)
 *  9. Check win conditions
 *
 * Does NOT handle combat-specific post-defeat abilities (Last Stand,
 * Vengeance, Celebration, reaction card prompts, etc.) — those belong
 * in the combat code and should run AFTER calling this function.
 *
 * @param {object} game
 * @param {object} opts
 * @param {number} opts.defeatedPlayerNum   - player who owns the defeated figure
 * @param {string} opts.figureKey           - e.g. 'Imperial Officer-0-0'
 * @param {number} opts.attackerPlayerNum   - player who caused the defeat (for VP)
 * @param {string|null} [opts.attackerFigureKey] - for Hunt Dissent; null if N/A
 * @param {string|null} [opts.msgId]        - DC message ID (for CC attachments)
 * @param {number}      [opts.dcIdx=-1]     - index in dcList (for activation decrement)
 * @param {string|null} [opts.dcName]       - DC name; derived from figureKey if omitted
 * @param {string|null} [opts.displayName]  - for logging; defaults to dcName
 * @param {string}      [opts.source]       - defeat source label (e.g. 'Blast', 'Strain')
 * @param {boolean}     [opts.awardVp=true] - false for self-inflicted (Adrenaline)
 * @param {object} deps - required dependencies (see destructuring below)
 * @returns {{ vp: number, dcName: string }}
 */
import { getDcEffects } from '../data-loader.js';
import { getDcList, getDcMessageIds, ccHandKey, ccDeckKey, getHandChannelId, dcAttachmentsKey } from '../game/player-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';

export async function processFigureDefeat(game, opts, deps) {
  const {
    defeatedPlayerNum,
    figureKey,
    attackerPlayerNum,
    attackerFigureKey = null,
    msgId: msgIdOpt = null,
    dcIdx: dcIdxOpt = -1,
    dcName: dcNameOpt = null,
    displayName: displayNameOpt = null,
    source = '',
    awardVp = true,
  } = opts;

  const {
    removeFigurePosition,
    calculateKillVp,
    awardKillVp,
    dcNameFromFigureKey,
    logGameAction,
    client,
    // Activation + attachment cleanup
    decrementActivationIfGroupDefeated,
    ccAttachmentsKey,
    updateAttachmentMessageForDc,
    // Post-defeat checks
    checkFriendlyDefeatedPassiveRedraws,
    checkNefariousGains,
    checkHuntDissent,
    checkWinConditions,
    // Optional: for auto-resolving msgId/dcIdx when not provided
    findDcMessageIdForFigure: findMsgId,
    dcMessageMeta,
  } = deps;

  const dcName = dcNameOpt || dcNameFromFigureKey(figureKey);
  const displayName = displayNameOpt || dcName;

  // Auto-resolve msgId and dcIdx when not provided by caller
  let msgId = msgIdOpt;
  let dcIdx = dcIdxOpt;
  if ((!msgId || dcIdx < 0) && findMsgId && dcMessageMeta) {
    if (!msgId) msgId = findMsgId(game.gameId, defeatedPlayerNum, figureKey, dcMessageMeta);
    if (msgId && dcIdx < 0) {
      const dcIds = getDcMessageIds(game, defeatedPlayerNum);
      dcIdx = (dcIds || []).indexOf(msgId);
    }
  }

  // 1. Remove position + conditions + device tokens
  removeFigurePosition(game, defeatedPlayerNum, figureKey);

  // 2. Calculate and award VP
  let vp = 0;
  if (awardVp) {
    vp = calculateKillVp(dcName);
    if (vp > 0) awardKillVp(game, attackerPlayerNum, vp);
  }

  // 3. Log defeat
  const vpText = vp > 0 ? ` (+${vp} VP to P${attackerPlayerNum})` : '';
  const prefix = source ? `${source}: ` : '';
  await logGameAction(game, client,
    `${prefix}**${displayName}** was defeated!${vpText}`,
    { phase: 'ROUND', icon: 'attack' });

  // 4. Decrement activation if group fully defeated
  if (dcIdx >= 0 && decrementActivationIfGroupDefeated) {
    await decrementActivationIfGroupDefeated(game, defeatedPlayerNum, dcIdx, client);
  }

  // 5. Clear CC attachments
  if (msgId && dcIdx >= 0 && ccAttachmentsKey && updateAttachmentMessageForDc) {
    const key = ccAttachmentsKey(defeatedPlayerNum);
    if (game[key]?.[msgId]?.length) {
      delete game[key][msgId];
      await updateAttachmentMessageForDc(game, defeatedPlayerNum, msgId, client);
    }
  }

  // 6. Passive CC redraws (Shared Experience, etc.)
  if (checkFriendlyDefeatedPassiveRedraws) {
    const result = checkFriendlyDefeatedPassiveRedraws(game, defeatedPlayerNum, dcName);
    for (const card of result.redrawn) {
      await logGameAction(game, client,
        `**Passive Redraw** — **${card}** re-drawn from discard (friendly **${dcName}** defeated).`,
        { phase: 'ROUND', icon: 'card' });
    }
  }

  // 7. Nefarious Gains (Jabba: gain 1 VP when hostile defeated)
  if (checkNefariousGains) {
    await checkNefariousGains(game, defeatedPlayerNum, client);
  }

  // 8. Hunt Dissent (Kallus: gain Block token when hostile defeated)
  if (attackerFigureKey && checkHuntDissent) {
    await checkHuntDissent(game, attackerPlayerNum, attackerFigureKey, client);
  }

  // 8b. Heroic Effort: when unique figure defeated, owner draws 1 CC + must return 1 to deck bottom
  {
    const dcList = getDcList(game, defeatedPlayerNum) || [];
    const hasHeroicEffort = dcList.some(dc => (dc.dcName || dc) === '[Heroic Effort]');
    if (hasHeroicEffort) {
      const dcEff = getDcEffects();
      const effEntry = dcEff?.[dcName] || dcEff?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (effEntry?.unique) {
        const hKey = ccHandKey(defeatedPlayerNum);
        const dKey = ccDeckKey(defeatedPlayerNum);
        const deck = game[dKey] || [];
        if (deck.length > 0) {
          const drawn = deck.shift();
          game[hKey] = [...(game[hKey] || []), drawn];
          game[dKey] = deck;
          await logGameAction(game, client,
            `**Heroic Effort** — Drew 1 Command card (unique **${dcName}** defeated). Must return 1 card to deck bottom.`,
            { phase: 'ROUND', icon: 'card' });
          // Set pending state for the return-card-to-deck-bottom interaction
          game.pendingHeroicEffortReturn = game.pendingHeroicEffortReturn || {};
          game.pendingHeroicEffortReturn[defeatedPlayerNum] = true;
          // Send pick buttons to hand channel
          const handChId = getHandChannelId(game, defeatedPlayerNum);
          if (handChId && client) {
            try {
              const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
              const hand = game[hKey] || [];
              const btns = hand.slice(0, 25).map((card, idx) =>
                new ButtonBuilder()
                  .setCustomId(`heroic_effort_return_${game.gameId}_${defeatedPlayerNum}_${idx}`)
                  .setLabel(String(card).length > 80 ? String(card).slice(0, 77) + '...' : String(card))
                  .setStyle(ButtonStyle.Primary)
              );
              const rows = [];
              for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
              const handCh = await client.channels.fetch(handChId);
              await handCh.send({
                content: '**Heroic Effort** — Choose 1 Command card from your hand to place on the bottom of your deck:',
                components: rows.slice(0, 5),
              });
            } catch (err) {
              console.error('Heroic Effort return buttons error:', err);
            }
          }
        }
      }
    }
  }

  // 8c. Scavenged Weaponry: when group fully defeated, offer transfer to another friendly Droid/Vehicle
  if (msgId) {
    const attKey = dcAttachmentsKey(defeatedPlayerNum);
    const attachments = game[attKey]?.[msgId] || [];
    if (cardNameIncludes(attachments, 'Scavenged Weaponry')) {
      // Check if group is fully defeated (no more figures of this DC on board)
      const figPos = game.figurePositions?.[defeatedPlayerNum] || {};
      const groupAlive = Object.keys(figPos).some(fk => fk.startsWith(dcName + '-') && figPos[fk]);
      if (!groupAlive) {
        const dcEff = getDcEffects();
        const dcListArr = getDcList(game, defeatedPlayerNum) || [];
        const dcMsgIds = getDcMessageIds(game, defeatedPlayerNum) || [];
        // Find eligible Droid/Vehicle groups (alive, not the defeated group)
        const eligible = [];
        for (let i = 0; i < dcListArr.length; i++) {
          const dc = dcListArr[i];
          const dn = dc?.dcName || dc;
          if (dn === dcName) continue; // same DC
          if (/^\[.+\]$/.test(dn)) continue; // skip upgrades
          const eff = dcEff?.[dn];
          const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
          if (!kws.includes('DROID') && !kws.includes('VEHICLE')) continue;
          // Check if group has at least one alive figure
          const hasFigure = Object.keys(figPos).some(fk => fk.startsWith(dn + '-') && figPos[fk]);
          if (!hasFigure) continue;
          eligible.push({ dcName: dn, displayName: dc?.displayName || dn, msgId: dcMsgIds[i] });
        }
        if (eligible.length > 0) {
          // Remove from old group, set pending state
          const idx = attachments.indexOf('Scavenged Weaponry');
          attachments.splice(idx, 1);
          game[attKey][msgId] = attachments;
          if (eligible.length === 1) {
            // Auto-transfer to only option
            const target = eligible[0];
            game[attKey][target.msgId] = [...(game[attKey][target.msgId] || []), 'Scavenged Weaponry'];
            await logGameAction(game, client,
              `**Scavenged Weaponry** — Transferred from defeated **${dcName}** to **${target.displayName}**.`,
              { phase: 'ROUND', icon: 'card' });
          } else {
            // Multiple options — send picker buttons to hand channel
            game.pendingScavengedWeaponryTransfer = { playerNum: defeatedPlayerNum, eligible };
            const handChId = getHandChannelId(game, defeatedPlayerNum);
            if (handChId && client) {
              try {
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
                const btns = eligible.slice(0, 10).map((e, i) =>
                  new ButtonBuilder()
                    .setCustomId(`scav_weapon_transfer_${game.gameId}_${defeatedPlayerNum}_${i}`)
                    .setLabel(e.displayName.length > 80 ? e.displayName.slice(0, 77) + '...' : e.displayName)
                    .setStyle(ButtonStyle.Primary)
                );
                const rows = [];
                for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
                const handCh = await client.channels.fetch(handChId);
                await handCh.send({
                  content: `**Scavenged Weaponry** — **${dcName}** was defeated. Choose a friendly Droid/Vehicle to transfer it to:`,
                  components: rows.slice(0, 5),
                });
              } catch (err) {
                console.error('Scavenged Weaponry transfer buttons error:', err);
              }
            }
          }
        }
      }
    }
  }

  // 9. Check win conditions
  if (checkWinConditions) {
    await checkWinConditions(game, client);
  }

  return { vp, dcName };
}
