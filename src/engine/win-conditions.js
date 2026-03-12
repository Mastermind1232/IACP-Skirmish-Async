/**
 * Win condition functions extracted from index.js.
 * Handles VP checks, tiebreakers, game-over posting, and defeat-related bookkeeping.
 */

/**
 * Check if either player has reached 40 VP or been eliminated.
 * @param {object} game
 * @param {object} client - Discord client
 * @param {object} deps
 * @returns {Promise<{ ended: boolean, winnerId?: string, reason?: string }>}
 */
export async function checkWinConditions(game, client, deps) {
  const crateBonus = deps.getCrateDeploymentVpBonus(game);
  const patronBonus = deps.getAnchorheadPatronVpBonus(game);
  const vp1 = (game.player1VP?.total ?? 0) + crateBonus.p1 + patronBonus.p1;
  const vp2 = (game.player2VP?.total ?? 0) + crateBonus.p2 + patronBonus.p2;
  const p1Figures = Object.keys(game.figurePositions?.[1] || {}).length;
  const p2Figures = Object.keys(game.figurePositions?.[2] || {}).length;

  if (vp1 >= 40 || vp2 >= 40) {
    if (vp1 !== vp2) {
      // Clear winner by VP total
      const winnerId = vp1 > vp2 ? game.player1Id : game.player2Id;
      const reason = vp1 >= 40 && vp2 >= 40 ? `40 VP (${vp1} vs ${vp2})` : '40 VP';
      await deps.postGameOver(game, client, winnerId, reason);
      return { ended: true, winnerId, reason };
    }
    // VP tied — run tiebreakers
    const { winnerId, reason } = await resolveVpTiebreaker(game, client, vp1, deps);
    await deps.postGameOver(game, client, winnerId, reason);
    return { ended: true, winnerId, reason };
  }
  if (p1Figures === 0 && p2Figures === 0) {
    await deps.postGameOver(game, client, null, 'draw (both eliminated)');
    return { ended: true, winnerId: null, reason: 'draw' };
  }
  if (p1Figures === 0 || p2Figures === 0) {
    const winnerId = p1Figures === 0 ? game.player2Id : game.player1Id;
    const reason = 'elimination';
    await deps.postGameOver(game, client, winnerId, reason);
    return { ended: true, winnerId, reason };
  }
  return { ended: false };
}

/**
 * Resolve a VP tie when both players reach 40+ VP with the same total.
 * Tiebreaker order:
 *   1. Player with more kill VP wins
 *   2. Player with less total damage received wins
 *   3. Roll a blue die — higher accuracy wins (re-roll on tie)
 * @returns {Promise<{ winnerId: string, reason: string }>}
 */
export async function resolveVpTiebreaker(game, client, tiedVp, deps) {
  const kills1 = game.player1VP?.kills ?? 0;
  const kills2 = game.player2VP?.kills ?? 0;

  // Tiebreaker 1: kill VP
  if (kills1 !== kills2) {
    const winnerId = kills1 > kills2 ? game.player1Id : game.player2Id;
    const reason = `VP tiebreaker: kill VP (${kills1} vs ${kills2}), tied at ${tiedVp} VP`;
    await deps.logGameAction(game, client, `VP tied at **${tiedVp}**. Tiebreaker 1 — **Kill VP**: P1 ${kills1} vs P2 ${kills2}. **<@${winnerId}> wins!**`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [winnerId] } });
    return { winnerId, reason };
  }

  // Tiebreaker 2: total damage received (lower wins)
  const dmg1 = game.totalDamageReceived?.[1] ?? 0;
  const dmg2 = game.totalDamageReceived?.[2] ?? 0;
  if (dmg1 !== dmg2) {
    const winnerId = dmg1 < dmg2 ? game.player1Id : game.player2Id;
    const reason = `VP tiebreaker: damage received (${dmg1} vs ${dmg2}), tied at ${tiedVp} VP`;
    await deps.logGameAction(game, client, `VP tied at **${tiedVp}**. Kill VP tied (${kills1} each). Tiebreaker 2 — **Total damage received**: P1 ${dmg1} vs P2 ${dmg2} (lower wins). **<@${winnerId}> wins!**`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [winnerId] } });
    return { winnerId, reason };
  }

  // Tiebreaker 3: roll blue die (higher accuracy wins, re-roll on tie)
  await deps.logGameAction(game, client, `VP tied at **${tiedVp}**. Kill VP tied (${kills1} each). Damage received tied (${dmg1} each). Tiebreaker 3 — **Blue die roll-off!**`, { phase: 'ROUND', icon: 'round' });

  const blueFaces = deps.getDiceData().attack?.blue;
  if (!blueFaces?.length) {
    // Fallback: should never happen, but default to player 1 if dice data missing
    return { winnerId: game.player1Id, reason: `VP tiebreaker: blue die (dice data unavailable), tied at ${tiedVp} VP` };
  }

  let attempts = 0;
  const maxAttempts = 20; // safety limit to prevent infinite loop
  while (attempts < maxAttempts) {
    attempts++;
    const face1 = blueFaces[Math.floor(Math.random() * blueFaces.length)];
    const face2 = blueFaces[Math.floor(Math.random() * blueFaces.length)];
    const acc1 = face1.acc ?? 0;
    const acc2 = face2.acc ?? 0;

    if (acc1 !== acc2) {
      const winnerId = acc1 > acc2 ? game.player1Id : game.player2Id;
      const reason = `VP tiebreaker: blue die roll (${acc1} vs ${acc2} accuracy), tied at ${tiedVp} VP`;
      await deps.logGameAction(game, client, `Blue die roll-off (attempt ${attempts}): P1 rolled **${acc1} accuracy**, P2 rolled **${acc2} accuracy**. **<@${winnerId}> wins!**`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [winnerId] } });
      return { winnerId, reason };
    }
    await deps.logGameAction(game, client, `Blue die roll-off (attempt ${attempts}): P1 rolled **${acc1} accuracy**, P2 rolled **${acc2} accuracy** — tied, re-rolling...`, { phase: 'ROUND', icon: 'round' });
  }

  // Extremely unlikely: 20 ties in a row — pick randomly
  const winnerId = Math.random() < 0.5 ? game.player1Id : game.player2Id;
  const reason = `VP tiebreaker: blue die (random after ${maxAttempts} tied rolls), tied at ${tiedVp} VP`;
  await deps.logGameAction(game, client, `Blue die roll-off: ${maxAttempts} consecutive ties! Random tiebreak: **<@${winnerId}> wins!**`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [winnerId] } });
  return { winnerId, reason };
}

/**
 * Post game-over message, record to DB, check achievements, save.
 * @param {object} game
 * @param {object} client - Discord client
 * @param {string|null} winnerId
 * @param {string} reason
 * @param {object} deps
 */
export async function postGameOver(game, client, winnerId, reason, deps) {
  game.ended = true;
  deps.setPhase(game, deps.PHASES.ENDED);
  game.winnerId = winnerId ?? game.winnerId ?? null;
  deps.cleanupGameLock(game.gameId);
  deps.cleanupGameMaps(game.gameId);
  deps.pendingIllegalSquad.delete(`${game.gameId}_1`);
  deps.pendingIllegalSquad.delete(`${game.gameId}_2`);
  deps.pendingSquadConfirm.delete(`${game.gameId}_1`);
  deps.pendingSquadConfirm.delete(`${game.gameId}_2`);
  const embed = deps.buildScorecardEmbed(game, deps.getMissionVpBonus(game));
  const content = winnerId
    ? `\uD83C\uDFC1 **GAME OVER** — <@${winnerId}> wins by ${reason}!`
    : `\uD83C\uDFC1 **GAME OVER** — ${reason}`;
  try {
    const ch = await client.channels.fetch(game.generalId);
    await ch.send({
      content,
      embeds: [embed],
      allowedMentions: winnerId ? { users: [winnerId] } : undefined,
    });
  } catch (err) {
    console.error('Failed to post game over:', err);
  }
  if (deps.isDbConfigured()) {
    deps.insertCompletedGame(game).catch((err) => console.error('[DB] insertCompletedGame:', err));
    if (deps.achievementsChannelId && game.player1Id && game.player2Id) {
      (async () => {
        try {
          const [stats1, stats2] = await Promise.all([
            deps.getStatsSummaryForPlayer(game.player1Id),
            deps.getStatsSummaryForPlayer(game.player2Id),
          ]);
          await Promise.all([
            deps.checkAndPostAchievements(deps.checkAndGrantAchievements, deps.postAchievementNotification, client, deps.achievementsChannelId, game.player1Id, 'game_complete', stats1.games),
            deps.checkAndPostAchievements(deps.checkAndGrantAchievements, deps.postAchievementNotification, client, deps.achievementsChannelId, game.player2Id, 'game_complete', stats2.games),
          ]);
          const wId = game.winnerId;
          if (wId) {
            const winnerStats = wId === game.player1Id ? stats1 : stats2;
            await deps.checkAndPostAchievements(deps.checkAndGrantAchievements, deps.postAchievementNotification, client, deps.achievementsChannelId, wId, 'game_win', winnerStats.wins);
            // Shutout: opponent scored 0 VP
            const loserId = wId === game.player1Id ? game.player2Id : game.player1Id;
            const loserVP = wId === game.player1Id ? game.player2VP : game.player1VP;
            if ((loserVP?.total ?? 0) === 0) {
              await deps.checkAndPostAchievements(deps.checkAndGrantAchievements, deps.postAchievementNotification, client, deps.achievementsChannelId, wId, 'shutout_win', 1);
            }
            // Survivor: winner lost no figures (all health entries have HP > 0)
            const winnerDcList = wId === game.player1Id ? game.p1DcList : game.p2DcList;
            const allSurvived = (winnerDcList || []).every((dc) => {
              if (!dc?.healthState?.length) return true;
              return dc.healthState.every((entry) => !entry || entry[0] > 0);
            });
            if (allSurvived && winnerDcList?.length > 0) {
              await deps.checkAndPostAchievements(deps.checkAndGrantAchievements, deps.postAchievementNotification, client, deps.achievementsChannelId, wId, 'no_losses_win', 1);
            }
            // Brutalist: win by eliminating all opponent figures
            if (reason && reason.toLowerCase().includes('eliminat')) {
              await deps.checkAndPostAchievements(deps.checkAndGrantAchievements, deps.postAchievementNotification, client, deps.achievementsChannelId, wId, 'full_wipe_win', 1);
            }
          }
        } catch (err) {
          console.error('[Achievements] postGameOver hook failed:', err.message);
        }
      })();
    }
  }
  deps.saveGames();
}

/**
 * Nefarious Gains (Jabba the Hutt): when ANY hostile figure is defeated,
 * check if Jabba is alive on the opposing team and award 1 objective VP.
 * @param {object} game
 * @param {number} defeatedOwnerPN - playerNum who owned the defeated figure
 * @param {object} client - Discord client (for logging)
 * @param {object} deps
 */
export async function checkNefariousGains(game, defeatedOwnerPN, client, deps) {
  const result = deps._checkNefariousGainsVp(game, defeatedOwnerPN);
  if (!result) return;
  await deps.logGameAction(game, client, `\uD83D\uDCB0 **Nefarious Gains** — **Jabba the Hutt** gains 1 VP (hostile defeated). P${result.jabbaOwnerPN} VP: ${result.vpTotal}`, { phase: 'ROUND', icon: 'card' });
}

/**
 * Hunt Dissent (Agent Kallus): when a hostile figure is defeated by Kallus
 * or a friendly TROOPER within 3 spaces of Kallus, Kallus gains 1 Block Token.
 * @param {object} game
 * @param {number} attackerPlayerNum - playerNum who defeated the hostile figure
 * @param {string|null} attackerFigureKey - figureKey of the figure that did the defeating
 * @param {object} client - Discord client (for logging)
 * @param {object} deps
 */
export async function checkHuntDissent(game, attackerPlayerNum, attackerFigureKey, client, deps) {
  if (!attackerFigureKey) return;
  // Find all alive Kallus figures on the attacker's team
  const kallusFigures = Object.keys(game.figurePositions?.[attackerPlayerNum] || {})
    .filter(fk => fk.startsWith('Agent Kallus-'));
  if (kallusFigures.length === 0) return;
  // Verify Kallus has hunt_dissent_kallus ability
  const kallusEff = deps.getDcEffects()?.['Agent Kallus'];
  if (!(kallusEff?.specialAbilityIds || []).includes('hunt_dissent_kallus')) return;
  const attackerDcName = deps.dcNameFromFigureKey(attackerFigureKey);
  const isAttackerKallus = attackerDcName === 'Agent Kallus';
  // Check if attacker is a TROOPER
  let isAttackerTrooper = false;
  if (!isAttackerKallus) {
    const atkEff = deps.getDcEffects()?.[attackerDcName];
    const atkKws = (atkEff?.keywords || []).map(k => String(k).toUpperCase());
    isAttackerTrooper = atkKws.includes('TROOPER');
  }
  if (!isAttackerKallus && !isAttackerTrooper) return;
  for (const kallusFk of kallusFigures) {
    if (isAttackerKallus) {
      // Kallus himself defeated the figure — grant Block Token
      const granted = deps.grantPowerTokens(game, kallusFk, 'Block', 1);
      if (granted > 0) {
        await deps.logGameAction(game, client, `\uD83D\uDEE1\uFE0F **Hunt Dissent** — **Agent Kallus** gains 1 **Block Token** (defeated hostile figure).`, { phase: 'ROUND', icon: 'card' });
      }
    } else {
      // Attacker is a TROOPER — check within 3 spaces of Kallus
      const kallusPos = game.figurePositions?.[attackerPlayerNum]?.[kallusFk];
      const atkPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
      if (kallusPos && atkPos) {
        const dist = deps.getRange(kallusPos, atkPos);
        if (dist <= 3) {
          const granted = deps.grantPowerTokens(game, kallusFk, 'Block', 1);
          if (granted > 0) {
            await deps.logGameAction(game, client, `\uD83D\uDEE1\uFE0F **Hunt Dissent** — **Agent Kallus** gains 1 **Block Token** (friendly TROOPER **${attackerDcName}** defeated hostile within 3 spaces).`, { phase: 'ROUND', icon: 'card' });
          }
        }
      }
    }
  }
}

/**
 * If a deployment group is fully defeated and hasn't activated yet,
 * decrement the owner's remaining activations.
 * @param {object} game
 * @param {number} playerNum
 * @param {number} dcIdx
 * @param {object} client
 * @param {object} deps
 */
export async function decrementActivationIfGroupDefeated(game, playerNum, dcIdx, client, deps) {
  if (dcIdx < 0 || !deps.isGroupDefeated(game, playerNum, dcIdx)) return;
  const activatedIndices = deps.getActivatedDcIndices(game, playerNum) || [];
  if (activatedIndices.includes(dcIdx)) return;
  deps.setActivationsRemaining(game, playerNum, Math.max(0, (deps.getActivationsRemaining(game, playerNum) ?? 0) - 1));
  await deps.updateActivationsMessage(game, playerNum, client);
}
