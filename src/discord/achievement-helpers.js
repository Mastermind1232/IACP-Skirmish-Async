/**
 * Achievement check-and-notify wrapper.
 * Combines checkAndGrantAchievements + postAchievementNotification into one call.
 */

/**
 * Check for achievements and post notifications for any granted.
 * @param {Function} checkAndGrantAchievements
 * @param {Function} postAchievementNotification
 * @param {object} client - Discord client
 * @param {string} achievementsChannelId
 * @param {string} userId
 * @param {string} type - achievement type
 * @param {number} stat - stat value to check against
 * @returns {Promise<Array>} granted achievement definitions
 */
export async function checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, userId, type, stat) {
  const granted = await checkAndGrantAchievements(userId, type, stat);
  for (const def of granted) await postAchievementNotification(client, achievementsChannelId, userId, def);
  return granted;
}
