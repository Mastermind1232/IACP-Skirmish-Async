#!/usr/bin/env node
/**
 * Seed the coverage_items table with MVP categories, and optionally
 * backfill from existing selfplay_runs.
 *
 * Usage:
 *   node scripts/seed-coverage.js              # seed only
 *   node scripts/seed-coverage.js --backfill   # seed + backfill from selfplay_runs
 *
 * Requires DATABASE_URL in env (or will connect to Railway via hardcoded URL).
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const { Pool } = pg;

// ── DB Connection ────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:wFDwdSOjDYdlDEeTNgHUvqdnNBOguAwe@tramway.proxy.rlwy.net:56980/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

// ── Helpers ──────────────────────────────────────────────────────────

async function upsert(itemId, category, name, opts = {}) {
  await pool.query(
    `INSERT INTO coverage_items (item_id, category, name, parent_id, wired, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (item_id) DO UPDATE SET
       name = EXCLUDED.name,
       wired = EXCLUDED.wired,
       parent_id = COALESCE(EXCLUDED.parent_id, coverage_items.parent_id),
       updated_at = NOW()`,
    [itemId, category, name, opts.parent_id ?? null, opts.wired !== false]
  );
}

function loadJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

// ── Seed Functions ───────────────────────────────────────────────────

async function seedDcs() {
  const dc = loadJson('data/dc-effects.json');
  const cards = dc.cards;
  let count = 0;
  for (const [name] of Object.entries(cards)) {
    await upsert(`dc:${name}`, 'dc', name, { wired: true });
    count++;
  }
  console.log(`  dc: ${count} items`);
  return cards;
}

async function seedCcs() {
  const cc = loadJson('data/cc-effects.json');
  const cards = cc.cards;
  let wired = 0, stub = 0;
  for (const [name, data] of Object.entries(cards)) {
    const isWired = !!data.abilityId;
    await upsert(`cc:${name}`, 'cc', name, { wired: isWired });
    if (isWired) wired++; else stub++;
  }
  console.log(`  cc: ${wired + stub} items (${wired} wired, ${stub} stub)`);
}

async function seedAbilities(dcCards) {
  const lib = loadJson('data/ability-library.json');
  const abilities = lib.abilities;

  // Build DC→ability parent map
  const abilityParents = {};
  for (const [dcName, dc] of Object.entries(dcCards)) {
    for (const id of (dc.specialAbilityIds || [])) {
      abilityParents[id] = dcName;
    }
    for (const id of (dc.surgeAbilities || [])) {
      abilityParents[id] = dcName;
    }
  }

  let dcSpecialCount = 0, surgeCount = 0;
  for (const [id, ability] of Object.entries(abilities)) {
    if (ability.type === 'dcSpecial') {
      const wired = ability.wiredStatus ? ability.wiredStatus !== 'NOT_WIRED' : true;
      const parentDc = abilityParents[id] || null;
      await upsert(
        `ability_dc_special:${id}`,
        'ability_dc_special',
        ability.label || id,
        { parent_id: parentDc ? `dc:${parentDc}` : null, wired }
      );
      dcSpecialCount++;
    } else if (ability.type === 'surge') {
      const parentDc = abilityParents[id] || null;
      await upsert(
        `ability_surge:${id}`,
        'ability_surge',
        ability.label || id,
        { parent_id: parentDc ? `dc:${parentDc}` : null, wired: true }
      );
      surgeCount++;
    }
  }
  console.log(`  ability_dc_special: ${dcSpecialCount} items`);
  console.log(`  ability_surge: ${surgeCount} items`);
}

async function seedPendingStates() {
  const PENDING_STATE_KEYS = [
    'pendingCombat', 'pendingNegation', 'pendingCelebration',
    'pendingPowerTokenGrant', 'pendingDcAbilityChoice', 'pendingPounceSpaceChoice',
    'pendingMissileSalvo', 'pendingCoverFire', 'pendingSpreadThePainCondPick',
    'pendingStrainChoice', 'pendingStillFaster', 'pendingLastResort',
    'pendingStrikeMeDown', 'pendingSlowOnTheDraw', 'pendingForceExhaustion',
    'pendingIllicitArms', 'pendingPowerConverter', 'pendingThereIsNoTry',
    'pendingToughLuck', 'pendingHunterProtocol', 'pendingBleeding',
    'pendingEe3Carbine', 'pendingBoRifle', 'pendingRushPush',
    'pendingShoulderRush', 'pendingFalseOrders', 'pendingOverwatchPlacement',
    'pendingOrbitalBombardment', 'pendingBombDrop', 'pendingCcConfirmation',
    'pendingCcChoice', 'pendingCcSpaceChoice', 'moveInProgress',
    'endOfRoundWhoseTurn',
  ];
  for (const key of PENDING_STATE_KEYS) {
    await upsert(`pending_state:${key}`, 'pending_state', key, { wired: true });
  }
  console.log(`  pending_state: ${PENDING_STATE_KEYS.length} items`);
}

async function seedEndConditions() {
  const items = [
    ['end_condition:vp_40', 'VP threshold (40+)'],
    ['end_condition:elimination', 'All figures eliminated'],
    ['end_condition:draw', 'Draw (tiebreaker)'],
    ['end_condition:forfeit', 'Forfeit / concede'],
    ['end_condition:round_limit', 'Round limit reached'],
  ];
  for (const [id, name] of items) {
    await upsert(id, 'end_condition', name, { wired: true });
  }
  console.log(`  end_condition: ${items.length} items`);
}

async function seedVpSources() {
  const items = [
    ['vp_source:kill_vp', 'Kill VP (figure defeated)'],
    ['vp_source:objective_vp', 'Objective VP (CC/ability)'],
    ['vp_source:mission_vp', 'Mission VP (map objectives)'],
    ['vp_source:celebration_vp', 'Celebration CC (4 VP)'],
    ['vp_source:nefarious_gains', 'Nefarious Gains (Jabba 1 VP)'],
  ];
  for (const [id, name] of items) {
    await upsert(id, 'vp_source', name, { wired: true });
  }
  console.log(`  vp_source: ${items.length} items`);
}

async function seedHandlers() {
  const src = readFileSync(join(ROOT, 'src/handlers/index.js'), 'utf8');
  // Broad regex: matches register('prefix', anything, 'group') including arrow functions
  const re = /register\('([^']+)'[^)]*?(?:,\s*'([^']+)')?\s*\)/g;
  let m, count = 0;
  const seen = new Set();
  while ((m = re.exec(src)) !== null) {
    const prefix = m[1];
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    const group = m[2] || 'ungrouped';
    await upsert(`handler:${prefix}`, 'handler', `${prefix} [${group}]`, { wired: true });
    count++;
  }
  console.log(`  handler: ${count} items`);
}

async function seedDiscordSurface() {
  const items = [
    ['discord_surface:deploy_zone_25plus', 'Deploy zone >25 buttons silently truncated'],
    ['discord_surface:end_round_race', 'End-of-round race condition (no atomic check-and-set)'],
    ['discord_surface:permission_loss_silent', 'Bot permission loss swallowed by discordCatch()'],
    ['discord_surface:status_phase_sequential', 'Status phase sequential API calls (~5-10 min)'],
    ['discord_surface:thread_autoarchive', 'Hand thread auto-archive after 1 week'],
    ['discord_surface:modal_timeout', 'Modal timeout (15 min) no detection'],
    ['discord_surface:hand_thread_member_fail', 'Hand thread member add fails silently'],
    ['discord_surface:su_buttons_25plus', 'SU target buttons >25 silently truncated'],
    ['discord_surface:ephemeral_cc_updates', 'Ephemeral CC hand updates (15-min visibility)'],
    ['discord_surface:board_render_timeout', 'Board render no timeout wrapping'],
  ];
  for (const [id, name] of items) {
    await upsert(id, 'discord_surface', name, { wired: true });
  }
  console.log(`  discord_surface: ${items.length} items`);
}

// ── Backfill ─────────────────────────────────────────────────────────

async function backfillFromSelfplayRuns() {
  console.log('\nBackfilling from selfplay_runs...');
  const res = await pool.query(
    `SELECT id, game_id, exercised_handlers, p1_squad, p2_squad
     FROM selfplay_runs
     WHERE result IN ('completed', 'stopped', 'killed')
     ORDER BY id`
  );

  let totalHandlerHits = 0, totalDcHits = 0, runsProcessed = 0;

  for (const row of res.rows) {
    const hits = new Map();

    // Handler backfill
    let handlers = [];
    try {
      handlers = typeof row.exercised_handlers === 'string'
        ? JSON.parse(row.exercised_handlers)
        : (row.exercised_handlers || []);
    } catch { handlers = []; }

    for (const prefix of handlers) {
      const key = `handler:${prefix}`;
      hits.set(key, (hits.get(key) || 0) + 1);
      totalHandlerHits++;
    }

    // DC backfill from squads
    for (const squadCol of [row.p1_squad, row.p2_squad]) {
      let squad;
      try {
        squad = typeof squadCol === 'string' ? JSON.parse(squadCol) : squadCol;
      } catch { continue; }
      if (!squad?.dcList) continue;
      for (const dcName of squad.dcList) {
        const key = `dc:${dcName}`;
        hits.set(key, (hits.get(key) || 0) + 1);
        totalDcHits++;
      }
    }

    // Batch increment
    if (hits.size > 0) {
      const ids = [...hits.keys()];
      const counts = [...hits.values()];
      await pool.query(
        `UPDATE coverage_items AS c SET
           discord_count = c.discord_count + v.inc,
           last_discord_game = $3,
           last_discord_at = NOW(),
           updated_at = NOW()
         FROM (SELECT unnest($1::text[]) AS item_id, unnest($2::int[]) AS inc) v
         WHERE c.item_id = v.item_id`,
        [ids, counts, row.game_id]
      );
      runsProcessed++;
    }
  }

  console.log(`  Processed ${runsProcessed} runs: ${totalHandlerHits} handler hits, ${totalDcHits} DC hits`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const doBackfill = process.argv.includes('--backfill');

  console.log('Seeding coverage_items (MVP categories)...');

  const dcCards = await seedDcs();
  await seedCcs();
  await seedAbilities(dcCards);
  await seedPendingStates();
  await seedEndConditions();
  await seedVpSources();
  await seedHandlers();
  await seedDiscordSurface();

  // Summary
  const summary = await pool.query(
    `SELECT category, count(*)::int AS total,
            count(*) FILTER (WHERE wired = true)::int AS wired,
            count(*) FILTER (WHERE wired = false)::int AS hard_gaps
     FROM coverage_items GROUP BY category ORDER BY category`
  );
  console.log('\nSeed summary:');
  let grandTotal = 0;
  for (const row of summary.rows) {
    const gaps = row.hard_gaps > 0 ? ` (${row.hard_gaps} hard gaps)` : '';
    console.log(`  ${row.category.padEnd(22)} ${String(row.total).padStart(4)} wired=${row.wired}${gaps}`);
    grandTotal += row.total;
  }
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(grandTotal).padStart(4)}`);

  if (doBackfill) {
    await backfillFromSelfplayRuns();

    const exercised = await pool.query(
      `SELECT category, count(*)::int AS exercised
       FROM coverage_items WHERE discord_count > 0
       GROUP BY category ORDER BY category`
    );
    console.log('\nPost-backfill exercised:');
    for (const row of exercised.rows) {
      console.log(`  ${row.category.padEnd(22)} ${row.exercised} exercised`);
    }
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
