import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, ROUND_PHASES,
  VALID_PHASE_TRANSITIONS, VALID_ROUND_PHASE_TRANSITIONS,
  setPhase, setRoundPhase,
} from './phase.js';

describe('setPhase — transition validation', () => {
  let game;

  beforeEach(() => {
    game = { phase: null, roundPhase: null };
  });

  it('allows valid transitions silently', () => {
    game.phase = PHASES.LOBBY;
    setPhase(game, PHASES.MAP_SELECTION);
    assert.equal(game.phase, PHASES.MAP_SELECTION);

    setPhase(game, PHASES.INITIATIVE);
    assert.equal(game.phase, PHASES.INITIATIVE);

    setPhase(game, PHASES.ZONE_SELECTION);
    setPhase(game, PHASES.DEPLOYMENT);
    setPhase(game, PHASES.ATTACHMENT);
    setPhase(game, PHASES.CC_DRAW);
    setPhase(game, PHASES.ROUND_ACTIVE, ROUND_PHASES.START_OF_ROUND);
    assert.equal(game.phase, PHASES.ROUND_ACTIVE);
    assert.equal(game.roundPhase, ROUND_PHASES.START_OF_ROUND);
  });

  it('warns on invalid transition in non-strict mode', (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    game.phase = PHASES.LOBBY;
    setPhase(game, PHASES.ROUND_ACTIVE);
    assert.equal(warnMock.mock.calls.length, 1);
    assert.match(warnMock.mock.calls[0].arguments[0], /Invalid phase transition/);
    // State still updates (non-strict is permissive)
    assert.equal(game.phase, PHASES.ROUND_ACTIVE);
  });

  it('throws on invalid transition in strict mode', () => {
    game.phase = PHASES.LOBBY;
    assert.throws(
      () => setPhase(game, PHASES.ROUND_ACTIVE, null, { strict: true }),
      /Invalid phase transition: lobby → round_active/
    );
  });

  it('allows any → ended transition', () => {
    for (const phase of Object.values(PHASES)) {
      if (phase === PHASES.ENDED) continue;
      game.phase = phase;
      setPhase(game, PHASES.ENDED, null, { strict: true });
      assert.equal(game.phase, PHASES.ENDED);
    }
  });

  it('allows any transition from null/undefined phase (legacy games)', () => {
    game.phase = null;
    setPhase(game, PHASES.ROUND_ACTIVE, null, { strict: true });
    assert.equal(game.phase, PHASES.ROUND_ACTIVE);

    game.phase = undefined;
    setPhase(game, PHASES.DEPLOYMENT, null, { strict: true });
    assert.equal(game.phase, PHASES.DEPLOYMENT);
  });

  it('deployment can go to attachment or cc_draw', () => {
    game.phase = PHASES.DEPLOYMENT;
    setPhase(game, PHASES.ATTACHMENT, null, { strict: true });
    assert.equal(game.phase, PHASES.ATTACHMENT);

    game.phase = PHASES.DEPLOYMENT;
    setPhase(game, PHASES.CC_DRAW, null, { strict: true });
    assert.equal(game.phase, PHASES.CC_DRAW);
  });

  it('ended is terminal — no transitions out', () => {
    game.phase = PHASES.ENDED;
    assert.throws(
      () => setPhase(game, PHASES.LOBBY, null, { strict: true }),
      /Invalid phase transition/
    );
  });

  it('clears roundPhase when leaving round_active', () => {
    game.phase = PHASES.ROUND_ACTIVE;
    game.roundPhase = ROUND_PHASES.ACTIVATION;
    setPhase(game, PHASES.ENDED);
    assert.equal(game.roundPhase, null);
  });
});

describe('setRoundPhase — transition validation', () => {
  let game;

  beforeEach(() => {
    game = { phase: PHASES.ROUND_ACTIVE, roundPhase: null };
  });

  it('allows valid round phase cycle', () => {
    setRoundPhase(game, ROUND_PHASES.START_OF_ROUND, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.START_OF_ROUND);

    setRoundPhase(game, ROUND_PHASES.ACTIVATION, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.ACTIVATION);

    setRoundPhase(game, ROUND_PHASES.END_OF_ROUND, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.END_OF_ROUND);

    setRoundPhase(game, ROUND_PHASES.START_OF_ROUND, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.START_OF_ROUND);
  });

  it('throws on invalid round phase transition in strict mode', () => {
    game.roundPhase = ROUND_PHASES.START_OF_ROUND;
    assert.throws(
      () => setRoundPhase(game, ROUND_PHASES.END_OF_ROUND, { strict: true }),
      /Invalid round phase transition: start_of_round → end_of_round/
    );
  });

  it('warns on invalid round phase transition in non-strict mode', (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    game.roundPhase = ROUND_PHASES.START_OF_ROUND;
    setRoundPhase(game, ROUND_PHASES.END_OF_ROUND);
    assert.equal(warnMock.mock.calls.length, 1);
    // Still updates
    assert.equal(game.roundPhase, ROUND_PHASES.END_OF_ROUND);
  });

  it('allows any transition from null roundPhase (first entry)', () => {
    game.roundPhase = null;
    setRoundPhase(game, ROUND_PHASES.ACTIVATION, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.ACTIVATION);
  });
});

describe('VALID_PHASE_TRANSITIONS map completeness', () => {
  it('has an entry for every PHASES value', () => {
    for (const phase of Object.values(PHASES)) {
      assert.ok(
        phase in VALID_PHASE_TRANSITIONS,
        `Missing transition entry for phase: ${phase}`
      );
    }
  });

  it('all transition targets are valid PHASES values', () => {
    const validPhases = new Set(Object.values(PHASES));
    for (const [from, targets] of Object.entries(VALID_PHASE_TRANSITIONS)) {
      for (const t of targets) {
        assert.ok(validPhases.has(t), `Invalid target ${t} in transition from ${from}`);
      }
    }
  });
});

describe('VALID_ROUND_PHASE_TRANSITIONS map completeness', () => {
  it('has an entry for every ROUND_PHASES value', () => {
    for (const rp of Object.values(ROUND_PHASES)) {
      assert.ok(
        rp in VALID_ROUND_PHASE_TRANSITIONS,
        `Missing transition entry for round phase: ${rp}`
      );
    }
  });

  it('all transition targets are valid ROUND_PHASES values', () => {
    const validRPs = new Set(Object.values(ROUND_PHASES));
    for (const [from, targets] of Object.entries(VALID_ROUND_PHASE_TRANSITIONS)) {
      for (const t of targets) {
        assert.ok(validRPs.has(t), `Invalid target ${t} in transition from ${from}`);
      }
    }
  });
});
