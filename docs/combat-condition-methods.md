# Combat condition sub-methods — compiled from docs/combat-spec.csv

The gate's "check condition → show button → resolve in player order" driver needs
a condition predicate per ability, built from the CSV columns `affects_self`,
`affects_others`, and `conditional`. Per alexanbv (2026-06-16): evaluate **self
first, then others**; one self-method + a set of others/guard sub-methods covers
self-only / others-only / both without N×M combinations. This list is compiled
from the ~629 distinct condition/affects phrases across the spec.

Status: ✅ implemented · 🔧 partial · ⬜ TODO

## A. WHO can use it / who it affects (affects_self / affects_others)

| sub-method | CSV signal | ~rows | status |
|---|---|---|---|
| `attacker_is_self {card}` | affects_self=TRUE | 64 (rr) | ✅ |
| `in_group_of_source {card}` | "figures in this group", "another figure in your group" | 45 | ✅ |
| `within_n_of_source {card, n}` (owner-centric aura) | "within N spaces [of X]" | 164 | ✅ |
| `adjacent_to_source {card}` (= within 1) | "an adjacent friendly/hostile/figure" | 170 | ⬜ |
| `is_the_attack_target` | "the attack target", "the target", "the defender" | ~50 | ⬜ |
| `is_the_attacker` | "the attacker" | 11 | ⬜ |
| `has_los_from_source {card}` | "in your line of sight", "a hostile figure in your LoS" | 48 | ⬜ |
| `has_los_to_source {card}` | "something has LoS to it" | (subset of 48) | ⬜ |
| `figure_has_keyword {kw}` | "friendly TROOPER/WOOKIEE/HUNTER/DROID/VEHICLE/LEADER…" | 96 | ⬜ |

## B. WHETHER it is active (conditional guards)

| sub-method | CSV signal | ~rows | status |
|---|---|---|---|
| `once_per_round_unused` / `once_per_activation_unused` | "once per round/activation", "this round" | 7 | ⬜ |
| `spent_any_token` | "spent a/any token", "after you spend" | 7 | ⬜ |
| `spent_token_of_type {type}` | "spent a Power/Movement/Recover/Focus token" | 6 | 🔧 (spent_power_token ✅) |
| `card_not_exhausted` / `card_not_depleted` | "exhaust this card", "deplete this card" (cost/availability) | many | ⬜ |
| `target_distance_at_least {n}` / `_at_most {n}` | "target space is 5 or more away" | 3 | ⬜ |
| `did_not_attack_this_activation` | "you did not perform an attack this activation" | 4 | ⬜ |
| `a_figure_was_defeated {side}` | "the defender was defeated", "a hostile figure is defeated", "before you are defeated" | ~10 | ⬜ |
| `target_has_condition {cond}` | "stunned/bleeding/weakened/focused/hidden/immobilized" | 5 | ⬜ |
| `target_health_threshold {cmp, frac}` | "suffered damage", "at/below half health", "X+ HP" | 29 | ⬜ |
| `figures_remaining_in_group {cmp, n}` | "figures in/left/remaining", group size | 45 | ⬜ |
| `mission_objective_state {what}` | "terminal/crate/token on", objective markers | 12 | ⬜ |
| `attack_is_ranged` / `attack_is_melee` | weapon/attack type | — | ⬜ |

## Notes
- `adjacent_*` is the within_1 special-case of `within_n_of_source` — share the impl.
- Auras (`within_n`, `adjacent`, `los`, `group`) are ALWAYS owner-centric: locate the
  owner figure(s) of the ability's card on the board, measure from them.
- Several phrases combine (affects_others + a conditional guard) → AND the predicates.
- Keyword/trait checks (`figure_has_keyword`) read dc-effects keywords for the relevant figure.
