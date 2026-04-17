#!/usr/bin/env node
/**
 * Shared-helper gate eval analyzer.
 *
 * Usage: node analyze-shared-gate.js <run-prefix>
 *
 * Reads three sibling artifacts written by train.js --diagnostic --ability-audit:
 *   <prefix>-diagnostic-games.json    per-game summary (VP, rounds, stopReason, …)
 *   <prefix>-ability-plays.json        every dc_special play with pre/post state
 *   <prefix>.json                      includes _abilityGateAudit in the meta trailer
 *
 * Prints the slice of metrics the user asked for in the re-eval report:
 *   VP/game, rounds/game, round-cap rate, prematureEnd/game
 *   ability plays/game, far-play rate by category, P1/P2 split
 *   planner-vs-non-planner coverage (gate-audit: hit/pass + skip/play by cat)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

const prefix = process.argv[2];
if (!prefix) {
  console.error('usage: analyze-shared-gate.js <run-prefix>');
  process.exit(1);
}

const baseDir = dirname(prefix) === '.' ? '.' : dirname(prefix);
const baseName = basename(prefix);
const gamesPath = join(baseDir, `${baseName}-diagnostic-games.json`);
const playsPath = join(baseDir, `${baseName}-ability-plays.json`);

const games = JSON.parse(readFileSync(gamesPath, 'utf-8'));
const plays = existsSync(playsPath) ? JSON.parse(readFileSync(playsPath, 'utf-8')) : [];

// ── Game-level stats ────────────────────────────────────────────────────────
const n = games.length;
let vp = 0, rounds = 0, roundCap = 0, premEnd = 0;
for (const g of games) {
  vp += g.p1VP + g.p2VP;
  rounds += g.finalRound;
  if (g.stopReason === 'round_cap') roundCap++;
  premEnd += g.prematureEndAct || 0;
}
console.log(`=== ${baseName} (${n} games) ===`);
console.log(`game:  VP/g ${(vp/n).toFixed(2)}  rounds/g ${(rounds/n).toFixed(2)}  round_cap ${(roundCap/n*100).toFixed(1)}%  premEnd/g ${(premEnd/n).toFixed(2)}`);

// ── Ability-play breakdown ──────────────────────────────────────────────────
// "Far play" = actor ≥7 Manhattan from every enemy when the ability fired.
// Only the heuristic paths that hit pickAndAuditAbility can emit far plays;
// anything ≥7 is either a position-unresolvable play or a within-gate-threshold
// edge case (d=7 with boundary errata). The shared-helper fix should push
// far-play rate toward 0 across all categories.
const CATEGORIES = ['offensive', 'off_move', 'defense', 'support', 'other'];
const ABILITY_CATEGORY = {
  'Force Choke':'offensive','Brutality':'offensive','Defensive Fire':'offensive',
  'Dual-Wield Pistols':'offensive','Saber Strike':'offensive','Invasive Procedure':'offensive',
  'Missile Salvo':'offensive','Slam':'offensive','Force Lightning':'offensive',
  'Emperor':'offensive','Tempt':'offensive','Wrist Cord':'offensive',
  'Wrist Flamethrower':'offensive','Brutal Cleave':'offensive','Barrage':'offensive',
  'Trample':'off_move','Pounce':'off_move','Charge':'off_move',
  'Survival is Strength':'defense','Calming Presence':'defense','Force Deflection':'defense',
  'Military Efficiency':'support','Battlefield Leadership':'support','Long-Laid Plans':'support',
  'Strategize':'support','Wisdom':'support','Do or Do Not':'support','Inform':'support',
  'On My Mark':'support','Tactical Maneuver':'support',
};
function cat(name) { return ABILITY_CATEGORY[name] || 'other'; }

const total = { offensive: 0, off_move: 0, defense: 0, support: 0, other: 0 };
const far = { offensive: 0, off_move: 0, defense: 0, support: 0, other: 0 };
const byPN = { 1: 0, 2: 0 };
// priorAttack=true ~ "ability after attack" (within-activation planner path);
// priorAttack=false ~ "ability without prior attack this activation" (non-
// planner emission — argmax / heuristicPick). This isn't a perfect partition
// but it's the closest proxy train.js currently records.
let plannerLike = 0, nonPlanner = 0;
for (const p of plays) {
  const c = cat(p.specialName);
  total[c]++;
  if ((p.distToEnemy ?? 0) >= 7) far[c]++;
  if (p.side === 1 || p.side === 2) byPN[p.side]++;
  if (p.priorAttack || p.priorMove) plannerLike++; else nonPlanner++;
}
const totalPlays = plays.length;
console.log(`plays: ${totalPlays} (${(totalPlays/n).toFixed(2)}/game)  P1:${byPN[1]} P2:${byPN[2]}`);
if (totalPlays > 0) {
  console.log('  by category (total / far≥7 / far-rate):');
  for (const c of CATEGORIES) {
    const t = total[c], f = far[c];
    const rate = t > 0 ? (f/t*100).toFixed(1) : '  -';
    console.log(`    ${c.padEnd(10)} ${String(t).padStart(5)} / ${String(f).padStart(4)} / ${rate.padStart(5)}%`);
  }
}
console.log(`  path proxy: plannerLike (priorAttack||priorMove) ${plannerLike}  non-planner ${nonPlanner}`);
