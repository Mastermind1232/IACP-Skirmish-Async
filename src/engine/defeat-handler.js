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
export async function processFigureDefeat(game, opts, deps) {
  const {
    defeatedPlayerNum,
    figureKey,
    attackerPlayerNum,
    attackerFigureKey = null,
    msgId = null,
    dcIdx = -1,
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
  } = deps;

  const dcName = dcNameOpt || dcNameFromFigureKey(figureKey);
  const displayName = displayNameOpt || dcName;

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

  // 9. Check win conditions
  if (checkWinConditions) {
    await checkWinConditions(game, client);
  }

  return { vp, dcName };
}
