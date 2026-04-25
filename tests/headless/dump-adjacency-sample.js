#!/usr/bin/env node
/**
 * dump-adjacency-sample.js — deterministic adjacency sample for JS↔Python parity.
 *
 * For each map id and each sampled coord, emits the pre-computed neighbor
 * list from data/map-spaces.json. Python's board_data.load_map_spaces() is
 * expected to produce identical neighbor sets. Sampling is deterministic
 * (seedable) so the two sides dump the same set of coords.
 *
 * Usage:
 *   node tests/headless/dump-adjacency-sample.js           # default 100 per map, all maps
 *   node tests/headless/dump-adjacency-sample.js --maps mos-eisley-outskirts,lothal-wastes
 *   node tests/headless/dump-adjacency-sample.js --count 50
 *
 * Output: JSON on stdout:
 *   {
 *     <mapId>: { <coord>: [<neighbor>, ...] },
 *     ...
 *   }
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MAP_SPACES_PATH = resolve(REPO_ROOT, 'data', 'map-spaces.json');

function parseArgs(argv) {
  const args = { count: 100, maps: null, seed: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') { args.count = parseInt(argv[++i], 10) || 100; }
    else if (argv[i] === '--maps') { args.maps = argv[++i].split(','); }
    else if (argv[i] === '--seed') { args.seed = parseInt(argv[++i], 10) || 1; }
  }
  return args;
}

// Mulberry32 deterministic PRNG — avoids Math.random() non-determinism.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(arr, n, rng) {
  // Deterministic sample (Fisher-Yates partial). Sorted afterwards so output is stable.
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
    out.push(copy[i]);
  }
  return out.sort();
}

function main() {
  const { count, maps: mapFilter, seed } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(MAP_SPACES_PATH, 'utf8'));
  const allMaps = raw.maps || {};
  const mapIds = mapFilter ? mapFilter.filter(m => allMaps[m]) : Object.keys(allMaps).sort();

  const result = {};
  const rng = mulberry32(seed);
  for (const mid of mapIds) {
    const m = allMaps[mid];
    const spaces = (m.spaces || []).slice().sort();
    const sampled = sample(spaces, count, rng);
    const per = {};
    for (const c of sampled) {
      per[c] = (m.adjacency?.[c] || []).slice().sort();
    }
    result[mid] = per;
  }
  process.stdout.write(JSON.stringify(result));
}

main();
