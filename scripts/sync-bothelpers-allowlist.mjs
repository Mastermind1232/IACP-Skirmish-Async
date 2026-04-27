#!/usr/bin/env node
// Reads the bothelpers role's current member list from Postgres (written by
// the Railway bot on guildMemberUpdate) and applies it to the discord-MCP
// access allowlist (~/.claude/channels/discord/access.json). Local-only —
// the bot does the Discord-side membership tracking.
//
// Run on demand or wire into launchd/cron for periodic syncs.
//
// Requirements:
//   1. DATABASE_URL in .env (Railway public-proxy connection string).
//   2. Railway bot must already be writing to the bothelper_members table
//      (initDb + guildMemberUpdate listeners).
//
// Override defaults via env: BOTHELPERS_SYNC_ROLE_ID, BOTHELPERS_SYNC_CHANNEL_ID.

import pg from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import 'dotenv/config';

const ROLE_ID = process.env.BOTHELPERS_SYNC_ROLE_ID || '1498454240375603391';
const CHANNEL_ID = process.env.BOTHELPERS_SYNC_CHANNEL_ID || '1481314970666008607';
const ACCESS_PATH = join(homedir(), '.claude', 'channels', 'discord', 'access.json');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Add the Railway public proxy connection string to .env.');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let memberIds = [];
try {
  const { rows } = await pool.query(
    `SELECT member_ids FROM bothelper_members WHERE role_id = $1`,
    [ROLE_ID],
  );
  if (rows.length === 0) {
    console.warn(`[${new Date().toISOString()}] No bothelper_members row for role ${ROLE_ID} yet — bot may not have synced once.`);
  } else {
    const raw = rows[0].member_ids;
    memberIds = Array.isArray(raw) ? raw : [];
  }
} finally {
  await pool.end();
}

const access = JSON.parse(readFileSync(ACCESS_PATH, 'utf8'));
access.groups = access.groups || {};
const group = access.groups[CHANNEL_ID];
if (!group) {
  console.error(`Channel ${CHANNEL_ID} not configured in access.json groups. Add it via /discord:access first.`);
  process.exit(1);
}

const newList = [...new Set(memberIds)].sort();
const oldList = (group.allowFrom || []).slice().sort();

if (JSON.stringify(newList) === JSON.stringify(oldList)) {
  // No-op — silent to keep launchd logs clean at high frequency.
  process.exit(0);
}

group.allowFrom = newList;
writeFileSync(ACCESS_PATH, JSON.stringify(access, null, 2) + '\n');

const added = newList.filter((id) => !oldList.includes(id));
const removed = oldList.filter((id) => !newList.includes(id));
const stamp = new Date().toISOString();
console.log(`[${stamp}] Synced ${newList.length} member(s) for role ${ROLE_ID} → channel ${CHANNEL_ID}.`);
if (added.length) console.log('  added:  ', added.join(', '));
if (removed.length) console.log('  removed:', removed.join(', '));
