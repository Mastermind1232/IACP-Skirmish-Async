/**
 * Game validation (deck legal, etc.). No Discord; uses data-loader for card data.
 */
import { getDcStats, getCcEffect } from '../data-loader.js';

export const DC_POINTS_LEGAL = 40;
export const CC_CARDS_LEGAL = 15;
export const CC_COST_LEGAL = 15;

/** Resolve DC list entry to card name (object or string). */
export function resolveDcName(entry) {
  return typeof entry === 'object' ? (entry.dcName || entry.displayName) : entry;
}

/**
 * Validate squad for legal build: DC total cost === 40, CC exactly 15 cards and total cost === 15.
 * @param {{ dcList: string[], ccList: string[] }} squad
 * @returns {{ legal: boolean, errors: string[], dcTotal: number, ccCount: number, ccCost: number }}
 */
export function validateDeckLegal(squad) {
  const errors = [];
  let dcTotal = 0;
  const dcList = squad?.dcList || [];
  for (const entry of dcList) {
    const name = resolveDcName(entry);
    const stats = getDcStats()[name];
    const cost = stats?.cost;
    if (cost == null) {
      errors.push(`Unknown Deployment Card: "${name}" (cost not found).`);
    } else {
      dcTotal += cost;
    }
  }
  if (dcTotal !== DC_POINTS_LEGAL) {
    errors.push(`Deployment total is ${dcTotal} points. Legal total is exactly ${DC_POINTS_LEGAL}.`);
  }
  const ccList = squad?.ccList || [];
  let ccCost = 0;
  const unknownCc = [];
  for (const name of ccList) {
    const effect = getCcEffect(name);
    if (!effect) {
      unknownCc.push(name);
    } else {
      ccCost += (effect.cost ?? 0);
    }
  }
  if (unknownCc.length) {
    errors.push(`Unknown Command Card(s): ${unknownCc.slice(0, 5).join(', ')}${unknownCc.length > 5 ? '…' : ''}.`);
  }
  if (ccList.length !== CC_CARDS_LEGAL) {
    errors.push(`Command deck has ${ccList.length} cards. Legal deck is exactly ${CC_CARDS_LEGAL} cards.`);
  }
  if (ccCost !== CC_COST_LEGAL) {
    errors.push(`Command deck total cost is ${ccCost}. Legal total cost is exactly ${CC_COST_LEGAL}.`);
  }
  return {
    legal: errors.length === 0,
    errors,
    dcTotal,
    ccCount: ccList.length,
    ccCost,
  };
}
