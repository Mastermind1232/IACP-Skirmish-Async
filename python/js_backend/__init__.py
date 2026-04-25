"""Path B — JS game engine as the authoritative training backend.

python.js_backend.jsstepper spawns src/headless/training/server.js and
exchanges JSON-line messages. Replaces python/engine/stepper.py as the
source of rule truth for RL training. Every DC, CC, ability, objective,
and map that exists in the JS engine is available here automatically —
no Python port needed.
"""
