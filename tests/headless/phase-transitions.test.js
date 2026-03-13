import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, ROUND_PHASES,
  VALID_PHASE_TRANSITIONS, VALID_ROUND_PHASE_TRANSITIONS,
  setPhase, setRoundPhase,
} from '../../src/game/phase.js';

describe('phase transition audit', () => {
  it('all valid phase transitions succeed in strict mode', () => {
    for (const [from, targets] of Object.entries(VALID_PHASE_TRANSITIONS)) {
      for (const to of targets) {
        const game = { phase: from, roundPhase: null };
        setPhase(game, to, null, { strict: true });
        assert.equal(game.phase, to, `${from} → ${to} should succeed`);
      }
    }
  });

  it('all invalid phase transitions throw in strict mode', () => {
    const allPhases = Object.values(PHASES);
    for (const from of allPhases) {
      const allowed = new Set(VALID_PHASE_TRANSITIONS[from] || []);
      allowed.add(PHASES.ENDED); // Any → ended always allowed
      for (const to of allPhases) {
        if (allowed.has(to) || from === to) continue;
        if (from === PHASES.ENDED && to === PHASES.ENDED) continue;
        const game = { phase: from, roundPhase: null };
        assert.throws(
          () => setPhase(game, to, null, { strict: true }),
          /Invalid phase transition/,
          `${from} → ${to} should throw`
        );
      }
    }
  });

  it('full round cycle works', () => {
    const game = { phase: PHASES.ROUND_ACTIVE, roundPhase: null };
    setRoundPhase(game, ROUND_PHASES.START_OF_ROUND, { strict: true });
    setRoundPhase(game, ROUND_PHASES.ACTIVATION, { strict: true });
    setRoundPhase(game, ROUND_PHASES.END_OF_ROUND, { strict: true });
    setRoundPhase(game, ROUND_PHASES.START_OF_ROUND, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.START_OF_ROUND);
  });

  it('full game phase flow: lobby → ended', () => {
    const game = { phase: null, roundPhase: null };
    setPhase(game, PHASES.LOBBY, null, { strict: true });
    setPhase(game, PHASES.MAP_SELECTION, null, { strict: true });
    setPhase(game, PHASES.INITIATIVE, null, { strict: true });
    setPhase(game, PHASES.ZONE_SELECTION, null, { strict: true });
    setPhase(game, PHASES.DEPLOYMENT, null, { strict: true });
    setPhase(game, PHASES.ATTACHMENT, null, { strict: true });
    setPhase(game, PHASES.CC_DRAW, null, { strict: true });
    setPhase(game, PHASES.ROUND_ACTIVE, ROUND_PHASES.START_OF_ROUND, { strict: true });
    assert.equal(game.roundPhase, ROUND_PHASES.START_OF_ROUND);
    setPhase(game, PHASES.ENDED, null, { strict: true });
    assert.equal(game.phase, PHASES.ENDED);
    assert.equal(game.roundPhase, null);
  });

  it('deployment can skip attachment phase', () => {
    const game = { phase: PHASES.DEPLOYMENT, roundPhase: null };
    setPhase(game, PHASES.CC_DRAW, null, { strict: true });
    assert.equal(game.phase, PHASES.CC_DRAW);
  });
});
