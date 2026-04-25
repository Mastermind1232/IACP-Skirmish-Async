/**
 * Parallel eval-ladder wrapper: shards a ladder run across N worker processes
 * (one per CPU core), aggregates results, merges policy buffers.
 *
 * Each worker runs a contiguous slice of games via eval-ladder.js's
 * --game-range flag. Preserves color balance (even game index → A=P1, odd
 * → A=P2) because game indices are passed through identically. Final Elo
 * is replayed from all workers' gameEvents in index order — byte-identical
 * to single-process output.
 *
 * Usage: same as eval-ladder.js plus --workers=N.
 *   node tests/headless/parallel-ladder.js <path-a> <path-b> 40 --matchups=4 --mcts-a=25 --mcts-b=25 --workers=4
 *
 * Shard artifacts live in /tmp and are deleted on success.
 */
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { tmpdir, cpus } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EVAL_LADDER = join(__dirname, 'eval-ladder.js');
const K_FACTOR = 16;
const DEFAULT_YARDSTICK_ELO = 1500;

function expectedScore(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function eloConfidenceInterval(aWins, bWins, draws) {
  const n = aWins + bWins + draws;
  if (n === 0) return { se: Infinity, ci95: Infinity };
  const score = (aWins + 0.5 * draws) / n;
  const variance = (aWins * (1 - score) ** 2 + bWins * (0 - score) ** 2 + draws * (0.5 - score) ** 2) / (n * n);
  const se = Math.sqrt(variance);
  const pClamp = Math.max(0.01, Math.min(0.99, score));
  const dEloDscore = 400 / (Math.log(10) * pClamp * (1 - pClamp));
  return { se: se * dEloDscore, ci95: 1.96 * se * dEloDscore };
}

function parseArgs() {
  const args = process.argv.slice(2).filter(a => a);
  const positional = args.filter(a => !a.startsWith('-'));
  const flags = args.filter(a => a.startsWith('-'));
  if (positional.length < 2) {
    console.error('Usage: node tests/headless/parallel-ladder.js <path-a> <path-b> [numGames=40] [flags] [--workers=N]');
    process.exit(1);
  }
  const workersFlag = flags.find(f => f.startsWith('--workers='));
  const workers = workersFlag ? parseInt(workersFlag.split('=')[1], 10) : Math.max(1, Math.min(cpus().length - 1, 4));
  const numGames = parseInt(positional[2] || '40', 10);
  const recordPolicyFlag = flags.find(f => f.startsWith('--record-policy='));
  const recordPolicyPath = recordPolicyFlag ? resolve(recordPolicyFlag.split('=')[1]) : null;
  const forwardFlags = flags.filter(f => !f.startsWith('--workers=') && !f.startsWith('--record-policy=') && !f.startsWith('--game-range=') && !f.startsWith('--shard-output='));
  return { pathA: resolve(positional[0]), pathB: resolve(positional[1]), numGames, workers, recordPolicyPath, forwardFlags };
}

function splitRanges(numGames, workers) {
  const ranges = [];
  const base = Math.floor(numGames / workers);
  const rem = numGames % workers;
  let start = 0;
  for (let i = 0; i < workers; i++) {
    const size = base + (i < rem ? 1 : 0);
    if (size === 0) continue;
    ranges.push([start, start + size]);
    start += size;
  }
  return ranges;
}

function runWorker(workerIdx, range, pathA, pathB, numGames, forwardFlags, shardPath, bufferPath, tmpDir) {
  const logPath = join(tmpDir, `worker-${workerIdx}.log`);
  const args = [
    EVAL_LADDER, pathA, pathB, String(numGames),
    `--game-range=${range[0]}:${range[1]}`,
    `--shard-output=${shardPath}`,
    ...forwardFlags,
  ];
  if (bufferPath) args.push(`--record-policy=${bufferPath}`);
  const logStream = writeFileSync; // eager write via appendFileSync below
  const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const logChunks = [];
  child.stdout.on('data', d => logChunks.push(d));
  child.stderr.on('data', d => logChunks.push(d));
  return new Promise((resolveP, reject) => {
    child.on('exit', code => {
      writeFileSync(logPath, Buffer.concat(logChunks));
      if (code !== 0) {
        console.error(`[W${workerIdx}] exited ${code} — see ${logPath}`);
        reject(new Error(`Worker ${workerIdx} exited ${code}`));
      } else {
        console.log(`[W${workerIdx}] done: ${range[0]}..${range[1]} → ${logPath}`);
        resolveP();
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  const { pathA, pathB, numGames, workers, recordPolicyPath, forwardFlags } = parseArgs();
  const ranges = splitRanges(numGames, workers);
  const tmpDir = mkdtempSync(join(tmpdir(), 'parallel-ladder-'));
  const shardPaths = ranges.map((_, i) => join(tmpDir, `shard-${i}.json`));
  const bufferShardPaths = recordPolicyPath ? ranges.map((_, i) => join(tmpDir, `buf-${i}.json`)) : [];

  console.log(`Parallel ladder: ${numGames}g across ${ranges.length} workers`);
  console.log(`  A=${pathA}`);
  console.log(`  B=${pathB}`);
  console.log(`  Ranges: ${ranges.map(r => `[${r[0]}..${r[1]})`).join(' ')}`);
  console.log(`  Workdir: ${tmpDir}`);
  if (recordPolicyPath) console.log(`  Record-policy: ${recordPolicyPath} (${ranges.length} shard buffers)`);

  const startTime = Date.now();
  await Promise.all(ranges.map((r, i) => runWorker(
    i, r, pathA, pathB, numGames, forwardFlags, shardPaths[i],
    recordPolicyPath ? bufferShardPaths[i] : null, tmpDir,
  )));
  const wall = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`All workers done in ${wall}s`);

  const shards = shardPaths.map(p => JSON.parse(readFileSync(p, 'utf8')));
  const allEvents = [];
  let totalSamples = 0;
  const perMatchup = {};
  for (const s of shards) {
    allEvents.push(...s.gameEvents);
    totalSamples += s.samplesRecorded | 0;
    for (const [name, mu] of Object.entries(s.perMatchup || {})) {
      const cur = perMatchup[name] || { games: 0, aWins: 0, bWins: 0, draws: 0, vpDelta: 0 };
      cur.games += mu.games; cur.aWins += mu.aWins; cur.bWins += mu.bWins; cur.draws += mu.draws;
      cur.vpDelta += mu.vpDelta;
      perMatchup[name] = cur;
    }
  }
  allEvents.sort((a, b) => a.index - b.index);

  // Replay Elo in index order to match single-process output byte-identical
  let eloA = DEFAULT_YARDSTICK_ELO, eloB = DEFAULT_YARDSTICK_ELO;
  let aWins = 0, bWins = 0, draws = 0, vpDeltaSum = 0;
  for (const ev of allEvents) {
    if (ev.aWon) aWins++;
    else if (ev.bWon) bWins++;
    else draws++;
    vpDeltaSum += (ev.aVp - ev.bVp);
    const scoreA = ev.aWon ? 1.0 : (ev.drew ? 0.5 : 0.0);
    const expA = expectedScore(eloA, eloB);
    eloA += K_FACTOR * (scoreA - expA);
    eloB += K_FACTOR * ((1 - scoreA) - (1 - expA));
  }
  const games = allEvents.length;
  const eloDelta = eloA - eloB;
  const { ci95 } = eloConfidenceInterval(aWins, bWins, draws);
  const avgVpDelta = vpDeltaSum / games;

  // Merge policy buffers if requested
  if (recordPolicyPath) {
    const mergedSamples = [];
    for (const p of bufferShardPaths) {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (data.samples) mergedSamples.push(...data.samples);
    }
    writeFileSync(recordPolicyPath, JSON.stringify({
      samples: mergedSamples,
      writeIdx: mergedSamples.length,
      count: mergedSamples.length,
    }));
    const zDist = { '-1': 0, '0': 0, '1': 0, null: 0 };
    for (const s of mergedSamples) zDist[s.z ?? 'null']++;
    console.log(`\n[record-policy] merged ${mergedSamples.length} samples → ${recordPolicyPath}`);
    console.log(`[record-policy] z distribution: -1=${zDist['-1']} 0=${zDist['0']} +1=${zDist['1']} null=${zDist.null} (this run added ${totalSamples})`);
  }

  console.log('\n=== LADDER RESULT ===');
  console.log(`Games: ${games}`);
  console.log(`A wins: ${aWins} (${(100 * aWins / games).toFixed(1)}%)`);
  console.log(`B wins: ${bWins} (${(100 * bWins / games).toFixed(1)}%)`);
  console.log(`Draws:  ${draws} (${(100 * draws / games).toFixed(1)}%)`);
  console.log(`Avg VP delta (A - B): ${avgVpDelta.toFixed(2)}`);
  console.log(`Running Elo: A=${eloA.toFixed(1)}  B=${eloB.toFixed(1)}`);
  console.log(`Elo delta (A - B): ${eloDelta.toFixed(1)} ± ${ci95.toFixed(1)} (95% CI)`);
  console.log(`Interpretation: ${Math.abs(eloDelta) > ci95 ? 'SIGNIFICANT' : 'NOT significant'} at 95%`);

  const matchupNames = Object.keys(perMatchup);
  if (matchupNames.length > 1) {
    console.log('\nPer matchup:');
    for (const [name, mu] of Object.entries(perMatchup)) {
      const winPct = (100 * mu.aWins / mu.games).toFixed(1);
      const vp = (mu.vpDelta / mu.games).toFixed(2);
      console.log(`  ${name}: ${mu.aWins}W ${mu.bWins}L ${mu.draws}D (${winPct}%) | ΔVP ${vp}`);
    }
  }

  // Cleanup shard JSONs (keep worker logs for debugging)
  for (const p of shardPaths) { try { unlinkSync(p); } catch {} }
  for (const p of bufferShardPaths) { try { unlinkSync(p); } catch {} }
  console.log(`\nWall time: ${wall}s | Workers: ${ranges.length} | Speedup target: ~${ranges.length}x vs serial`);
}

main().catch(err => {
  console.error('Parallel ladder failed:', err);
  process.exit(1);
});
