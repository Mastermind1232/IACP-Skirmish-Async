import { Saga } from './saga.js';

export const COMBAT_STATES = {
  DECLARED: 'DECLARED',
  READY_CHECK: 'READY_CHECK',
  ROLLING: 'ROLLING',
  REROLL_WINDOW: 'REROLL_WINDOW',
  SURGE_SPENDING: 'SURGE_SPENDING',
  RESOLUTION: 'RESOLUTION',
  COMPLETED: 'COMPLETED',
};

export class CombatSaga extends Saga {
  constructor(id, combatData = {}) {
    super(id, 'combat', { phase: COMBAT_STATES.DECLARED, p1Ready: false, p2Ready: false, ...combatData });
  }

  markReady(playerNum) {
    const key = playerNum === 1 ? 'p1Ready' : 'p2Ready';
    this.state[key] = true;
    this.recordStep('markReady', { playerNum });
    if (this.bothReady()) {
      this.state.phase = COMBAT_STATES.READY_CHECK;
    }
  }

  bothReady() {
    return this.state.p1Ready && this.state.p2Ready;
  }

  startRolling() {
    this.state.phase = COMBAT_STATES.ROLLING;
    this.recordStep('startRolling');
  }

  setRolls(attackRoll, defenseRoll) {
    this.state.attackRoll = attackRoll;
    this.state.defenseRoll = defenseRoll;
    this.state.phase = COMBAT_STATES.REROLL_WINDOW;
    this.recordStep('setRolls', { attackRoll, defenseRoll });
  }

  enterRerollWindow() {
    this.state.phase = COMBAT_STATES.REROLL_WINDOW;
    this.recordStep('enterRerollWindow');
  }

  enterSurgeSpending() {
    this.state.phase = COMBAT_STATES.SURGE_SPENDING;
    this.recordStep('enterSurgeSpending');
  }

  resolve(result) {
    this.state.phase = COMBAT_STATES.COMPLETED;
    this.state.result = result;
    this.recordStep('resolve', result);
    this.complete();
  }

  getExpectedActions() {
    switch (this.state.phase) {
      case COMBAT_STATES.DECLARED: return ['combat_ready'];
      case COMBAT_STATES.READY_CHECK: return ['combat_ready'];
      case COMBAT_STATES.ROLLING: return ['combat_roll'];
      case COMBAT_STATES.REROLL_WINDOW: return ['combat_reroll', 'combat_skip_reroll'];
      case COMBAT_STATES.SURGE_SPENDING: return ['combat_surge', 'combat_skip_surges'];
      case COMBAT_STATES.RESOLUTION: return ['combat_resolve'];
      default: return [];
    }
  }

  static fromPendingCombat(gameId, pendingCombat) {
    let phase = COMBAT_STATES.DECLARED;
    if (pendingCombat.attackRoll && pendingCombat.defenseRoll) {
      phase = pendingCombat.surgeRemaining > 0 ? COMBAT_STATES.SURGE_SPENDING : COMBAT_STATES.RESOLUTION;
    } else if (pendingCombat.p1Ready && pendingCombat.p2Ready) {
      phase = COMBAT_STATES.ROLLING;
    } else if (pendingCombat.p1Ready || pendingCombat.p2Ready) {
      phase = COMBAT_STATES.DECLARED;
    }
    return new CombatSaga(`${gameId}_combat`, { ...pendingCombat, phase });
  }
}
