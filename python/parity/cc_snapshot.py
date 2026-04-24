"""Snapshot-based regression oracle for all 293 command cards.

Mirrors `ability_snapshot.py`. For each card, applies the CC via
`resolve_pending_cc_effect` on a deterministic fixture and records
the post-state as JSON. Pytest replays and diffs.

Regenerate after intentional changes:
    python3 -m python.parity.cc_snapshot
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SNAP_DIR = (REPO_ROOT / 'python' / 'parity' / 'oracles' / 'cards'
            / '_cc_snapshots')

SNAP_FIELDS = [
    'dcHealthState',
    'figureConditions',
    'figurePositions',
    'figureStrain',
    'movementBank',
    'freeAttackBonusPending',
    'nextAttackReach',
    'nextAttackBonusSurgeAbilities',
    'nextAttacksBonusHits',
    'mobileMovementActive',
    'pendingCombat',
    'pendingOverrideAttackDice',
    'figurePowerTokens',
    'p1CcHand', 'p2CcHand',
    'p1CcDeck', 'p2CcDeck',
    'p1CcDiscard', 'p2CcDiscard',
    'nextAttackBonuses',
    'nextAttackBonusDamage',
    'restInPeaceActive',
    'noCommandDrawThisRound',
    'burstFirePendingMsgId',
    'stayDownPendingMsgId',
    'faceToFaceActive',
    'closeAndPersonalActive',
    'saberOrbitAttacksRemaining',
    'selfDefeatsAfterAttackMsgId',
    'pendingCcFiredByCard',
    'lastCcEffectResult',
]


def _list_cards() -> List[str]:
    lib = json.load((REPO_ROOT / 'data' / 'cc-effects.json').open())
    return sorted((lib.get('cards') or {}).keys())


def _coerce_keys(v: Any) -> Any:
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if isinstance(k, int):
                out[str(k)] = _coerce_keys(val)
            else:
                out[k] = _coerce_keys(val)
        return out
    if isinstance(v, list):
        return [_coerce_keys(x) for x in v]
    return v


def _apply(card_name: str) -> Dict[str, Any]:
    """Apply a CC through resolve_pending_cc_effect on the fixture."""
    random.seed(42)
    from python.parity.cc_golden import build_cc_fixture
    from python.engine.cards import cc_effects, cc_bulk_named  # noqa

    game, ctx = build_cc_fixture(card_name, playing_pn=1)
    game['pendingCcEffect'] = {
        'cardName': card_name, 'playerNum': ctx['playerNum'],
        'timing': None, 'playableBy': None,
    }
    py_ctx = dict(ctx)
    py_ctx.setdefault('player_num', ctx.get('playerNum'))
    py_ctx.setdefault('msg_id', ctx.get('msgId'))
    py_ctx.setdefault('figure_key', ctx.get('figureKey'))
    py_ctx.setdefault('target_figure_key', ctx.get('targetFigureKey'))
    py_ctx.setdefault('target_player_num', ctx.get('targetPlayerNum'))
    py_ctx.setdefault('target_msg_id', ctx.get('targetMsgId'))
    try:
        result = cc_effects.resolve_pending_cc_effect(game, py_ctx)
    except Exception as e:
        return {'error': f'{type(e).__name__}: {e}'}

    out = {}
    for f in SNAP_FIELDS:
        if f in game and game[f] not in (None, {}, []):
            out[f] = _coerce_keys(game[f])
    if isinstance(result, dict):
        out['_result_keys'] = sorted(
            k for k in result if k in ('applied', 'reason', 'note')
        )
        if 'applied' in result:
            out['_applied'] = result['applied']
    return out


def write_snapshots() -> Dict[str, Any]:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    cards = _list_cards()
    written = 0
    for name in cards:
        snap = _apply(name)
        safe = name.replace('/', '_').replace("'", '_').replace(':', '_').replace(' ', '_').replace('!', '')
        (SNAP_DIR / f'{safe}.json').write_text(
            json.dumps(snap, indent=2, sort_keys=True) + '\n'
        )
        written += 1
    return {'written': written, 'dir': str(SNAP_DIR)}


def check_snapshots() -> Dict[str, Any]:
    cards = _list_cards()
    matched = 0
    missing, mismatches = [], []
    for name in cards:
        safe = name.replace('/', '_').replace("'", '_').replace(':', '_').replace(' ', '_').replace('!', '')
        path = SNAP_DIR / f'{safe}.json'
        if not path.exists():
            missing.append(name)
            continue
        expected = json.loads(path.read_text())
        actual = _apply(name)
        if expected == actual:
            matched += 1
        else:
            mismatches.append({'card': name})
    return {'total': len(cards), 'matched': matched,
            'mismatched': len(mismatches), 'missing': missing,
            'mismatches': mismatches}


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='CC snapshot oracle')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args(argv)
    if args.check:
        r = check_snapshots()
        print(f'CC snapshots: {r["matched"]}/{r["total"]} match, '
              f'{r["mismatched"]} mismatched, {len(r["missing"])} missing')
        for m in r['mismatches'][:20]:
            print(f'  MISMATCH {m["card"]}')
        if r['missing']:
            print(f'  MISSING: {r["missing"][:10]}')
        return 0 if r['mismatched'] == 0 and not r['missing'] else 1
    r = write_snapshots()
    print(f'wrote {r["written"]} CC snapshots to {r["dir"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
