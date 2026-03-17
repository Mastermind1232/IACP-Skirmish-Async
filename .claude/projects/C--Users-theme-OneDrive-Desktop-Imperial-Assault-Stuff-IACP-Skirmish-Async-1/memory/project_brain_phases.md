---
name: Brain phase status
description: Current state of the AI brain roadmap — Phase 5 current, Phase 6 planned, phases 1-4 complete
type: project
---

Brain roadmap lives at `docs/brain-roadmap.md`. Six phases total.

- **Phases 1-4**: Complete (tabular → linear → dueling DQN → replay buffer + target network)
- **Phase 5 (Current)**: Within-group scorers — tactical precision for picking the right specific target/space/surge/card inside a chosen action type. Attack scorer has meaningful signal; move/surge/CC need more training games.
- **Phase 6 (Planned)**: Strategic understanding — tempo, initiative, matchup awareness, timing/interrupt reasoning, plus engine certification. Partly AI, partly engine maturity.

**Key gap**: Trained weights are NOT used in live Discord play yet. Bot still runs on hard-coded heuristics from `strategy.js`. This is an open item across Phases 2-5.

**Why:** Completion was stuck at ~55% due to engine bugs, not intelligence limits. After bug fixes + Phase 5, completion reached ~98.5%.

**How to apply:** When working on brain features, reference this phase structure. Phase 6 work should focus on strategic features and engine certification, not more tactical micro-optimization.
