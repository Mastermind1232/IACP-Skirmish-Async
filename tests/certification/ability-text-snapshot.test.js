/**
 * Ability-Text Snapshot — non-mutating surfacing layer.
 *
 * Protects the 5 known `abilityText`-regex-coupled behavior sites
 * (Beast Tamer "Non-Sentient", Guerilla Tactics, Priority Target,
 * post-deploy adjacency, combat-bridge text parse) from silent drift
 * when `data/dc-effects.json` / `data/cc-effects.json` is edited.
 *
 * Covers:
 *   - DC `abilityText` for every DC that has one (2026-04-16: 239/241;
 *     88-Z and Junk Droid have none)
 *   - CC `effect` for every CC (2026-04-16: 293/293)
 *
 * Behavior:
 *   - Default: compare current data text against the committed snapshot
 *     in `docs/ability-text-snapshot.json`. Fail on any drift with a
 *     readable BEFORE/AFTER diff.
 *   - `UPDATE_ABILITY_TEXT_SNAPSHOT=1 npm test`: regenerate the snapshot
 *     file before comparing. Developer then reviews `git diff` and
 *     commits the snapshot with the rest of their change.
 *
 * When a card's printed text legitimately changes (erratum, reprint,
 * fix), the expected workflow is:
 *     UPDATE_ABILITY_TEXT_SNAPSHOT=1 npm test
 *     git diff docs/ability-text-snapshot.json   # review intentional
 *     git add data/ docs/ability-text-snapshot.json
 *     git commit …
 *
 * Non-mutating: this layer only compares JSON. No handler, engine, or
 * data changes made by the test itself.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const dcData = JSON.parse(readFileSync(resolve(repoRoot, 'data/dc-effects.json'), 'utf8'));
const ccData = JSON.parse(readFileSync(resolve(repoRoot, 'data/cc-effects.json'), 'utf8'));
const dcCards = dcData.cards || dcData;
const ccCards = ccData.cards || ccData;

function buildCurrentSnapshot() {
  const dcSnap = {};
  for (const name of Object.keys(dcCards).sort()) {
    const text = dcCards[name]?.abilityText;
    if (typeof text === 'string' && text.length > 0) dcSnap[name] = text;
  }
  const ccSnap = {};
  for (const name of Object.keys(ccCards).sort()) {
    const text = ccCards[name]?.effect;
    if (typeof text === 'string' && text.length > 0) ccSnap[name] = text;
  }
  return {
    _meta: {
      purpose: "Rules-text snapshot. Guards the 5 regex-coupled abilityText behavior sites in src/ (Beast Tamer 'Non-Sentient', Guerilla Tactics, Priority Target, post-deploy adjacency, combat-bridge parse) against silent card-text drift. Regenerate with: UPDATE_ABILITY_TEXT_SNAPSHOT=1 npm test",
      fieldsCovered: { dc: "abilityText", cc: "effect" },
      counts: { dc: Object.keys(dcSnap).length, cc: Object.keys(ccSnap).length },
    },
    dc: dcSnap,
    cc: ccSnap,
  };
}

const snapshotPath = resolve(repoRoot, 'docs/ability-text-snapshot.json');
const current = buildCurrentSnapshot();

// Update-mode: regenerate the snapshot on-disk before comparing so the
// subsequent test assertions pass, and the developer sees the changes in
// `git diff docs/ability-text-snapshot.json`.
if (process.env.UPDATE_ABILITY_TEXT_SNAPSHOT === '1') {
  writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`[snapshot] Regenerated ${snapshotPath}`);
}

function diffCategory(currentMap, committedMap) {
  const diffs = [];
  for (const name of Object.keys(committedMap)) {
    if (!(name in currentMap)) {
      diffs.push({ name, kind: 'REMOVED', before: committedMap[name], after: null });
    } else if (currentMap[name] !== committedMap[name]) {
      diffs.push({ name, kind: 'CHANGED', before: committedMap[name], after: currentMap[name] });
    }
  }
  for (const name of Object.keys(currentMap)) {
    if (!(name in committedMap)) {
      diffs.push({ name, kind: 'ADDED', before: null, after: currentMap[name] });
    }
  }
  return diffs;
}

function formatDiffs(diffs, label) {
  const lines = diffs.map(d => {
    const truncate = (s) => {
      if (s == null) return 'null';
      const j = JSON.stringify(s);
      return j.length > 180 ? j.slice(0, 180) + '…' : j;
    };
    const header = `  • [${d.kind}] ${d.name}`;
    if (d.kind === 'CHANGED') {
      return `${header}\n      BEFORE: ${truncate(d.before)}\n      AFTER:  ${truncate(d.after)}`;
    }
    if (d.kind === 'ADDED') return `${header}\n      NEW:    ${truncate(d.after)}`;
    return `${header}\n      WAS:    ${truncate(d.before)}`;
  });
  return `${diffs.length} ${label} drift vs snapshot:\n${lines.join('\n')}\n\n` +
    `To accept intentional changes: UPDATE_ABILITY_TEXT_SNAPSHOT=1 npm test\n` +
    `Then review and commit: git diff docs/ability-text-snapshot.json`;
}

describe('Ability-Text Snapshot (non-mutating surfacing)', () => {
  it('snapshot file exists', () => {
    assert.ok(
      existsSync(snapshotPath),
      `Missing snapshot at ${snapshotPath}. Generate it with: UPDATE_ABILITY_TEXT_SNAPSHOT=1 npm test`
    );
  });

  let committed;
  try {
    committed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch (err) {
    committed = null;
    it('snapshot file parses as JSON', () => {
      assert.fail(`Snapshot is not valid JSON: ${err.message}`);
    });
  }

  if (committed) {
    it('summary printed on every run', () => {
      console.log(
        `\n[snapshot] DC abilityText: ${Object.keys(current.dc).length} / CC effect: ${Object.keys(current.cc).length} ` +
        `(committed: DC ${Object.keys(committed.dc || {}).length} / CC ${Object.keys(committed.cc || {}).length})`
      );
      assert.ok(true);
    });

    it('DC abilityText matches committed snapshot', () => {
      const diffs = diffCategory(current.dc, committed.dc || {});
      if (diffs.length > 0) assert.fail(formatDiffs(diffs, 'DC abilityText'));
    });

    it('CC effect text matches committed snapshot', () => {
      const diffs = diffCategory(current.cc, committed.cc || {});
      if (diffs.length > 0) assert.fail(formatDiffs(diffs, 'CC effect'));
    });

    it('snapshot metadata counts are current', () => {
      const actual = {
        dc: Object.keys(current.dc).length,
        cc: Object.keys(current.cc).length,
      };
      assert.deepEqual(
        committed._meta?.counts ?? {},
        actual,
        `Snapshot _meta.counts does not match current counts. Regenerate with UPDATE_ABILITY_TEXT_SNAPSHOT=1 npm test.`
      );
    });
  }
});
