---
name: search-before-ask-unknowns
description: Before asking the user an "unknown" or "how does X work", search the codebase and docs. If the answer is found, document it in the plan and do not ask. Use when identifying unknowns, filling plan gaps, or when the user asks for "next unknown" or similar.
---

# Search Before Asking Unknowns

## When This Applies

- The user asks for "next unknown" or to identify unknowns.
- You are about to ask the user how something works or whether something is defined.
- You are filling gaps in the plan or troubleshooting.

## Required Workflow

**Before asking the user any question that could be answered by the codebase or docs:**

1. **Search first.** Use `grep` and/or `SemanticSearch` (and read key docs) for:
   - The topic (e.g. "game creation", "lobby", "new-games", "archive", "kill game", "one game per channel").
   - Relevant paths: [index.js](index.js), [docs/](docs/) (especially [ARCHITECTURE_AND_PLAN.md](docs/ARCHITECTURE_AND_PLAN.md), [DISCORD_SERVER_STRUCTURE.md](docs/DISCORD_SERVER_STRUCTURE.md), [GAPS_AND_MISSING.md](docs/GAPS_AND_MISSING.md)), and any handler or data file that might define the behavior.

2. **If you find the answer:**
   - Do **not** ask the user.
   - If the plan does not already state it, add a one-line clarification to [docs/ARCHITECTURE_AND_PLAN.md](docs/ARCHITECTURE_AND_PLAN.md) (e.g. in section 4.5 Plan clarifications) so the behavior is explicit.
   - Then say what you found and that you documented it (or that it was already in the plan).

3. **If you genuinely do not find it** after searching:
   - Ask the user in a short, clear way (one question at a time when possible).

## What to Search

- **How does X work?** → Search for X by name, related handlers (e.g. `lobby_`, `map_selection_`, `undo_`), and any doc that describes flows.
- **Where is Y defined?** → Search for Y in code and in docs (ARCHITECTURE_AND_PLAN, DISCORD_SERVER_STRUCTURE, etc.).
- **Does Z exist?** → Grep for Z and read the surrounding code or doc section.

## Rule

**Do not ask the user something the codebase or docs already define.** Search first; only ask when it is truly unknown.
