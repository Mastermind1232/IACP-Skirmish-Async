# CRR Semantic Coverage Audit — agent briefing

## Context

We run a CRR atomic-rule ledger at `docs/crr-ledger.json`. Each covered atom cites:
- A span of CRR text (`crr.lines` → `consolidated-rules-raw.txt`) — the rule.
- A probe file (`evidence.files`) with assertions (`evidence.assertions`) — the proof.

A prior audit suggested that ~15% of covered atoms have probes **narrower** than the rule they cite — the probe pins *some* invariant, but the CRR text promises more than the probe proves. That's a real risk: a future engine change could break a clause the probe never checked, and the atom would still look covered.

This audit decides, for every covered skirmish atom, whether the probe **actually covers everything the CRR text promises**, or only part of it.

## Inputs

- `docs/audits/crr-semantic-manifest.json` — array of `{id, summary, crrLines, crrText, evidenceFiles, assertions, evidenceType}`.
- `docs/audits/crr-semantic-groups.json` — map `{A,B,C,D,E}` → array of atom IDs assigned to that group.
- Each evidence file lives under `tests/` — read it in full; the assertions in the manifest are substrings that appear in that file (usually as probe titles or assert messages).

## Your task

For every atom ID in your assigned group:

1. Load the atom's entry from the manifest.
2. Read `crrText` — the actual rule.
3. Read the probe file(s) in `evidenceFiles`. Focus on the full probe context around each assertion, not just the assertion string itself.
4. Decide: does the probe actually verify **every clause** that the CRR text promises?

### Clause decomposition

Break `crrText` into discrete verifiable clauses. Examples:
- "A figure cannot move through enemy figures unless Mobile." → 2 clauses: (1) blocked by default, (2) Mobile bypasses.
- "Each surge can be spent on one surge ability; a surge cannot be spent twice." → 2 clauses: (1) per-surge cost, (2) no double-spend.
- A single-clause rule counts as 1.

### Fit verdict

- **`full`** — the probe (through its assertions and their surrounding test context) exercises every clause.
- **`partial`** — one or more clauses are provably uncovered by the probe.
- **`unclear`** — you can't tell without running the test or diving deeper; flag for human review.

### Missing clauses

For `partial`, list exactly which clauses are uncovered. Be specific — quote CRR wording.

### Risk level

- **`high`** — missing clause is load-bearing (a silent break would corrupt the game state, grant illegal actions, or mis-score VP).
- **`medium`** — missing clause is correctness-relevant but has limited blast radius (rare edge case, minor VP/UI impact).
- **`low`** — missing clause is cosmetic or definitional (terminology, rendering, player-facing wording).
- **`n/a`** — for `full` or `unclear`.

## Output format

Write a single JSON file at `docs/audits/crr-semantic-group-{YOUR_LETTER}.json` with this shape:

```json
{
  "group": "A",
  "atomCount": 46,
  "generatedAt": "2026-04-20",
  "findings": [
    {
      "id": "CRR-ATK-001",
      "clauses": ["clause 1 in your words", "clause 2 in your words"],
      "fit": "partial",
      "missing": ["clause 2 — probe only checks the default path, not the Mobile bypass"],
      "risk": "high",
      "rationale": "one sentence"
    },
    ...
  ]
}
```

Include **every** atom in your group (even `full` ones — they're the evidence that the audit actually ran).

## Guardrails

- **Do not edit any ledger or test files.** Audit-only. Findings file only.
- If the probe file doesn't exist (shouldn't happen post-batch-119, but defensive), mark `fit: "unclear"` and note the missing file.
- If `crrText` is a section heading with no substantive rule (meta atom), mark `fit: "full"` with `clauses: ["heading/meta only"]`.
- Quote CRR wording verbatim when describing missing clauses — don't paraphrase.
- Prefer `partial` over `full` when in genuine doubt — the point of this audit is to find gaps, not declare victory.
