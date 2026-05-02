import { Saga } from './saga.js';

export const NEGATION_STATES = {
  CC_PLAYED: 'CC_PLAYED',
  NEGATION_WINDOW: 'NEGATION_WINDOW',
  RESOLVED: 'RESOLVED',
};

export class NegationSaga extends Saga {
  constructor(id, negationData = {}) {
    super(id, 'negation', {
      phase: NEGATION_STATES.CC_PLAYED,
      playedBy: negationData.playedBy || null,
      cardName: negationData.cardName || null,
      ...negationData,
    });
  }

  openNegationWindow() {
    this.state.phase = NEGATION_STATES.NEGATION_WINDOW;
    this.recordStep('openNegationWindow');
  }

  resolve(negated) {
    this.state.phase = NEGATION_STATES.RESOLVED;
    this.state.negated = negated;
    this.recordStep('resolve', { negated });
    this.complete();
  }

  getExpectedActions() {
    switch (this.state.phase) {
      case NEGATION_STATES.CC_PLAYED: return ['cc_negate', 'cc_let_resolve'];
      case NEGATION_STATES.NEGATION_WINDOW: return ['cc_negate', 'cc_let_resolve'];
      case NEGATION_STATES.RESOLVED: return [];
      default: return [];
    }
  }
}
