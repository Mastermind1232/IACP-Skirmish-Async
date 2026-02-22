/**
 * Request moderation handlers: request_resolve_, request_reject_.
 * Admin-only; mark bot-request threads as [IMPLEMENTED] or [REJECTED].
 */
import { PermissionFlagsBits } from 'discord.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - logGameErrorToBotLogs
 */
export async function handleRequestResolve(interaction, ctx) {
  const { logGameErrorToBotLogs } = ctx;
  const threadId = interaction.customId.replace('request_resolve_', '');
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only admins can resolve requests.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  try {
    const thread = await interaction.client.channels.fetch(threadId);
    if (!thread?.isThread?.()) {
      await interaction.reply({ content: 'Thread not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const name = thread.name;
    const prefix = '[IMPLEMENTED] ';
    const newName = name.startsWith(prefix) ? name : prefix + name.replace(/^\[REJECTED\] /, '');
    await thread.setName(newName);
    await interaction.deferUpdate();
    await interaction.message.edit({ content: '✓ Marked as resolved.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    await logGameErrorToBotLogs(interaction.client, interaction.guild, null, err, 'request_resolve');
    await interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - logGameErrorToBotLogs
 */
export async function handleRequestReject(interaction, ctx) {
  const { logGameErrorToBotLogs } = ctx;
  const threadId = interaction.customId.replace('request_reject_', '');
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only admins can reject requests.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  try {
    const thread = await interaction.client.channels.fetch(threadId);
    if (!thread?.isThread?.()) {
      await interaction.reply({ content: 'Thread not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const name = thread.name;
    const prefix = '[REJECTED] ';
    const newName = name.startsWith(prefix) ? name : prefix + name.replace(/^\[IMPLEMENTED\] /, '');
    await thread.setName(newName);
    await interaction.deferUpdate();
    await interaction.message.edit({ content: '✓ Marked as rejected.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    await logGameErrorToBotLogs(interaction.client, interaction.guild, null, err, 'request_reject');
    await interaction.reply({ content: `Failed: ${err.message}`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}
