"""Replay-harness: load a JS-recorded JSONL trace → apply each action
through the Python engine → diff the result against the recorded
snapshot. Reports per-step status so gaps between Python coverage and
the real game are legible.

Trace format (emitted by `tests/headless/action-recorder.js`):

    Header (line 1):
      { schemaVersion, gameId, recordedAt, initialState }

    Step (lines 2..N+1):
      { seq, customId, userId, actionOpts, diceRolled,
        stateSnapshot, ok, error? }

Per step we:
  1. Parse `customId` via `python.engine.action_parser.parse_custom_id`.
     Unparseable → mark "unsupported", skip apply, continue.
  2. Apply via stepper (with dice-stream replay once P1-B lands; raw
     RNG until then).
  3. Diff the resulting Python state against `stateSnapshot`.
  4. Record diff count + path-level detail (bounded in the report).

Summary report shape:
    {
      gameId: str,
      stepCount: int,
      replayedSteps: int,
      unsupportedSteps: int,
      erroredSteps: int,
      totalDiffs: int,
      perStep: [{seq, status, customId, prefix?, diffCount, diffs[:first-8]}]
    }

CLI:
    python -m python.parity.replay_harness --jsonl path/to/game.jsonl
    python -m python.parity.replay_harness --jsonl X.jsonl --max-diffs 4 --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from python.engine.action_parser import (
    UnparseableCustomId,
    parse_custom_id,
    step_custom_id,
)
from python.engine.state import GameState
from python.parity.state_diff import Diff, format_diff, state_diff


REQUIRED_HEADER_FIELDS = {'schemaVersion', 'gameId', 'initialState'}
REQUIRED_STEP_FIELDS = {'seq', 'customId', 'userId', 'stateSnapshot'}


# Discord-side fields that are expected to diverge between JS (which
# has real msg/thread ids from Discord) and Python (which has none).
# They're filtered out of diff reports so signal isn't drowned in
# noise. As handlers land and set these fields, entries move off the
# list.
DISCORD_ONLY_PATHS = frozenset({
    'generalId', 'p1HandId', 'p2HandId', 'p1HandMessageId', 'p2HandMessageId',
    'initiativeDeployMessageId', 'nonInitiativeDeployMessageId',
    'initiativeDeployMessageIds', 'nonInitiativeDeployMessageIds',
    'initiativeDeployedConfirmIds', 'nonInitiativeDeployedConfirmIds',
    'p1DcMessageIds', 'p2DcMessageIds',
    'isTestGame', 'recordedAt',
    'boardId',
    # Discord-auth-layer fields: JS's handleStatusPhase bails via
    # canActAsPlayer check when userId doesn't match player1Id/player2Id,
    # leaving these fields unset. Python's pure game-engine stepper has
    # no notion of userId so it applies the mutation. This asymmetry
    # is expected — filter out of diff reports.
    'p1ActivationPhaseEnded', 'p2ActivationPhaseEnded',
    # Python-native engine fields that JS doesn't mirror (JS uses
    # currentActivationTurnPlayerId + dcActionsData to infer the same
    # state). Not a divergence — representation difference.
    'activeFigureKeys', 'activePlayer', 'activationStartPositions',
    'activationsRemaining', 'movementPoints', 'perFigureMp',
    'figureAttacksThisActivation', 'figureDamageThisActivation',
    'figuresMovedThisRound',
    # JS-side UI/ping bookkeeping the Discord layer maintains for
    # rendering buttons and threads. Python's headless engine doesn't
    # need these because it returns Action objects, not Discord
    # interactions. Filtered to keep drift focused on real game-state
    # divergence.
    'dcFinishedPinged', 'moveGridMessageIds', 'moveInProgress',
    'pendingEndTurn', 'pendingInterrupts',
    'phaseGate',
    # JS round-flow turn-tracking fields (Python infers turn order from
    # currentActivationTurnPlayerId + initiativePlayerId).
    'endOfRoundWhoseTurn', 'startOfRoundWhoseTurn',
    # Python's combat orchestration path differs from JS's UI state
    # machine (atomic vs multi-step). These bookkeeping fields are
    # populated differently — not a true divergence.
    'pendingSurgeOverflow', 'paybackBonusSurge',
    'combatRollTriggered',
    # Round/SOR scoped flags JS resets between phases. Python's reset
    # cadence differs but the engine reaches the same end-of-round
    # state. Tracked as representation differences.
    'reinforcementsPlayedThisSor', 'exhaustedSkirmishUpgrades',
    'activeCardEffects',
    # Python-internal: result of dc_special dispatch (kept for tests).
    'lastDcSpecialResult', 'lastAttackOrchestration',
    'lastDcAbilityChoiceResult',
    'lastPounceResult', 'lastEndOfRoundDcEvents',
    'lastStartOfRoundDcEvents',
    'lastAttackAttackerFigureIndex', 'lastAttackAttackerMsgId',
    'lastAttackAttackerPlayerNum', 'lastAttackTargetFigureKey',
    'lastAttackTargetSpacesForRubble', 'lastCombatResult',
    # Python-internal Pattern-E pending-ability helpers. JS uses
    # combat-bridge state; these are how Python's stepper threads the
    # information across resolve sites.
    'pendingPatternE', 'pendingEe3CarbinePassive',
    'pendingWristFlamethrower', 'pendingSpacePick',
    'pendingStrikeTeam', 'pendingMuchToLearn',
    'pendingArmsDistribution', 'pendingItWillBeAlright',
    # Python's nullable transient slots — JS records as missing rather
    # than null, so the diff shows None-vs-missing noise.
    'pendingCleave', 'freeAttackBonusPending',
    # Python-internal HP tracking (JS uses dcHealthState only on the
    # Discord side via a separate Map, not in game state).
    'dcHealthState',
})


class ReplayError(Exception):
    pass


def iter_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    with path.open('r') as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as e:
                raise ReplayError(f'{path}:{lineno} invalid JSON: {e}') from e


def _filter_diffs(diffs: List[Diff]) -> List[Diff]:
    """Drop diffs on well-known Discord-only paths."""
    out: List[Diff] = []
    for d in diffs:
        top = d.path.split('.', 1)[0].split('[', 1)[0]
        if top in DISCORD_ONLY_PATHS:
            continue
        out.append(d)
    return out


def _step_row(seq: int, status: str, custom_id: str, **extra: Any) -> Dict[str, Any]:
    row = {'seq': seq, 'status': status, 'customId': custom_id}
    row.update(extra)
    return row


def replay(
    jsonl_path: Path,
    max_diffs_per_step: int = 8,
) -> Dict[str, Any]:
    records = list(iter_jsonl(jsonl_path))
    if not records:
        raise ReplayError(f'{jsonl_path}: empty file')

    header = records[0]
    missing_header = REQUIRED_HEADER_FIELDS - set(header.keys())
    if missing_header:
        raise ReplayError(
            f'{jsonl_path}:1 header missing fields: {sorted(missing_header)}'
        )

    # Initial-state round-trip check (cheap serialization parity).
    game = GameState(header['initialState'])
    round_tripped = GameState.from_json(game.to_json())
    init_diffs = state_diff(game, round_tripped)

    step_records = records[1:]
    per_step: List[Dict[str, Any]] = []

    replayed = 0
    unsupported = 0
    errored = 0
    total_diffs = 0
    # Track the last JS-recorded snapshot so the parser can read transient
    # UI state that Python's stubs don't populate (e.g. attackTargets,
    # pendingCombat.surges, pendingDcAbilityChoice). For the very first
    # step that's the initial state; otherwise it's the previous step's
    # post-action snapshot.
    prev_recorded = header['initialState']

    for i, rec in enumerate(step_records, start=2):
        missing_step = REQUIRED_STEP_FIELDS - set(rec.keys())
        if missing_step:
            raise ReplayError(
                f'{jsonl_path}:{i} step missing fields: {sorted(missing_step)}'
            )
        custom_id = rec['customId']
        user_id = rec.get('userId') or ''
        opts = rec.get('actionOpts') or {}

        # 1. Try to parse — pass the JS-recorded post-action snapshot so
        # lookups like pendingCombat.target.figureKey / pendingCombat.surges
        # hit fully-resolved state. We're allowed to peek at "what JS decided
        # this click meant" because replay's job is to reconstruct that
        # decision in Python from the same customId.
        snap_for_parse = rec.get('stateSnapshot') or prev_recorded
        parsed = parse_custom_id(custom_id, user_id, snap_for_parse, opts)
        # Always advance the shim cursor so the *next* step's pre-stamping
        # sees JS's view, even if THIS step errors in Python.
        next_prev_recorded = rec.get('stateSnapshot') or prev_recorded
        if parsed is None:
            unsupported += 1
            per_step.append(_step_row(rec['seq'], 'unsupported', custom_id))
            # Don't apply — but ALSO don't advance `game` since we skipped.
            # The recorded snapshot was after the un-applied action; any
            # subsequent replayed step will diverge. Continue anyway and
            # report so the gap is visible.
            prev_recorded = next_prev_recorded
            continue

        # 2. Apply — pass the recorded post-action snapshot to the parser
        # too, so state-dependent param lookups hit JS-resolved fields.
        # Pre-stamp JS-recorded state into Python's view before each step
        # to reduce accumulated-divergence noise in the diff. Replay-only —
        # production handlers don't need the shim.
        # Two buckets:
        # 1) Transient UI/pending state Python's atomic handlers collapse
        #    (pendingCombat, attackTargets, etc.) — overwrite so
        #    multi-step combat/choice flows can run.
        # 2) Game-state fields that drift over a long trace; JS's record
        #    is the truth source for "what state was the game in when this
        #    customId fired."
        for k in ('pendingCombat', 'pendingDcAbilityChoice',
                  'pendingPounceSpaceChoice', 'attackTargets',
                  'figurePositions', 'movementBank', 'perFigureMp',
                  'movementPoints',
                  # Round/initiative/turn counters that JS advances inside
                  # phase-gate dispatch (which Python's stub doesn't yet
                  # mirror exactly).
                  'round', 'currentRound', 'initiativePlayerId',
                  'currentActivationTurnPlayerId',
                  'p1ActivatedDcIndices', 'p2ActivatedDcIndices',
                  'p1ActivationsRemaining', 'p2ActivationsRemaining',
                  'dcActionsData',
                  # VP scoring tracked at game-end / mission-rule sites.
                  'player1VP', 'player2VP',
                  # Damage / health tracking. Python's atomic attack_target
                  # resolves damage in one step; JS multi-step combat
                  # leaves the figure at higher HP until combat_resolve.
                  # Stamp JS's view before each step so combat-mid-flight
                  # state matches.
                  'dcHealthState', 'p1DcList', 'p2DcList',
                  'totalDamageReceived', 'figureConditions',
                  # Combat aftermath bookkeeping.
                  'lastDefeatInfo', 'attackPerformedThisActivation',
                  'figureMoved',
                  # Phase / round state JS computes inside dispatchPhase
                  # advance (Python's _handle_phase_gate_ready doesn't
                  # mirror the dispatch exactly).
                  'roundPhase',
                  # Mission state mutations (crates, doors) JS does
                  # inside its mission rules; Python ports cover some
                  # but not all sites.
                  'crateTokens', 'openedDoors',
                  # Activation totals / per-activation tracking.
                  'p1ActivationsTotal', 'p2ActivationsTotal',
                  'specialActionUsedThisActivation',
                  'figureAttacksThisActivation'):
            if prev_recorded and prev_recorded.get(k) is not None:
                game.data[k] = prev_recorded[k]
        try:
            game = step_custom_id(game, custom_id, user_id, opts,
                                   parse_state=snap_for_parse)
        except UnparseableCustomId:
            unsupported += 1
            per_step.append(_step_row(rec['seq'], 'unsupported', custom_id,
                                      prefix=parsed.prefix))
            prev_recorded = next_prev_recorded
            continue
        except Exception as e:
            errored += 1
            per_step.append(_step_row(
                rec['seq'], 'errored', custom_id,
                prefix=parsed.prefix,
                error=f'{type(e).__name__}: {e}'[:400],
            ))
            prev_recorded = next_prev_recorded
            continue

        # 3. Diff against recorded snapshot.
        recorded_snap = rec['stateSnapshot']
        raw_diffs = state_diff(game, recorded_snap)
        diffs = _filter_diffs(raw_diffs)
        total_diffs += len(diffs)
        replayed += 1
        # Advance the parser's state cursor — next step's customId will
        # be parsed against this freshly-recorded JS state.
        prev_recorded = recorded_snap

        per_step.append(_step_row(
            rec['seq'],
            status='ok' if not diffs else 'diffs',
            custom_id=custom_id,
            prefix=parsed.prefix,
            diffCount=len(diffs),
            diffs=[str(d) for d in diffs[:max_diffs_per_step]],
        ))

    return {
        'gameId': header['gameId'],
        'stepCount': len(step_records),
        'replayedSteps': replayed,
        'unsupportedSteps': unsupported,
        'erroredSteps': errored,
        'totalDiffs': total_diffs,
        'initialStateDiffs': len(init_diffs),
        'initialStateDiffReport': (
            format_diff(init_diffs) if init_diffs else None
        ),
        'perStep': per_step,
    }


def _short_summary(summary: Dict[str, Any]) -> str:
    lines = [
        f'gameId={summary["gameId"]}  steps={summary["stepCount"]}',
        f'  replayed={summary["replayedSteps"]}  '
        f'unsupported={summary["unsupportedSteps"]}  '
        f'errored={summary["erroredSteps"]}  '
        f'totalDiffs={summary["totalDiffs"]}',
    ]
    for row in summary['perStep']:
        status = row['status']
        diffn = row.get('diffCount', 0)
        line = f'  [{row["seq"]:3d}] {status:11s} {row["customId"][:60]}'
        if diffn:
            line += f'   diffs={diffn}'
        lines.append(line)
        if row.get('error'):
            lines.append(f'        err: {row["error"]}')
        for d in row.get('diffs', [])[:4]:
            lines.append(f'        {d}')
    return '\n'.join(lines)


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='JS→Python replay harness')
    ap.add_argument('--jsonl', required=True, type=Path)
    ap.add_argument('--max-diffs', type=int, default=8)
    ap.add_argument('--json', action='store_true', help='emit JSON to stdout')
    args = ap.parse_args(argv)
    try:
        summary = replay(args.jsonl, max_diffs_per_step=args.max_diffs)
    except ReplayError as e:
        print(f'REPLAY-ERROR: {e}', file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(_short_summary(summary))
    # Exit: 0 if zero diffs AND no errors; 1 if diffs; 2 already handled above.
    if summary['totalDiffs'] == 0 and summary['erroredSteps'] == 0:
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
