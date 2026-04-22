"""Parity harness: JS ↔ Python engine correctness proof.

Three lines of defense (per plan D6):
1. Ported oracle tests (`parity/oracles/`) — behavioral contracts.
2. Replay harness (`replay_harness.py`) — JS-recorded games replayed in Python.
3. Shared dice stream (`dice_stream_schema.md`) — removes RNG divergence.
"""
