"""Ability resolution: dispatch registry + per-pattern handlers.

Top-level entry: import from the resolve_ability submodule explicitly:

    from python.engine.abilities.resolve_ability import resolve_ability

(We avoid re-exporting the symbol at this level so that
`python.engine.abilities.resolve_ability` consistently refers to the
submodule, not the function — important for unittest.mock patching.)
"""
