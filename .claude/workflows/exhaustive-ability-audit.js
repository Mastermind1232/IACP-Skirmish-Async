export const meta = {
  name: 'exhaustive-ability-audit',
  description: 'Audit every IACP ability (1442 spec rows) across 4 dimensions — timing/trigger, player-choice-not-automatic, cost, limitation+tracking, logic — with adversarial verification and a ranked backlog',
  phases: [
    { title: 'Audit', detail: 'audit each ability-spec chunk vs the 4 dimensions against live code' },
    { title: 'Verify', detail: 'adversarially confirm each finding against the real files' },
    { title: 'Synthesize', detail: 'dedup + severity-rank into a written backlog' },
  ],
}

// ── Shared architecture context handed to every audit agent ────────────────
const ARCH = `
REPO: /Users/adammeehan/Public/IACP-Skirmish-Async. The master ability spec is
docs/combat-spec.csv (columns: card, card_type, ability, part, timing, attack_side,
resolution, affects_self, affects_others, conditional, limit, surge_option, effect,
pipelines, notes). It is the SOURCE OF TRUTH for what each ability SHOULD do.

The 4 audit dimensions (designer alexanbv) map to CSV columns:
1. TIMING — the ability must be wired to the correct trigger timepoint matching the
   CSV "timing" (e.g. spend_surges, attack:modifiers, attack:on_declare, attack:rerolls,
   attack:after_resolves, during_activation, special_action, start_of_activation,
   end_of_activation, start_of_round, end_of_round, when_defeated, when_suffers_damage,
   after_deployment, when_opponent_plays_cc, etc.). Wrong window = a finding.
2. CHOICE — if the ability makes ANY choice (target, which die, optional effect, which
   token), it must be OFFERED to the player, never auto-applied. CSV "resolution" =
   "automatic"/"passive" means mandatory auto-apply (correct to auto-fire); "interactive"
   or text with "may" means a player choice that must be offered. Flag: a choice that is
   silently automatic, OR a mandatory effect wrongly shown as a skippable button.
3. COST — correct cost: 1 action vs 2 actions (double action) vs free; plus Strain / MP /
   exhaust / discard-a-card. Cross-check CSV effect/notes + the card text. Flag wrong or
   missing cost, or a pre-click action-budget gate that disagrees with the actual charge.
4. LIMITATION — correct usage limit (CSV "limit": once per attack / activation / round /
   group / figure / None) AND it must be TRACKED in state so it cannot re-fire. Flag:
   missing limit, wrong scope, OR a limit that is declared but never enforced (the handler
   ignores it), OR "MAY"/Skip wrongly burning the limit when nothing was applied.
Also dimension 5 LOGIC — the effect actually executes per the printed text.

WHERE THINGS ARE WIRED (trace each ability to its live code, cite file:line):
- Executable data: data/ability-library.json (type dcSpecial / ccEffect / surge / dcPassive),
  data/dc-effects.json (card abilityText + specialAbilityIds + specialCosts + specialMpCosts),
  data/cc-effects.json (Command Card effects).
- Combat gate: src/engine/combat-timing-registry.js, src/engine/combat-sequence.js (canonical
  window order), src/handlers/combat.js (_GATE_WINDOWS, COMBAT_RESOLVERS, driveModsGate,
  _postGateChooseWindow, handleModsPick, handleCombatSurge), the combat-abilities-*.js
  detection files (mods/rerolls/ondeclare/special/zillo/windows), src/game/combat-conditions.js.
- After-attack: src/handlers/after-attack-resolve.js + after-attack-fire.js.
- Special actions: handleDcSpecial in src/handlers/dc-play-area.js → resolveAbility in
  src/game/abilities.js; cost display src/data-loader.js getDcStats; button render src/discord/components.js getDcActionButtons.
- Surge abilities: handleCombatSurge (combat.js), parseSurgeEffect.
- Command Cards: src/game/cc-timing.js (playability/timing), the cc-play handlers.
- SoA/EoA/round: src/game/soa-orchestrator.js + src/handlers/soa-handler.js, eoa-orchestrator.js +
  eoa-handler.js, src/engine/activation-effects.js, src/handlers/round.js.
- LIMIT-TRACKING PATTERNS (this is what "tracked" means — verify the ability sets+checks one):
  game.roundFigureAbilityUsed[\`\${figureKey}_\${abilityId}\`] (once per round, cleared in round.js);
  actionsData.specialsUsedByFig[figIdx] (once per activation special); combat._*Resolved /
  _markGateAbilityUsed / recordModsChoice (once per attack in the gate); *UsedThisRound /
  *UsedThisActivation maps. A limit with NO set/check anywhere = untracked = a finding.

KNOWN-GOOD (do NOT re-report): the gate walks canonical order; flat passives (+1 Damage) auto-
apply correctly and are idempotent per-window; surge-spend is interactive + tracks per-index uses.
Be precise: every finding MUST cite a real file:line you actually read. Prefer fewer, verified
findings over volume — a later adversarial pass will refute anything you can't substantiate.`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          card: { type: 'string', description: 'card name from the CSV row' },
          ability: { type: 'string', description: 'ability name / id' },
          dimension: { type: 'string', enum: ['timing', 'choice', 'cost', 'limitation', 'logic'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          fileLine: { type: 'string', description: 'concrete file:line you actually read' },
          problem: { type: 'string', description: '1-2 sentences: spec vs actual' },
          proposedFix: { type: 'string' },
        },
        required: ['card', 'ability', 'dimension', 'severity', 'fileLine', 'problem', 'proposedFix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confirmed: { type: 'boolean', description: 'true only if the cited file:line exists AND the bug is real vs the CSV spec' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    correctedFileLine: { type: 'string', description: 'the real file:line if the original was wrong, else echo it' },
    notes: { type: 'string', description: 'why confirmed or refuted (1-2 sentences)' },
  },
  required: ['confirmed', 'confidence', 'correctedFileLine', 'notes'],
}

// ── Chunk the whole spec (lines 2..1443; line 1 is the header) ─────────────
const TOTAL_ROWS = 1442
const CHUNK = 34
const CHUNKS = []
for (let i = 0; i * CHUNK < TOTAL_ROWS; i++) {
  const startLine = 2 + i * CHUNK
  const count = Math.min(CHUNK, TOTAL_ROWS - i * CHUNK)
  CHUNKS.push({ idx: i, startLine, count })
}
log(`Auditing ${TOTAL_ROWS} ability rows in ${CHUNKS.length} chunks of ${CHUNK}.`)

// ── Audit → Verify pipeline (no barrier: each chunk verifies as it finishes) ─
const perChunk = await pipeline(
  CHUNKS,
  // Stage 1: audit one chunk of the spec.
  (c) => agent(
    `${ARCH}\n\nYOUR CHUNK: Read docs/combat-spec.csv with Read offset=${c.startLine} limit=${c.count} ` +
    `(these are ${c.count} ability rows; the header is line 1, re-read it with offset=1 limit=1 if needed). ` +
    `For EACH ability row in your chunk: identify the ability, grep/Read the live wiring for it ` +
    `(by ability slug, card name, or abilityId across src/ and data/), and check all 5 dimensions ` +
    `(timing, choice, cost, limitation+tracked, logic) against the CSV spec. Report ONLY real, concrete ` +
    `problems with a file:line you actually read. If a whole chunk is clean, return an empty findings array. ` +
    `Do NOT edit any files.`,
    { label: `audit:rows ${c.startLine}-${c.startLine + c.count - 1}`, phase: 'Audit', schema: FINDING_SCHEMA },
  ),
  // Stage 2: adversarially verify every finding from this chunk, in parallel.
  (audit, c) => {
    const fs = (audit && audit.findings) || []
    if (!fs.length) return []
    return parallel(fs.map((f) => () =>
      agent(
        `${ARCH}\n\nADVERSARIALLY VERIFY this audit finding. Open the cited file:line and the relevant ` +
        `docs/combat-spec.csv row(s) and the live wiring. Confirm ONLY if (a) the cited code exists as ` +
        `described AND (b) it is genuinely wrong vs the CSV spec / card text. DEFAULT TO confirmed=false ` +
        `if the file:line is wrong/nonexistent, the behavior is actually correct, or you cannot substantiate ` +
        `it. If the file:line was slightly off but the bug is real, set confirmed=true and put the correct ` +
        `location in correctedFileLine.\n\nFINDING:\n${JSON.stringify(f, null, 2)}`,
        { label: `verify:${(f.card || '').slice(0, 24)}/${f.dimension}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ).then((v) => ({ ...f, verdict: v })).catch(() => null),
    ))
  },
)

// Flatten + keep only confirmed findings.
const confirmed = perChunk
  .filter(Boolean)
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.confirmed)
  .map((f) => ({ ...f, fileLine: (f.verdict.correctedFileLine || f.fileLine) }))

const bySev = { high: 0, medium: 0, low: 0 }
const byDim = { timing: 0, choice: 0, cost: 0, limitation: 0, logic: 0 }
for (const f of confirmed) { bySev[f.severity] = (bySev[f.severity] || 0) + 1; byDim[f.dimension] = (byDim[f.dimension] || 0) + 1 }
log(`Confirmed ${confirmed.length} findings — high ${bySev.high} / med ${bySev.medium} / low ${bySev.low}.`)

// ── Synthesize: dedup + rank + write the backlog file ──────────────────────
phase('Synthesize')
const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    backlogFile: { type: 'string' },
    totalAfterDedup: { type: 'integer' },
    high: { type: 'integer' },
    medium: { type: 'integer' },
    low: { type: 'integer' },
    systemicPatterns: { type: 'array', items: { type: 'string' } },
    topFindings: { type: 'array', items: { type: 'string', description: 'one-line: [SEV][dim] card — problem (file:line)' } },
  },
  required: ['backlogFile', 'totalAfterDedup', 'high', 'medium', 'low', 'systemicPatterns', 'topFindings'],
}
const synth = await agent(
  `You are synthesizing the results of an exhaustive IACP ability audit (4 dimensions: timing, ` +
  `player-choice, cost, limitation+tracking, logic). Below are ${confirmed.length} ADVERSARIALLY-CONFIRMED ` +
  `findings as JSON. Tasks: (1) DEDUP — merge findings that are the same root cause / same file:line. ` +
  `(2) Group by SYSTEMIC PATTERN where several findings share a cause (e.g. "handler ignores the library ` +
  `oncePer field", "MAY/Skip burns the limit", "mandatory effect shown as skippable", "inline declare logic ` +
  `duplicated by gate resolver"). (3) Severity-rank. (4) WRITE a clean markdown backlog to ` +
  `docs/ability-audit-overnight-2026-06-26.md with: a summary header (counts by severity + dimension), a ` +
  `"Systemic Patterns" section, then HIGH / MEDIUM / LOW sections where each item is a "### <card> — ` +
  `<ability> [<dimension>]" heading followed by bullet lines for the file:line, the Problem, and the Fix. ` +
  `Use the Write tool to create the file. ` +
  `Return the backlog file path, the deduped counts, the systemic patterns, and a topFindings list (the ` +
  `highest-value ~25 as one-liners).\n\nCONFIRMED FINDINGS:\n${JSON.stringify(confirmed, null, 2)}`,
  { label: 'synthesize-backlog', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return {
  chunksAudited: CHUNKS.length,
  confirmedRaw: confirmed.length,
  bySeverity: bySev,
  byDimension: byDim,
  synthesis: synth,
}
