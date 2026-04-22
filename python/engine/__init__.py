"""Python port of the IACP Skirmish game engine.

Authoritative field surface is `_field_inventory.txt` (411 fields across
11 categories). Pending-state resolution paths are catalogued in
`pending_state_inventory.md` (111 entries).

Build order: D1 (this package skeleton + state/serialization) → D2 (mechanics)
→ D3 (abilities) → D4 (cards) → D5 (missions). Parity harness (D6) lands
incrementally alongside D2-D5.
"""
