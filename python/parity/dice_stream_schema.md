# DiceStream — shared-RNG format for JS ↔ Python parity

## Purpose

Both engines consume dice from a *pre-recorded ordered list*, not `Math.random()`
or `random.random()`. Any state diff after a replay is therefore an **engine-logic
diff**, not an RNG divergence.

## JSON schema (wire format)

```json
{
  "version": 1,
  "gameId": "TEST_0001",
  "pools": {
    "attack": {
      "red":    [0, 4, 2, ...],
      "blue":   [1, 3, ...],
      "green":  [0, 2, ...],
      "yellow": [5, 1, ...]
    },
    "defense": {
      "white": [0, 3, ...],
      "black": [2, 1, ...]
    }
  },
  "log": [
    {"seq": 0, "color": "red",  "role": "attack",  "faceIdx": 0, "face": {"acc":1,"dmg":2,"surge":0}},
    {"seq": 1, "color": "blue", "role": "attack",  "faceIdx": 3, "face": {"acc":2,"dmg":1,"surge":1}}
  ]
}
```

### Fields

- `version` — schema version. Bump on any breaking change.
- `gameId` — the game this stream was recorded against; informational.
- `pools.attack.<color>` — FIFO queue of face **indices** into
  `data/dice-face-outcomes.json.attack.<color>`, consumed in order each time
  `rollAttackDice(...)` / `rollSingleAttackDie(color)` is called for that color.
  Both JS and Python pop from index 0 per color.
- `pools.defense.<color>` — same for defense rolls (indices into
  `data/dice-face-outcomes.json.defense.<color>`).
- `log` — flat audit trail in consumption order; not used by the replayer, but
  written by the JS recorder so a run can be traced linearly. Each entry is
  `{seq, color, role: "attack"|"defense", faceIdx, face}` where `face` is the
  materialized `{acc,dmg,surge}` or `{block,evade,dodge}` for debugging.

## Consumption contract

Per call-site in `src/game/combat.js`:

| Call-site              | Which pool is consumed                                |
| ---------------------- | ----------------------------------------------------- |
| `rollAttackDice(cs)`   | `pools.attack[c]` for each color `c` in `cs`, in order |
| `rollDefenseDice(c)`   | `pools.defense[c]` once                                |
| `rollSingleAttackDie(c)`  | `pools.attack[c]` once                              |
| `rollSingleDefenseDie(c)` | `pools.defense[c]` once                             |

Python side mirrors this order in D2 when the dice roller is implemented.

## Modes (JS side)

- **Normal** (default) — `Math.random()` path, stream inert. Unchanged behavior.
- **Record** — wrap each roll to append to a per-color log + a flat audit log.
  Enabled via `setDiceRecorder(recorderObj)`.
- **Replay** — pop from the pre-loaded stream instead of `Math.random()`.
  Enabled via `setDiceStream(streamObj)`.
- Both modes can be active simultaneously (replay + re-record for re-verification).
- `clearDiceHooks()` reverts to normal mode.

## Per-player context (deferred)

The current `combat.js` roll signatures do not carry player/role context. This
schema reserves the shape `pools.<role>.<color>` to support a later split into
per-player pools (e.g. `p1Attack` / `p2Defense`) if D2 threading exposes the
active player in the roll path. Until then, **all rolls draw from a single
shared pool per (role, color)**, which is sufficient for deterministic replay.

## Exhaustion behavior

If a stream is set but the requested color's queue is empty, combat.js throws
`DiceStreamExhausted` rather than silently falling back to `Math.random()`.
This is a hard parity guarantee — a silent fallback would defeat the whole
point of the scheme.
