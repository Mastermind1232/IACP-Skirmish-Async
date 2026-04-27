#!/usr/bin/env node
// Syncs the members of a Discord role into the discord-MCP access allowlist
// (~/.claude/channels/discord/access.json), so anyone with that role can
// message Claude in the configured channel without manual user-ID upkeep.
//
// Run on demand (`node scripts/sync-bothelpers-allowlist.mjs`) or wire into
// launchd/cron for automatic syncs.
//
// Requirements:
//   1. DISCORD_TOKEN in .env (same token the Railway bot uses).
//   2. "Server Members Intent" enabled for the bot at
//      https://discord.com/developers/applications/<app-id>/bot
//   3. Bot must already be a member of the guild containing the role.
//
// Override defaults via env: BOTHELPERS_SYNC_ROLE_ID, BOTHELPERS_SYNC_CHANNEL_ID.

import { Client, GatewayIntentBits } from 'discord.js';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import 'dotenv/config';

const ROLE_ID = process.env.BOTHELPERS_SYNC_ROLE_ID || '1498454240375603391';
const CHANNEL_ID = process.env.BOTHELPERS_SYNC_CHANNEL_ID || '1481314970666008607';
const ACCESS_PATH = join(homedir(), '.claude', 'channels', 'discord', 'access.json');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set. Add it to .env or export it before running.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const ready = new Promise((resolve) => client.once('ready', resolve));
await client.login(process.env.DISCORD_TOKEN);
await ready;

const memberIds = new Set();
for (const guild of client.guilds.cache.values()) {
  try {
    await guild.members.fetch();
  } catch (err) {
    console.error(`Failed to fetch members for guild ${guild.id} (${guild.name}):`, err.message);
    console.error('Hint: enable the "Server Members Intent" in the Discord Developer Portal for this bot.');
    await client.destroy();
    process.exit(1);
  }
  const role = guild.roles.cache.get(ROLE_ID);
  if (!role) continue;
  for (const member of role.members.values()) {
    memberIds.add(member.id);
  }
}

const access = JSON.parse(readFileSync(ACCESS_PATH, 'utf8'));
access.groups = access.groups || {};
const group = access.groups[CHANNEL_ID];
if (!group) {
  console.error(`Channel ${CHANNEL_ID} not configured in access.json groups. Add it via /discord:access first.`);
  await client.destroy();
  process.exit(1);
}

const newList = [...memberIds].sort();
const oldList = (group.allowFrom || []).slice().sort();
group.allowFrom = newList;
writeFileSync(ACCESS_PATH, JSON.stringify(access, null, 2) + '\n');

const added = newList.filter((id) => !oldList.includes(id));
const removed = oldList.filter((id) => !newList.includes(id));
const stamp = new Date().toISOString();
console.log(`[${stamp}] Synced ${newList.length} member(s) for role ${ROLE_ID} → channel ${CHANNEL_ID}.`);
if (added.length) console.log('  added:  ', added.join(', '));
if (removed.length) console.log('  removed:', removed.join(', '));
if (!added.length && !removed.length) console.log('  no changes.');

await client.destroy();
process.exit(0);
