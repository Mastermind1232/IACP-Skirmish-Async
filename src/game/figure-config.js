/**
 * Per-figure config store.
 * Stores persistent per-figure data: loadout choice, form choice, companion state, attachments.
 * game.figureConfig[figureKey] = { loadout, form, attachments: [...], ... }
 */

/**
 * Get config for a figure. Returns empty object if none set.
 * @param {object} game
 * @param {string} figureKey
 * @returns {object}
 */
export function getConfig(game, figureKey) {
  return game.figureConfig?.[figureKey] || {};
}

/**
 * Set a single config key for a figure.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} key
 * @param {*} val
 */
export function setConfig(game, figureKey, key, val) {
  game.figureConfig = game.figureConfig || {};
  game.figureConfig[figureKey] = game.figureConfig[figureKey] || {};
  game.figureConfig[figureKey][key] = val;
}

/**
 * Clear all config for a figure (e.g., on defeat).
 * @param {object} game
 * @param {string} figureKey
 */
export function clearConfig(game, figureKey) {
  if (game.figureConfig) delete game.figureConfig[figureKey];
}

/**
 * Get list of attachment card names for a figure.
 * @param {object} game
 * @param {string} figureKey
 * @returns {string[]}
 */
export function getAttachments(game, figureKey) {
  return game.figureConfig?.[figureKey]?.attachments || [];
}

/**
 * Check if a figure has a specific attachment.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} attachmentName
 * @returns {boolean}
 */
export function hasAttachment(game, figureKey, attachmentName) {
  return getAttachments(game, figureKey).includes(attachmentName);
}
