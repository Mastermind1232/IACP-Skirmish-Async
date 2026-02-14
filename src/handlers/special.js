/**
 * Special action handler: special_done_
 */
export async function handleSpecialDone(interaction) {
  const match = interaction.customId.match(/^special_done_(.+)_(.+)$/);
  if (match) {
    await interaction.deferUpdate();
    await interaction.message.edit({
      content: (interaction.message.content || '').replace('Click **Done** when finished.', '✓ Resolved.'),
      components: [],
    }).catch(() => {});
  }
}
