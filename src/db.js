/**
 * PostgreSQL persistence for game state.
 * Used when DATABASE_URL is set (e.g. on Railway).
 * Falls back to file-based storage when not set (local dev).
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPlayerId, getInitiativePlayerNum } from './game/player-helpers.js';
import { isAiUserId } from './discord/channel-helpers.js';

const __dbDirname = dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

let pool = null;

/** True if DATABASE_URL is set and we should use Postgres. */
export function isDbConfigured() {
  return !!process.env.DATABASE_URL;
}

/** Connect and create the games and completed_games tables if they don't exist (DB2). */
export async function initDb() {
  if (!isDbConfigured()) return;
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        game_data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS completed_games (
        id SERIAL PRIMARY KEY,
        winner_id TEXT,
        player1_id TEXT NOT NULL,
        player2_id TEXT NOT NULL,
        player1_affiliation TEXT,
        player2_affiliation TEXT,
        player1_army_json JSONB,
        player2_army_json JSONB,
        map_id TEXT,
        mission_id TEXT,
        deployment_zone_winner TEXT,
        ended_at TIMESTAMPTZ DEFAULT NOW(),
        round_count INT
      )
    `);
    // Add game_id column to completed_games if missing (migration)
    await pool.query(`ALTER TABLE completed_games ADD COLUMN IF NOT EXISTS game_id TEXT`).catch(() => {});
    // DB3: optional indexes for active games / recent updates
    await pool.query('CREATE INDEX IF NOT EXISTS idx_games_updated_at ON games (updated_at)').catch((err) => { console.error('[discord]', err?.message ?? err); });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_ended ON games ((game_data->>'ended'))`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    // Achievements tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievement_defs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT DEFAULT '🏆',
        trigger TEXT NOT NULL,
        threshold INT NOT NULL DEFAULT 1
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL REFERENCES achievement_defs(id),
        earned_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, achievement_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS domain_events (
        id SERIAL PRIMARY KEY,
        game_id TEXT NOT NULL,
        seq INT NOT NULL,
        type TEXT NOT NULL,
        correlation_id TEXT,
        player_id TEXT,
        aggregate_version INT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        payload JSONB NOT NULL,
        UNIQUE(game_id, seq)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_domain_events_game_seq ON domain_events (game_id, seq)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_domain_events_game_type ON domain_events (game_id, type)').catch(() => {});
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_snapshots (
        id SERIAL PRIMARY KEY,
        game_id TEXT NOT NULL,
        version INT NOT NULL,
        state JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(game_id, version)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_game_snapshots_game ON game_snapshots (game_id, version DESC)').catch(() => {});
    // Coverage tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coverage_regions (
        region_id    TEXT PRIMARY KEY,
        region_data  JSONB NOT NULL,
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coverage_incidents (
        id            SERIAL PRIMARY KEY,
        region_id     TEXT NOT NULL,
        region_name   TEXT NOT NULL,
        severity      TEXT NOT NULL,
        note          TEXT NOT NULL,
        game_id       TEXT,
        phase         TEXT,
        last_action   TEXT,
        undo_fixed    BOOLEAN DEFAULT FALSE,
        refresh_fixed BOOLEAN DEFAULT FALSE,
        siblings      JSONB DEFAULT '[]',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_coverage_incidents_region ON coverage_incidents(region_id)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_coverage_incidents_severity ON coverage_incidents(severity)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_coverage_incidents_created ON coverage_incidents(created_at DESC)').catch(() => {});
    // Favorite decks (personal saved-deck library)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorite_decks (
        id            BIGSERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL,
        deck_hash     TEXT NOT NULL,
        saved_name    TEXT NOT NULL,
        deck_data     JSONB NOT NULL,
        raw_list_text TEXT,
        affiliation   TEXT,
        point_total   INT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        last_used_at  TIMESTAMPTZ,
        use_count     INT NOT NULL DEFAULT 0,
        UNIQUE(user_id, deck_hash)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_favorite_decks_user ON favorite_decks (user_id, last_used_at DESC NULLS LAST)').catch(() => {});

    // ── Self-play run artifacts ────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS selfplay_runs (
        id              BIGSERIAL PRIMARY KEY,
        game_id         TEXT NOT NULL,
        guild_id        TEXT,
        scenario        TEXT,
        result          TEXT NOT NULL,
        stop_reason     TEXT NOT NULL,
        commit_sha      TEXT,
        map             TEXT,
        p1_squad        JSONB,
        p2_squad        JSONB,
        phase           TEXT,
        round_phase     TEXT,
        current_round   INT,
        active_player   TEXT,
        total_steps     INT NOT NULL,
        last_action     TEXT,
        recent_actions  JSONB NOT NULL DEFAULT '[]',
        pending_states  JSONB NOT NULL DEFAULT '{}',
        recovery_reason TEXT,
        error_message   TEXT,
        error_stack     TEXT,
        handler_key     TEXT,
        intended_surface TEXT,
        actual_channel   TEXT,
        discord_op       TEXT,
        discord_error    TEXT,
        started_at      TIMESTAMPTZ NOT NULL,
        failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms     INT,
        recovery_fired  BOOLEAN DEFAULT FALSE,
        recovery_count  INT DEFAULT 0
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_selfplay_runs_game ON selfplay_runs (game_id)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_selfplay_runs_reason ON selfplay_runs (stop_reason)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_selfplay_runs_created ON selfplay_runs (failed_at DESC)').catch(() => {});

    // Phase 1 trace columns (queue runner)
    for (const col of [
      { name: 'exploration_mode', type: 'TEXT' },
      { name: 'exercised_handlers', type: "JSONB DEFAULT '[]'" },
      { name: 'seen_action_types', type: "JSONB DEFAULT '[]'" },
      { name: 'triggered_pending_states', type: "JSONB DEFAULT '[]'" },
    ]) {
      try {
        await pool.query(`ALTER TABLE selfplay_runs ADD COLUMN ${col.name} ${col.type}`);
      } catch (err) {
        if (err.code !== '42701') console.error(`[DB] ALTER selfplay_runs add ${col.name}:`, err.message);
      }
    }

    // Phase 2: VP/coverage/telemetry columns (were computed but silently dropped)
    for (const col of [
      { name: 'checkpoint_games', type: 'INT' },
      { name: 'checkpoint_file', type: 'TEXT' },
      { name: 'winner', type: 'TEXT' },
      { name: 'p1_vp', type: 'INT DEFAULT 0' },
      { name: 'p2_vp', type: 'INT DEFAULT 0' },
      { name: 'vp_per_round', type: "JSONB DEFAULT '[]'" },
      { name: 'total_rounds', type: 'INT' },
      { name: 'figure_defeats', type: 'INT DEFAULT 0' },
      { name: 'action_type_counts', type: "JSONB DEFAULT '{}'" },
      { name: 'transitions_hit', type: "JSONB DEFAULT '[]'" },
      { name: 'runtime_stats', type: "JSONB DEFAULT '{}'" },
      // End-condition telemetry
      { name: 'game_end_reason', type: 'TEXT' },
      { name: 'p1_figures_remaining', type: 'INT' },
      { name: 'p2_figures_remaining', type: 'INT' },
    ]) {
      try {
        await pool.query(`ALTER TABLE selfplay_runs ADD COLUMN ${col.name} ${col.type}`);
      } catch (err) {
        if (err.code !== '42701') console.error(`[DB] ALTER selfplay_runs add ${col.name}:`, err.message);
      }
    }

    // ── Exploration tables (headless explorer + coverage persistence) ─────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exploration_transitions (
        transition_key    TEXT PRIMARY KEY,
        round_phase       TEXT,
        pending_set       TEXT,
        action_type       TEXT,
        status            TEXT NOT NULL DEFAULT 'headless_seen',
        headless_count    INTEGER NOT NULL DEFAULT 0,
        discord_count     INTEGER NOT NULL DEFAULT 0,
        invariant_fails   INTEGER NOT NULL DEFAULT 0,
        context_tags      JSONB DEFAULT '{}',
        scenarios_reaching JSONB DEFAULT '[]',
        first_seen_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exploration_episodes (
        episode_id        TEXT PRIMARY KEY,
        source            TEXT NOT NULL DEFAULT 'headless',
        seed_config       JSONB NOT NULL,
        total_steps       INTEGER NOT NULL,
        unique_transitions INTEGER NOT NULL DEFAULT 0,
        novel_transitions  INTEGER NOT NULL DEFAULT 0,
        invariant_errors  INTEGER NOT NULL DEFAULT 0,
        transitions_hit   JSONB NOT NULL DEFAULT '[]',
        result            TEXT,
        stop_reason       TEXT,
        duration_ms       INTEGER,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_exploration_transitions_status ON exploration_transitions (status)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_exploration_episodes_created ON exploration_episodes (created_at DESC)').catch(() => {});

    // ── Incidents table (Postgres-first error tracking) ──────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id                  BIGSERIAL PRIMARY KEY,
        game_id             TEXT,
        guild_id            TEXT,
        source              TEXT NOT NULL DEFAULT 'pvp',
        context             TEXT,
        error_message       TEXT NOT NULL,
        error_stack         TEXT,
        status              TEXT NOT NULL DEFAULT 'open',
        mirror_status       TEXT NOT NULL DEFAULT 'pending',
        selfplay_run_id     BIGINT,
        channel_id          TEXT,
        message_link        TEXT,
        discord_thread_id   TEXT,
        discord_message_id  TEXT,
        metadata            JSONB DEFAULT '{}',
        resolved_by         TEXT,
        resolved_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_incidents_game ON incidents (game_id)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents (created_at DESC)').catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coverage_items (
        item_id           TEXT PRIMARY KEY,
        category          TEXT NOT NULL,
        name              TEXT NOT NULL,
        parent_id         TEXT,
        wired             BOOLEAN DEFAULT TRUE,
        headless_count    INT DEFAULT 0,
        discord_count     INT DEFAULT 0,
        last_discord_game TEXT,
        last_discord_at   TIMESTAMPTZ,
        verified          BOOLEAN DEFAULT FALSE,
        verified_by       TEXT,
        verified_at       TIMESTAMPTZ,
        notes             TEXT,
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cov_category ON coverage_items(category)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cov_unexercised ON coverage_items(category) WHERE discord_count = 0').catch(() => {});

    await seedAchievements();
    await seedCoverageRegions();
    // Check coverage_items: warn if empty (seed via: node scripts/seed-coverage.js --backfill)
    try {
      const covCheck = await pool.query('SELECT count(*)::int AS c FROM coverage_items');
      if (covCheck.rows[0].c === 0) {
        console.warn('[DB] coverage_items is empty — run: node scripts/seed-coverage.js --backfill');
      }
    } catch {}

    // ── bothelper_members: snapshot of which Discord users are in a given role ──
    // Written by the Railway bot on guildMemberUpdate; read by the local
    // sync script that updates ~/.claude/channels/discord/access.json.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bothelper_members (
        role_id     TEXT PRIMARY KEY,
        member_ids  JSONB NOT NULL DEFAULT '[]',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Checkpoints — save full game state for cross-game restore (testing-from-same-point).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        origin_game_id TEXT,
        created_by    TEXT NOT NULL,
        created_at    BIGINT NOT NULL,
        game_state    JSONB NOT NULL,
        map_id        TEXT,
        variant       TEXT,
        round_at_save INT,
        p1_username   TEXT,
        p2_username   TEXT,
        game_version  INT,
        data_hash     TEXT
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_checkpoints_creator ON checkpoints (created_by, created_at DESC)').catch((err) => { console.error('[discord]', err?.message ?? err); });
    await pool.query('CREATE INDEX IF NOT EXISTS idx_checkpoints_origin ON checkpoints (origin_game_id)').catch((err) => { console.error('[discord]', err?.message ?? err); });

    console.log('[DB] PostgreSQL connected, all tables ready.');
  } catch (err) {
    console.error('[DB] Failed to connect:', err.message);
    pool = null;
  }
}

/** Upsert the current member-id list for a role. Called when role membership changes. */
export async function upsertBothelperMembers(roleId, memberIds) {
  if (!pool) return;
  const sorted = [...new Set(memberIds)].sort();
  await pool.query(
    `INSERT INTO bothelper_members (role_id, member_ids, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (role_id) DO UPDATE
       SET member_ids = EXCLUDED.member_ids, updated_at = NOW()`,
    [roleId, JSON.stringify(sorted)],
  );
}

/** Read the latest member-id list for a role. Returns [] if no row yet. */
export async function getBothelperMembers(roleId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT member_ids FROM bothelper_members WHERE role_id = $1`,
    [roleId],
  );
  if (rows.length === 0) return [];
  const ids = rows[0].member_ids;
  return Array.isArray(ids) ? ids : [];
}

/** Write a row to completed_games when a game ends (DB2). Call in the same path that sets game.ended. */
export async function insertCompletedGame(game) {
  if (!pool || !game?.ended) return;
  // SKIRBO / self-play games never count toward leaderboards or stats.
  // Skip the insert entirely so winrate / pickrate / leaderboard queries
  // don't have to filter the sentinel ID out of every aggregate.
  if (isAiUserId(game.player1Id) || isAiUserId(game.player2Id) || game.selfPlay) return;
  try {
    const winnerId = game.winnerId ?? null;
    const player1Id = game.player1Id ?? '';
    const player2Id = game.player2Id ?? '';
    const p1Squad = game.player1Squad || {};
    const p2Squad = game.player2Squad || {};
    const mapId = game.selectedMap?.id ?? null;
    const missionId = game.selectedMission ? `${game.selectedMap?.id || ''}:${game.selectedMission.variant || 'a'}` : null;
    const deploymentZoneWinner = game.deploymentZoneChosen ? getPlayerId(game, getInitiativePlayerNum(game)) : null;
    const roundCount = game.currentRound ?? null;
    const gameId = game.gameId ?? null;
    await pool.query(
      `INSERT INTO completed_games (game_id, winner_id, player1_id, player2_id, player1_affiliation, player2_affiliation, player1_army_json, player2_army_json, map_id, mission_id, deployment_zone_winner, round_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [gameId, winnerId, player1Id, player2Id, p1Squad.affiliation ?? null, p2Squad.affiliation ?? null, JSON.stringify(p1Squad), JSON.stringify(p2Squad), mapId, missionId, deploymentZoneWinner, roundCount]
    );
  } catch (err) {
    console.error('[DB] insertCompletedGame failed:', err.message);
  }
}

/** Insert a self-play run artifact (failed/stopped runs only by default). */
export async function insertSelfPlayRun(artifact) {
  if (!pool || !artifact) return;
  try {
    await pool.query(
      `INSERT INTO selfplay_runs (
        game_id, guild_id, scenario, result, stop_reason, commit_sha,
        map, p1_squad, p2_squad, phase, round_phase, current_round, active_player,
        total_steps, last_action, recent_actions, pending_states,
        recovery_reason, error_message, error_stack, handler_key,
        intended_surface, actual_channel, discord_op, discord_error,
        started_at, failed_at, duration_ms, recovery_fired, recovery_count,
        exploration_mode, exercised_handlers, seen_action_types, triggered_pending_states,
        checkpoint_games, checkpoint_file, winner, p1_vp, p2_vp,
        vp_per_round, total_rounds, figure_defeats, action_type_counts,
        transitions_hit, runtime_stats,
        game_end_reason, p1_figures_remaining, p2_figures_remaining
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48
      )`,
      [
        artifact.game_id, artifact.guild_id ?? null, artifact.scenario ?? null,
        artifact.result, artifact.stop_reason, artifact.commit_sha ?? null,
        artifact.map ?? null,
        JSON.stringify(artifact.p1_squad ?? null), JSON.stringify(artifact.p2_squad ?? null),
        artifact.phase ?? null, artifact.round_phase ?? null,
        artifact.current_round ?? null, artifact.active_player ?? null,
        artifact.total_steps, artifact.last_action ?? null,
        JSON.stringify(artifact.recent_actions ?? []), JSON.stringify(artifact.pending_states ?? {}),
        artifact.recovery_reason ?? null, artifact.error_message ?? null, artifact.error_stack ?? null,
        artifact.handler_key ?? null, artifact.intended_surface ?? null, artifact.actual_channel ?? null,
        artifact.discord_op ?? null, artifact.discord_error ?? null,
        artifact.started_at, artifact.failed_at ?? new Date(),
        artifact.duration_ms ?? null, artifact.recovery_fired ?? false, artifact.recovery_count ?? 0,
        artifact.exploration_mode ?? null,
        JSON.stringify(artifact.exercised_handlers ?? []),
        JSON.stringify(artifact.seen_action_types ?? []),
        JSON.stringify(artifact.triggered_pending_states ?? []),
        // Phase 2: VP/coverage/telemetry (previously dropped)
        artifact.checkpoint_games ?? null, artifact.checkpoint_file ?? null,
        artifact.winner ?? null, artifact.p1_vp ?? 0, artifact.p2_vp ?? 0,
        JSON.stringify(artifact.vp_per_round ?? []), artifact.total_rounds ?? null,
        artifact.figure_defeats ?? 0, JSON.stringify(artifact.action_type_counts ?? {}),
        JSON.stringify(artifact.transitions_hit ?? []), JSON.stringify(artifact.runtime_stats ?? {}),
        // End-condition telemetry
        artifact.game_end_reason ?? null,
        artifact.p1_figures_remaining ?? null, artifact.p2_figures_remaining ?? null,
      ]
    );
  } catch (err) {
    console.error('[DB] insertSelfPlayRun failed:', err.message);
  }
}

/** Load all games from the database. Returns { gameId: gameObject, ... }. */
export async function loadGamesFromDb() {
  if (!pool) return {};
  try {
    const res = await pool.query('SELECT game_id, game_data FROM games');
    const out = {};
    for (const row of res.rows) {
      const g = row.game_data;
      if (g && typeof g === 'object') delete g.pendingAttack;
      out[row.game_id] = g;
    }
    return out;
  } catch (err) {
    console.error('[DB] Load failed:', err.message);
    return {};
  }
}

/** Set of game IDs that have been modified since last save. */
const dirtyGameIds = new Set();

/** Mark a game as needing to be saved. */
export function markGameDirty(gameId) {
  dirtyGameIds.add(gameId);
}

/** Save only dirty games to the database. */
export let savePromise = Promise.resolve();

export async function saveGamesToDb(gamesMap) {
  if (!pool) return;
  const toSave = [...dirtyGameIds].filter(id => gamesMap.has(id));
  dirtyGameIds.clear();
  if (toSave.length === 0) return;
  savePromise = savePromise.then(async () => {
    for (const gameId of toSave) {
      const game = gamesMap.get(gameId);
      if (!game) continue;
      try {
        await pool.query(
          `INSERT INTO games (game_id, game_data) VALUES ($1, $2)
           ON CONFLICT (game_id) DO UPDATE SET game_data = $2, updated_at = NOW()`,
          [gameId, JSON.stringify(game)]
        );
      } catch (err) {
        dirtyGameIds.add(gameId);
        console.error(`[DB] Save failed for ${gameId}:`, err.message);
      }
    }
  });
  return savePromise;
}

/** Remove a game from the active-games registry (when game is killed).
 *
 * Note: domain_events and game_snapshots are intentionally preserved as a
 * historical record. Discord channels are deleted separately by the caller;
 * the on-disk action log stays so an AI rules-judge can replay completed
 * games and flag rules bugs after the fact.
 */
export async function deleteGameFromDb(gameId) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM games WHERE game_id = $1', [gameId]);
  } catch (err) {
    console.error('[DB] Delete failed:', err.message);
  }
}

// --- Stats (completed_games); for use in #statistics channel commands ---

/** Return { totalGames, draws } from completed_games. */
export async function getStatsSummary() {
  if (!pool) return { totalGames: 0, draws: 0 };
  try {
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM completed_games');
    const draws = await pool.query("SELECT COUNT(*)::int AS n FROM completed_games WHERE winner_id IS NULL");
    return { totalGames: count.rows[0]?.n ?? 0, draws: draws.rows[0]?.n ?? 0 };
  } catch (err) {
    console.error('[DB] getStatsSummary failed:', err.message);
    return { totalGames: 0, draws: 0 };
  }
}

/** Win rate by affiliation. Returns [{ affiliation, wins, games, winRate }] sorted by games desc. */
export async function getAffiliationWinRates() {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        SUM(wins)::int AS wins,
        SUM(games)::int AS games,
        ROUND(100.0 * SUM(wins) / NULLIF(SUM(games), 0), 1) AS win_rate
      FROM (
        SELECT player1_affiliation AS aff, (winner_id = player1_id)::int AS wins, 1 AS games FROM completed_games WHERE winner_id IS NOT NULL AND player1_affiliation IS NOT NULL
        UNION ALL
        SELECT player2_affiliation AS aff, (winner_id = player2_id)::int AS wins, 1 AS games FROM completed_games WHERE winner_id IS NOT NULL AND player2_affiliation IS NOT NULL
      ) t
      GROUP BY aff
      ORDER BY SUM(games) DESC
    `);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      wins: Number(r.wins),
      games: Number(r.games),
      winRate: r.win_rate != null ? Number(r.win_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationWinRates failed:', err.message);
    return [];
  }
}

/** Win rate by deployment card (from army JSON dcList). Returns top N entries [{ dcName, wins, games, winRate }] by games desc. */
export async function getDcWinRates(limit = 20) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      'SELECT player1_army_json, player2_army_json, winner_id, player1_id, player2_id FROM completed_games WHERE winner_id IS NOT NULL'
    );
    const byDc = {};
    for (const row of res.rows) {
      const p1Won = row.winner_id === row.player1_id;
      const p2Won = row.winner_id === row.player2_id;
      const dcList1 = (row.player1_army_json && row.player1_army_json.dcList) || [];
      const dcList2 = (row.player2_army_json && row.player2_army_json.dcList) || [];
      const names1 = dcList1.map((d) => (typeof d === 'string' ? d : d?.displayName || d?.name || '')).filter(Boolean);
      const names2 = dcList2.map((d) => (typeof d === 'string' ? d : d?.displayName || d?.name || '')).filter(Boolean);
      for (const name of names1) {
        if (!byDc[name]) byDc[name] = { wins: 0, games: 0 };
        byDc[name].games += 1;
        if (p1Won) byDc[name].wins += 1;
      }
      for (const name of names2) {
        if (!byDc[name]) byDc[name] = { wins: 0, games: 0 };
        byDc[name].games += 1;
        if (p2Won) byDc[name].wins += 1;
      }
    }
    return Object.entries(byDc)
      .map(([dcName, o]) => ({
        dcName,
        wins: o.wins,
        games: o.games,
        winRate: o.games ? Math.round((100.0 * o.wins) / o.games * 10) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, limit);
  } catch (err) {
    console.error('[DB] getDcWinRates failed:', err.message);
    return [];
  }
}

/** Stats summary for a single player: { games, wins, losses, draws, winRate }. */
export async function getStatsSummaryForPlayer(userId) {
  if (!pool) return { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
  try {
    const res = await pool.query(`
      SELECT
        COUNT(*)::int AS games,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN winner_id IS NOT NULL AND winner_id <> $1 THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END)::int AS draws
      FROM completed_games
      WHERE player1_id = $1 OR player2_id = $1
    `, [userId]);
    const r = res.rows[0] ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    const games = Number(r.games ?? 0);
    const wins = Number(r.wins ?? 0);
    const decisiveGames = games - Number(r.draws ?? 0);
    const winRate = decisiveGames > 0 ? Math.round((100.0 * wins) / decisiveGames * 10) / 10 : 0;
    return { games, wins, losses: Number(r.losses ?? 0), draws: Number(r.draws ?? 0), winRate };
  } catch (err) {
    console.error('[DB] getStatsSummaryForPlayer failed:', err.message);
    return { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
  }
}

/** Win rate by affiliation for a single player. Returns [{ affiliation, wins, games, winRate }]. */
export async function getAffiliationWinRatesPersonal(userId) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        SUM(wins)::int AS wins,
        SUM(games)::int AS games,
        ROUND(100.0 * SUM(wins) / NULLIF(SUM(games), 0), 1) AS win_rate
      FROM (
        SELECT player1_affiliation AS aff, (winner_id = player1_id)::int AS wins, 1 AS games
          FROM completed_games WHERE winner_id IS NOT NULL AND player1_affiliation IS NOT NULL AND player1_id = $1
        UNION ALL
        SELECT player2_affiliation AS aff, (winner_id = player2_id)::int AS wins, 1 AS games
          FROM completed_games WHERE winner_id IS NOT NULL AND player2_affiliation IS NOT NULL AND player2_id = $1
      ) t
      GROUP BY aff ORDER BY SUM(games) DESC
    `, [userId]);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      wins: Number(r.wins),
      games: Number(r.games),
      winRate: r.win_rate != null ? Number(r.win_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationWinRatesPersonal failed:', err.message);
    return [];
  }
}

/** Pick rate by affiliation (global). Returns [{ affiliation, picks, totalArmies, pickRate }]. */
export async function getAffiliationPickRates() {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        COUNT(*)::int AS picks,
        (SELECT COUNT(*) * 2 FROM completed_games WHERE player1_affiliation IS NOT NULL)::int AS total_armies,
        ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) * 2 FROM completed_games WHERE player1_affiliation IS NOT NULL), 0), 1) AS pick_rate
      FROM (
        SELECT player1_affiliation AS aff FROM completed_games WHERE player1_affiliation IS NOT NULL
        UNION ALL
        SELECT player2_affiliation AS aff FROM completed_games WHERE player2_affiliation IS NOT NULL
      ) t
      GROUP BY aff ORDER BY COUNT(*) DESC
    `);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      picks: Number(r.picks),
      totalArmies: Number(r.total_armies),
      pickRate: r.pick_rate != null ? Number(r.pick_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationPickRates failed:', err.message);
    return [];
  }
}

/** Pick rate by affiliation for a single player. Returns [{ affiliation, picks, totalArmies, pickRate }]. */
export async function getAffiliationPickRatesPersonal(userId) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        COUNT(*)::int AS picks,
        (
          SELECT COUNT(*) FROM (
            SELECT player1_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player1_affiliation IS NOT NULL
            UNION ALL
            SELECT player2_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player2_affiliation IS NOT NULL
          ) sub
        )::int AS total_armies,
        ROUND(100.0 * COUNT(*) / NULLIF(
          (
            SELECT COUNT(*) FROM (
              SELECT player1_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player1_affiliation IS NOT NULL
              UNION ALL
              SELECT player2_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player2_affiliation IS NOT NULL
            ) sub2
          ), 0
        ), 1) AS pick_rate
      FROM (
        SELECT player1_affiliation AS aff FROM completed_games WHERE player1_id = $1 AND player1_affiliation IS NOT NULL
        UNION ALL
        SELECT player2_affiliation AS aff FROM completed_games WHERE player2_id = $1 AND player2_affiliation IS NOT NULL
      ) t
      GROUP BY aff ORDER BY COUNT(*) DESC
    `, [userId]);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      picks: Number(r.picks),
      totalArmies: Number(r.total_armies),
      pickRate: r.pick_rate != null ? Number(r.pick_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationPickRatesPersonal failed:', err.message);
    return [];
  }
}

/** Win rate by DC for a single player. Returns top N [{ dcName, wins, games, winRate }] by games desc. */
export async function getDcWinRatesPersonal(userId, limit = 20) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT player1_army_json, player2_army_json, winner_id, player1_id, player2_id
       FROM completed_games WHERE winner_id IS NOT NULL AND (player1_id = $1 OR player2_id = $1)`,
      [userId]
    );
    const byDc = {};
    for (const row of res.rows) {
      const isP1 = row.player1_id === userId;
      const playerWon = row.winner_id === userId;
      const myArmy = isP1 ? row.player1_army_json : row.player2_army_json;
      const dcList = (myArmy && myArmy.dcList) || [];
      const names = dcList.map((d) => (typeof d === 'string' ? d : d?.displayName || d?.name || '')).filter(Boolean);
      for (const name of names) {
        if (!byDc[name]) byDc[name] = { wins: 0, games: 0 };
        byDc[name].games += 1;
        if (playerWon) byDc[name].wins += 1;
      }
    }
    return Object.entries(byDc)
      .map(([dcName, o]) => ({
        dcName,
        wins: o.wins,
        games: o.games,
        winRate: o.games ? Math.round((100.0 * o.wins) / o.games * 10) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, limit);
  } catch (err) {
    console.error('[DB] getDcWinRatesPersonal failed:', err.message);
    return [];
  }
}

/** Leaderboard: top players by win count. Returns [{ playerId, wins, losses, draws, games, winRate }]. */
export async function getLeaderboard(limit = 10) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        player_id,
        SUM(won)::int AS wins,
        SUM(lost)::int AS losses,
        SUM(draw)::int AS draws,
        COUNT(*)::int AS games,
        ROUND(100.0 * SUM(won) / NULLIF(COUNT(*) - SUM(draw), 0), 1) AS win_rate
      FROM (
        SELECT player1_id AS player_id,
          (winner_id = player1_id)::int AS won,
          (winner_id = player2_id)::int AS lost,
          (winner_id IS NULL)::int AS draw
        FROM completed_games
        UNION ALL
        SELECT player2_id AS player_id,
          (winner_id = player2_id)::int AS won,
          (winner_id = player1_id)::int AS lost,
          (winner_id IS NULL)::int AS draw
        FROM completed_games
      ) t
      GROUP BY player_id
      HAVING COUNT(*) >= 5
      ORDER BY win_rate DESC NULLS LAST, wins DESC
      LIMIT $1
    `, [limit]);
    return res.rows.map((r) => ({
      playerId: r.player_id,
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      draws: Number(r.draws ?? 0),
      games: Number(r.games ?? 0),
      winRate: r.win_rate != null ? Number(r.win_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getLeaderboard failed:', err.message);
    return [];
  }
}

// ── Achievements ─────────────────────────────────────────────────────────────

const ACHIEVEMENT_SEED = [
  // Games played milestones
  { id: 'complete_1_game',   name: 'New Recruit',             description: 'Complete your first game',  icon: '🏆', trigger: 'game_complete', threshold: 1   },
  { id: 'complete_5_games',  name: 'Field Tested',            description: 'Complete 5 games',          icon: '🏆', trigger: 'game_complete', threshold: 5   },
  { id: 'complete_10_games', name: 'Battle-Hardened',         description: 'Complete 10 games',         icon: '🏆', trigger: 'game_complete', threshold: 10  },
  { id: 'complete_25_games', name: 'Veteran of the Outer Rim',description: 'Complete 25 games',         icon: '🏆', trigger: 'game_complete', threshold: 25  },
  { id: 'complete_50_games', name: 'Galactic Campaigner',     description: 'Complete 50 games',         icon: '🏆', trigger: 'game_complete', threshold: 50  },
  { id: 'complete_100_games',name: 'Legend of the Empire',     description: 'Complete 100 games',        icon: '🏆', trigger: 'game_complete', threshold: 100 },
  // Win milestones
  { id: 'win_1_game',        name: 'A New Hope',              description: 'Win your first game',       icon: '🥇', trigger: 'game_win',      threshold: 1   },
  { id: 'win_5_games',       name: 'Rising Force',            description: 'Win 5 games',               icon: '🥇', trigger: 'game_win',      threshold: 5   },
  { id: 'win_10_games',      name: 'Rebel Commander',         description: 'Win 10 games',              icon: '🥇', trigger: 'game_win',      threshold: 10  },
  { id: 'win_25_games',      name: 'Grand Admiral',           description: 'Win 25 games',              icon: '🥇', trigger: 'game_win',      threshold: 25  },
  { id: 'win_50_games',      name: 'The Chosen One',          description: 'Win 50 games',              icon: '🥇', trigger: 'game_win',      threshold: 50  },
  // In-game highlights
  { id: 'devastator',        name: 'Devastator',              description: 'Deal 10+ damage in a single attack',            icon: '💥', trigger: 'single_attack_damage', threshold: 10 },
  { id: 'double_kill',       name: 'Double Kill',             description: 'Defeat 2 figures in a single activation',       icon: '⚔️', trigger: 'activation_kills',     threshold: 2  },
  { id: 'triple_kill',       name: 'Triple Kill',             description: 'Defeat 3 figures in a single activation',       icon: '⚔️', trigger: 'activation_kills',     threshold: 3  },
  { id: 'pentakill',         name: 'PENTAKILL',               description: 'Defeat 5 figures in a single activation',       icon: '💀', trigger: 'activation_kills',     threshold: 5  },
  // Game-end conditions
  { id: 'shutout',           name: 'Shutout',                 description: 'Win a game where your opponent scored 0 VP',    icon: '🔒', trigger: 'shutout_win',          threshold: 1  },
  { id: 'survivor',          name: 'Survivor',                description: 'Win a game without losing any figures',         icon: '🛡️', trigger: 'no_losses_win',        threshold: 1  },
  { id: 'brutalist',         name: 'Brutalist',               description: 'Win by eliminating all opponent figures',       icon: '☠️', trigger: 'full_wipe_win',        threshold: 1  },
];

async function seedAchievements() {
  if (!pool) return;
  for (const def of ACHIEVEMENT_SEED) {
    await pool.query(
      `INSERT INTO achievement_defs (id, name, description, icon, trigger, threshold)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, icon = $4, trigger = $5, threshold = $6`,
      [def.id, def.name, def.description, def.icon, def.trigger, def.threshold]
    ).catch((err) => console.error('[DB] seedAchievements:', err.message));
  }
}

/** Returns earned achievements for a user: [{id, name, description, icon, earned_at}] */
export async function getEarnedAchievements(userId) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT d.id, d.name, d.description, d.icon, ua.earned_at
       FROM user_achievements ua
       JOIN achievement_defs d ON d.id = ua.achievement_id
       WHERE ua.user_id = $1
       ORDER BY ua.earned_at ASC`,
      [userId]
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getEarnedAchievements failed:', err.message);
    return [];
  }
}

/**
 * Check which achievements for `trigger` are newly earned given `statCount`,
 * insert them, and return the newly granted defs.
 * @param {string} userId
 * @param {'game_complete'|'game_win'|'single_attack_damage'|'activation_kills'|'shutout_win'|'no_losses_win'|'full_wipe_win'} trigger
 * @param {number} statCount
 * @returns {Promise<Array<{id, name, description, icon}>>}
 */
export async function checkAndGrantAchievements(userId, trigger, statCount) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       SELECT $1, d.id
       FROM achievement_defs d
       WHERE d.trigger = $2 AND d.threshold <= $3
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING achievement_id`,
      [userId, trigger, statCount]
    );
    if (res.rows.length === 0) return [];
    const grantedIds = res.rows.map((r) => r.achievement_id);
    const defs = await pool.query(
      `SELECT id, name, description, icon FROM achievement_defs WHERE id = ANY($1)`,
      [grantedIds]
    );
    return defs.rows;
  } catch (err) {
    console.error('[DB] checkAndGrantAchievements failed:', err.message);
    return [];
  }
}

// ── Event Log ─────────────────────────────────────────────────────────────

// ── Domain Events (Phase 4) ──

export async function insertDomainEvent(gameId, event, { bumpEventSeq } = {}) {
  if (!pool) return;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await pool.query(
        `INSERT INTO domain_events (game_id, seq, type, correlation_id, player_id, aggregate_version, timestamp, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [gameId, event.seq, event.type, event.correlationId || null, event.playerId || null, event.aggregateVersion, event.timestamp, JSON.stringify(event.payload)]
      );
      return; // success
    } catch (err) {
      // 23505 = unique_violation (duplicate seq for this game)
      if (err.code === '23505' && bumpEventSeq && attempt < MAX_RETRIES) {
        console.warn(`[DB] insertDomainEvent duplicate seq ${event.seq} for ${gameId}, bumping (attempt ${attempt}/${MAX_RETRIES})`);
        bumpEventSeq(event);
        continue;
      }
      console.error('[DB] insertDomainEvent failed:', err.message);
      return;
    }
  }
}

export async function getDomainEvents(gameId, afterSeq = 0, limit = 1000) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT * FROM domain_events WHERE game_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
      [gameId, afterSeq, limit]
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getDomainEvents failed:', err.message);
    return [];
  }
}

export async function getLatestDomainSeq(gameId) {
  if (!pool) return 0;
  try {
    const res = await pool.query(
      `SELECT MAX(seq) AS max_seq FROM domain_events WHERE game_id = $1`,
      [gameId]
    );
    return res.rows[0]?.max_seq ?? 0;
  } catch (err) {
    console.error('[DB] getLatestDomainSeq failed:', err.message);
    return 0;
  }
}

// ── Game Snapshots (Phase 4) ──

export async function insertSnapshot(gameId, version, state) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO game_snapshots (game_id, version, state) VALUES ($1, $2, $3)`,
      [gameId, version, JSON.stringify(state)]
    );
  } catch (err) {
    console.error('[DB] insertSnapshot failed:', err.message);
  }
}

export async function getLatestSnapshot(gameId) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT version, state FROM game_snapshots WHERE game_id = $1 ORDER BY version DESC LIMIT 1`,
      [gameId]
    );
    if (res.rows.length === 0) return null;
    return { version: res.rows[0].version, state: res.rows[0].state };
  } catch (err) {
    console.error('[DB] getLatestSnapshot failed:', err.message);
    return null;
  }
}

export async function getActiveGameIdsFromEvents() {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT DISTINCT game_id FROM domain_events ORDER BY game_id`
    );
    return res.rows.map(r => r.game_id);
  } catch (err) {
    console.error('[DB] getActiveGameIdsFromEvents failed:', err.message);
    return [];
  }
}

export async function deleteSnapshots(gameId) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM game_snapshots WHERE game_id = $1`, [gameId]);
  } catch (err) {
    console.error('[DB] deleteSnapshots failed:', err.message);
  }
}

// --- Coverage Persistence ---

/**
 * Sync coverage_regions from the JSON ledger file on every startup.
 * Merges ledger data into DB while preserving DB-only fields (liveStatus, lastLiveCheck).
 * New regions are inserted; existing regions get their code-managed fields updated.
 * Regions removed from the ledger are left in the DB (no deletes).
 */
async function seedCoverageRegions() {
  if (!pool) return;
  try {
    const ledgerPath = join(__dbDirname, '..', 'tests', 'headless', 'coverage-ledger.json');
    let ledger;
    try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); } catch { return; }
    const regions = ledger.regions || {};

    // Load existing DB rows to preserve live statuses
    const existing = {};
    const res = await pool.query('SELECT region_id, region_data FROM coverage_regions');
    for (const row of res.rows) existing[row.region_id] = row.region_data;

    let inserted = 0, updated = 0;
    for (const [id, ledgerData] of Object.entries(regions)) {
      const dbData = existing[id];
      if (dbData) {
        // Preserve DB-only fields, overwrite everything else from ledger
        const merged = { ...ledgerData };
        if (dbData.liveStatus && dbData.liveStatus !== 'untested') merged.liveStatus = dbData.liveStatus;
        if (dbData.lastLiveCheck) merged.lastLiveCheck = dbData.lastLiveCheck;
        await pool.query(
          `UPDATE coverage_regions SET region_data = $2, updated_at = NOW() WHERE region_id = $1`,
          [id, JSON.stringify(merged)]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO coverage_regions (region_id, region_data) VALUES ($1, $2)`,
          [id, JSON.stringify(ledgerData)]
        );
        inserted++;
      }
    }
    console.log(`[DB] Coverage sync: ${inserted} new, ${updated} updated from ledger.`);
  } catch (err) {
    console.error('[DB] seedCoverageRegions failed:', err.message);
  }
}

/** Get all coverage regions as { regionId: regionData }. */
export async function getCoverageRegions() {
  if (!pool) return null;
  try {
    const res = await pool.query('SELECT region_id, region_data FROM coverage_regions ORDER BY region_id');
    const out = {};
    for (const row of res.rows) {
      out[row.region_id] = row.region_data;
    }
    return out;
  } catch (err) {
    console.error('[DB] getCoverageRegions failed:', err.message);
    return null;
  }
}

/** Update a region's live Discord testing status in coverage_regions. */
export async function upsertCoverageLiveStatus(regionId, status, lastCheck) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE coverage_regions
       SET region_data = jsonb_set(jsonb_set(region_data, '{liveStatus}', $2::jsonb), '{lastLiveCheck}', $3::jsonb),
           updated_at = NOW()
       WHERE region_id = $1`,
      [regionId, JSON.stringify(status), JSON.stringify(lastCheck || new Date().toISOString().slice(0, 10))]
    );
  } catch (err) {
    console.error('[DB] upsertCoverageLiveStatus failed:', err.message);
  }
}

/** Update a region's verification level and evidence in coverage_regions. */
export async function updateCoverageVerification(regionId, verification, evidence) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE coverage_regions
       SET region_data = jsonb_set(jsonb_set(region_data, '{verification}', $2::jsonb), '{evidence}', $3::jsonb),
           updated_at = NOW()
       WHERE region_id = $1`,
      [regionId, JSON.stringify(verification), JSON.stringify(evidence || [])]
    );
  } catch (err) {
    console.error('[DB] updateCoverageVerification failed:', err.message);
  }
}

/** Get all live statuses (convenience wrapper for backward compat). */
export async function getCoverageLiveStatuses() {
  const regions = await getCoverageRegions();
  if (!regions) return {};
  const out = {};
  for (const [id, data] of Object.entries(regions)) {
    if (data.liveStatus && data.liveStatus !== 'untested') {
      out[id] = { status: data.liveStatus, lastCheck: data.lastLiveCheck };
    }
  }
  return out;
}

/** Insert a coverage incident. Returns the created row id. */
export async function insertCoverageIncident(incident) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      `INSERT INTO coverage_incidents (region_id, region_name, severity, note, game_id, phase, last_action, undo_fixed, refresh_fixed, siblings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, created_at`,
      [
        incident.regionId || incident.region,
        incident.regionName || '',
        incident.severity,
        incident.note,
        incident.gameId || null,
        incident.phase || null,
        incident.lastAction || null,
        !!incident.undoFixed || !!incident.undoFixedIt,
        !!incident.refreshFixed || !!incident.refreshFixedIt,
        JSON.stringify(incident.siblings || []),
      ]
    );
    return res.rows[0];
  } catch (err) {
    console.error('[DB] insertCoverageIncident failed:', err.message);
    return null;
  }
}

/**
 * Query coverage incidents. Options:
 *   severity: 'blocker' | 'major' | 'minor'
 *   regionId: filter by region
 *   since: ISO date string — only incidents after this date
 *   limit: max rows (default 100)
 */
export async function getCoverageIncidents(opts = {}) {
  if (!pool) return [];
  try {
    const conditions = [];
    const params = [];
    let idx = 1;
    if (opts.severity) { conditions.push(`severity = $${idx++}`); params.push(opts.severity); }
    if (opts.regionId) { conditions.push(`region_id = $${idx++}`); params.push(opts.regionId); }
    if (opts.since) { conditions.push(`created_at >= $${idx++}`); params.push(opts.since); }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = opts.limit || 100;
    const res = await pool.query(
      `SELECT id, region_id, region_name, severity, note, game_id, phase, last_action, undo_fixed, refresh_fixed, siblings, created_at
       FROM coverage_incidents ${where}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params
    );
    return res.rows.map(r => ({
      id: r.id,
      regionId: r.region_id,
      regionName: r.region_name,
      severity: r.severity,
      note: r.note,
      gameId: r.game_id,
      phase: r.phase,
      lastAction: r.last_action,
      undoFixed: r.undo_fixed,
      refreshFixed: r.refresh_fixed,
      siblings: r.siblings || [],
      createdAt: r.created_at,
    }));
  } catch (err) {
    console.error('[DB] getCoverageIncidents failed:', err.message);
    return [];
  }
}

// ── Favorite Decks (personal saved-deck library) ──

export function isFavoritesAvailable() {
  return !!pool;
}

export async function getFavoriteDecks(userId) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT id, saved_name, deck_hash, deck_data, affiliation, point_total,
              last_used_at, use_count, created_at
       FROM favorite_decks
       WHERE user_id = $1
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
      [userId]
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getFavoriteDecks failed:', err.message);
    return null;
  }
}

export async function getFavoriteDeckByHash(userId, deckHash) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT id, saved_name, deck_hash, deck_data, affiliation, point_total
       FROM favorite_decks
       WHERE user_id = $1 AND deck_hash = $2`,
      [userId, deckHash]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB] getFavoriteDeckByHash failed:', err.message);
    return null;
  }
}

export async function getFavoriteDeckById(userId, favoriteId) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT id, saved_name, deck_hash, deck_data, raw_list_text,
              affiliation, point_total, last_used_at, use_count, created_at
       FROM favorite_decks
       WHERE user_id = $1 AND id = $2`,
      [userId, favoriteId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB] getFavoriteDeckById failed:', err.message);
    return null;
  }
}

export async function insertFavoriteDeck(userId, deckHash, savedName, deckData,
                                          rawListText, affiliation, pointTotal) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      `INSERT INTO favorite_decks
         (user_id, deck_hash, saved_name, deck_data, raw_list_text, affiliation, point_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, deck_hash) DO NOTHING
       RETURNING id, saved_name`,
      [userId, deckHash, savedName, JSON.stringify(deckData), rawListText || null,
       affiliation || null, pointTotal ?? null]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB] insertFavoriteDeck failed:', err.message);
    return null;
  }
}

export async function deleteFavoriteDeck(userId, favoriteId) {
  if (!pool) return false;
  try {
    const res = await pool.query(
      `DELETE FROM favorite_decks WHERE user_id = $1 AND id = $2`,
      [userId, favoriteId]
    );
    return res.rowCount > 0;
  } catch (err) {
    console.error('[DB] deleteFavoriteDeck failed:', err.message);
    return false;
  }
}

export async function renameFavoriteDeck(userId, favoriteId, newName) {
  if (!pool) return false;
  try {
    const res = await pool.query(
      `UPDATE favorite_decks SET saved_name = $3, updated_at = NOW()
       WHERE user_id = $1 AND id = $2`,
      [userId, favoriteId, newName]
    );
    return res.rowCount > 0;
  } catch (err) {
    console.error('[DB] renameFavoriteDeck failed:', err.message);
    return false;
  }
}

export async function touchFavoriteDeckUsage(userId, favoriteId) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE favorite_decks SET last_used_at = NOW(), use_count = use_count + 1
       WHERE user_id = $1 AND id = $2`,
      [userId, favoriteId]
    );
  } catch (err) {
    console.error('[DB] touchFavoriteDeckUsage failed:', err.message);
  }
}

// ── Exploration (headless explorer coverage persistence) ─────────────────────

/** Upsert a single exploration transition row. */
export async function upsertExplorationTransition(row) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO exploration_transitions
         (transition_key, round_phase, pending_set, action_type, status,
          headless_count, invariant_fails, context_tags, scenarios_reaching)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (transition_key) DO UPDATE SET
         headless_count = exploration_transitions.headless_count + $6,
         invariant_fails = exploration_transitions.invariant_fails + $7,
         context_tags = CASE
           WHEN exploration_transitions.context_tags = '{}'::jsonb THEN $8
           ELSE exploration_transitions.context_tags || $8
         END,
         scenarios_reaching = COALESCE(
           (SELECT jsonb_agg(DISTINCT val)
            FROM jsonb_array_elements(
              COALESCE(exploration_transitions.scenarios_reaching, '[]'::jsonb) || $9
            ) AS val),
           '[]'::jsonb
         ),
         updated_at = NOW()`,
      [
        row.transition_key,
        row.round_phase || null,
        row.pending_set || null,
        row.action_type || null,
        row.status || 'headless_seen',
        row.headless_count || 0,
        row.invariant_fails || 0,
        JSON.stringify(row.context_tags || {}),
        JSON.stringify(row.scenarios_reaching || []),
      ]
    );
  } catch (err) {
    console.error('[DB] upsertExplorationTransition failed:', err.message);
  }
}

/** Insert an exploration episode record. */
export async function insertExplorationEpisode(episode) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO exploration_episodes
         (episode_id, source, seed_config, total_steps, unique_transitions,
          novel_transitions, invariant_errors, transitions_hit, result, stop_reason, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        episode.episode_id,
        episode.source || 'headless',
        JSON.stringify(episode.seed_config),
        episode.total_steps,
        episode.unique_transitions || 0,
        episode.novel_transitions || 0,
        episode.invariant_errors || 0,
        JSON.stringify(episode.transitions_hit || []),
        episode.result || null,
        episode.stop_reason || null,
        episode.duration_ms || null,
      ]
    );
  } catch (err) {
    console.error('[DB] insertExplorationEpisode failed:', err.message);
  }
}

/** Load all exploration transitions into memory. Returns Map<key, row>. */
export async function loadExplorationTransitions() {
  if (!pool) return new Map();
  try {
    const res = await pool.query('SELECT * FROM exploration_transitions');
    const map = new Map();
    for (const row of res.rows) {
      map.set(row.transition_key, row);
    }
    return map;
  } catch (err) {
    console.error('[DB] loadExplorationTransitions failed:', err.message);
    return new Map();
  }
}

/**
 * Upsert a discord-validated transition. Increments discord_count.
 * Called after a Discord self-play run to record which transitions were proven.
 */
export async function upsertDiscordTransition(transitionKey, roundPhase, pendingSet, actionType) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO exploration_transitions
         (transition_key, round_phase, pending_set, action_type, status, discord_count)
       VALUES ($1, $2, $3, $4, 'discord_seen', 1)
       ON CONFLICT (transition_key) DO UPDATE SET
         discord_count = exploration_transitions.discord_count + 1,
         status = CASE
           WHEN exploration_transitions.status = 'headless_seen' THEN 'discord_proven'
           ELSE exploration_transitions.status
         END,
         updated_at = NOW()`,
      [transitionKey, roundPhase || null, pendingSet || null, actionType || null]
    );
  } catch (err) {
    console.error('[DB] upsertDiscordTransition failed:', err.message);
  }
}

// ── Incidents (Postgres-first error tracking) ─────────────────────────────

/**
 * Insert an incident record. Returns the incident id (or null if DB unavailable).
 * @param {{ game_id?, guild_id?, source?, context?, error_message, error_stack?, selfplay_run_id?, channel_id?, message_link?, metadata? }} inc
 * @returns {Promise<string|null>}
 */
export async function insertIncident(inc) {
  if (!pool || !inc) return null;
  try {
    const res = await pool.query(
      `INSERT INTO incidents (
        game_id, guild_id, source, context, error_message, error_stack,
        selfplay_run_id, channel_id, message_link, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id`,
      [
        inc.game_id ?? null, inc.guild_id ?? null, inc.source ?? 'pvp',
        inc.context ?? null, inc.error_message,
        inc.error_stack ? inc.error_stack.slice(0, 4000) : null,
        inc.selfplay_run_id ?? null, inc.channel_id ?? null,
        inc.message_link ?? null, JSON.stringify(inc.metadata ?? {}),
      ]
    );
    return res.rows[0]?.id?.toString() ?? null;
  } catch (err) {
    console.error('[DB] insertIncident failed:', err.message);
    return null;
  }
}

/**
 * Update an incident with the Discord mirror IDs (thread + message).
 * Sets mirror_status to 'posted'. Called after the bot-logs message is sent.
 */
export async function updateIncidentMirrorPosted(incidentId, threadId, messageId) {
  if (!pool || !incidentId) return;
  try {
    await pool.query(
      `UPDATE incidents SET discord_thread_id = $2, discord_message_id = $3, mirror_status = 'posted' WHERE id = $1`,
      [incidentId, threadId ?? null, messageId ?? null]
    );
  } catch (err) {
    console.error('[DB] updateIncidentMirrorPosted failed:', err.message);
  }
}

/**
 * Mark an incident's mirror as failed. Called when Discord posting throws.
 */
export async function setIncidentMirrorFailed(incidentId) {
  if (!pool || !incidentId) return;
  try {
    await pool.query(
      `UPDATE incidents SET mirror_status = 'failed' WHERE id = $1`,
      [incidentId]
    );
  } catch (err) {
    console.error('[DB] setIncidentMirrorFailed failed:', err.message);
  }
}

/**
 * Resolve an incident by id. Sets status, resolved_by, resolved_at.
 * @returns {Promise<boolean>} true if a row was updated
 */
export async function resolveIncident(incidentId, resolvedByUserId) {
  if (!pool || !incidentId) return false;
  try {
    const res = await pool.query(
      `UPDATE incidents SET status = 'resolved', resolved_by = $2, resolved_at = NOW() WHERE id = $1 AND status = 'open'`,
      [incidentId, resolvedByUserId ?? null]
    );
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    console.error('[DB] resolveIncident failed:', err.message);
    return false;
  }
}

/**
 * Get all incidents for a game that have mirrored Discord resources.
 * Used by killgame cleanup to delete bot-logs threads/messages.
 * @returns {Promise<Array<{ id: string, discord_thread_id: string|null, discord_message_id: string|null }>>}
 */
export async function getIncidentMirrorsForGame(gameId) {
  if (!pool || !gameId) return [];
  try {
    const res = await pool.query(
      `SELECT id, discord_thread_id, discord_message_id FROM incidents
       WHERE game_id = $1 AND mirror_status = 'posted'
         AND (discord_thread_id IS NOT NULL OR discord_message_id IS NOT NULL)`,
      [gameId]
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getIncidentMirrorsForGame failed:', err.message);
    return [];
  }
}

/**
 * Mark incident mirrors as cleaned up (set mirror_status = 'cleaned_up').
 * Called after killgame deletes the Discord resources.
 */
export async function markIncidentMirrorsCleaned(incidentIds) {
  if (!pool || !incidentIds?.length) return;
  try {
    await pool.query(
      `UPDATE incidents SET mirror_status = 'cleaned_up', discord_thread_id = NULL, discord_message_id = NULL
       WHERE id = ANY($1::bigint[])`,
      [incidentIds]
    );
  } catch (err) {
    console.error('[DB] markIncidentMirrorsCleaned failed:', err.message);
  }
}

// ── Coverage Items CRUD ──────────────────────────────────────────────

/** Upsert a single coverage item. On conflict, update name/wired/parent_id. */
export async function upsertCoverageItem(itemId, category, name, opts = {}) {
  if (!pool) return;
  try {
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
  } catch (err) {
    console.error('[DB] upsertCoverageItem failed:', err.message);
  }
}

/**
 * Batch-increment discord_count for multiple coverage items.
 * @param {Map<string,number>} hits - Map of itemId → increment count
 * @param {string} gameId - The game that produced these hits
 */
export async function batchIncrementCoverageDiscord(hits, gameId) {
  if (!pool || !hits || hits.size === 0) return;
  try {
    const ids = [];
    const counts = [];
    for (const [id, count] of hits) {
      ids.push(id);
      counts.push(count);
    }
    await pool.query(
      `UPDATE coverage_items AS c SET
         discord_count = c.discord_count + v.inc,
         last_discord_game = $3,
         last_discord_at = NOW(),
         updated_at = NOW()
       FROM (SELECT unnest($1::text[]) AS item_id, unnest($2::int[]) AS inc) v
       WHERE c.item_id = v.item_id`,
      [ids, counts, gameId]
    );
  } catch (err) {
    console.error('[DB] batchIncrementCoverageDiscord failed:', err.message);
  }
}

/**
 * Get unexercised (or under-exercised) coverage items.
 * @param {object} opts - { category, limit, minDiscord }
 */
export async function getCoverageGaps(opts = {}) {
  if (!pool) return [];
  try {
    const { category, limit = 10, minDiscord = 0 } = opts;
    const conditions = ['discord_count <= $1', 'wired = true'];
    const params = [minDiscord];
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    params.push(limit);
    const res = await pool.query(
      `SELECT item_id, category, name, discord_count, parent_id
       FROM coverage_items
       WHERE ${conditions.join(' AND ')}
       ORDER BY discord_count ASC, name
       LIMIT $${params.length}`,
      params
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getCoverageGaps failed:', err.message);
    return [];
  }
}

/** Get per-category coverage summary. */
export async function getCoverageSummary() {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT
         category,
         count(*)::int AS total,
         count(*) FILTER (WHERE wired = true)::int AS wired,
         count(*) FILTER (WHERE discord_count > 0)::int AS exercised,
         count(*) FILTER (WHERE wired = false)::int AS hard_gaps,
         count(*) FILTER (WHERE verified = true)::int AS verified
       FROM coverage_items
       GROUP BY category
       ORDER BY category`
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getCoverageSummary failed:', err.message);
    return [];
  }
}

/**
 * Batch-set verified status for coverage items that passed correctness checks.
 * Only sets verified=true for passing items (never clears existing verification).
 * @param {Map<string, {verified: boolean, verified_by: string}>} verifiedItems
 */
export async function batchSetCoverageVerified(verifiedItems) {
  if (!pool || !verifiedItems || verifiedItems.size === 0) return;
  try {
    const ids = [];
    const bys = [];
    for (const [id, { verified, verified_by }] of verifiedItems) {
      if (verified) {
        ids.push(id);
        bys.push(verified_by);
      }
    }
    if (ids.length === 0) return;
    await pool.query(
      `UPDATE coverage_items AS c SET
         verified = true,
         verified_by = v.vby,
         verified_at = NOW(),
         updated_at = NOW()
       FROM (SELECT unnest($1::text[]) AS item_id, unnest($2::text[]) AS vby) v
       WHERE c.item_id = v.item_id`,
      [ids, bys]
    );
  } catch (err) {
    console.error('[DB] batchSetCoverageVerified failed:', err.message);
  }
}

/** Get the pool for direct queries (exploration use). */
export function getPool() {
  return pool;
}

// ── Checkpoints ────────────────────────────────────────────────────────────
// Cross-game save/load for testing-from-same-point. Each checkpoint stores
// a full game-state JSON blob plus metadata for the dropdown UI.

export async function insertCheckpoint(cp) {
  if (!pool) return;
  const {
    id, name, originGameId, createdBy, createdAt, gameState,
    mapId, variant, roundAtSave, p1Username, p2Username, gameVersion, dataHash,
  } = cp;
  await pool.query(
    `INSERT INTO checkpoints
       (id, name, origin_game_id, created_by, created_at, game_state,
        map_id, variant, round_at_save, p1_username, p2_username,
        game_version, data_hash)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
    [id, name, originGameId, createdBy, createdAt, JSON.stringify(gameState),
     mapId, variant, roundAtSave, p1Username, p2Username, gameVersion, dataHash],
  );
}

/** List checkpoints visible to a user (creator OR co-player in origin game). */
export async function listCheckpointsForUser(userId, { limit = 50 } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, name, origin_game_id, created_by, created_at,
            map_id, variant, round_at_save, p1_username, p2_username,
            game_version, data_hash
     FROM checkpoints
     WHERE created_by = $1
        OR game_state->>'player1Id' = $1
        OR game_state->>'player2Id' = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/** List checkpoints saved against a specific game. */
/** List all checkpoints, newest first. Used by the new-lobby load flow. */
export async function listAllCheckpoints({ limit = 25 } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, name, origin_game_id, created_by, created_at,
            round_at_save, p1_username, p2_username, map_id
     FROM checkpoints
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function listCheckpointsForGame(originGameId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, name, created_by, created_at, round_at_save
     FROM checkpoints
     WHERE origin_game_id = $1
     ORDER BY created_at DESC`,
    [originGameId],
  );
  return rows;
}

/** Fetch a single checkpoint with its full game_state. */
export async function getCheckpointById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM checkpoints WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Delete a checkpoint by id. Returns true if a row was deleted. */
export async function deleteCheckpoint(id) {
  if (!pool) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM checkpoints WHERE id = $1`,
    [id],
  );
  return rowCount > 0;
}

/** Count checkpoints created by a user (for cap enforcement). */
export async function countCheckpointsByUser(userId) {
  if (!pool) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS n FROM checkpoints WHERE created_by = $1`,
    [userId],
  );
  return parseInt(rows[0]?.n || '0', 10);
}
