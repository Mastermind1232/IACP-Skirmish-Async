import { Saga } from './saga.js';

export const INTERRUPT_CONFIG = {
  stillFaster: { pendingField: 'pendingStillFaster', handlerPrefix: 'still_faster_' },
  toughLuck: { pendingField: 'pendingToughLuck', handlerPrefix: 'tough_luck_' },
  lastResort: { pendingField: 'pendingLastResort', handlerPrefix: 'last_resort_' },
  fieldTactics: { pendingField: 'pendingFieldTactics', handlerPrefix: 'field_tactics_' },
  emperorInterrupt: { pendingField: 'pendingEmperorInterrupt', handlerPrefix: 'emperor_interrupt_' },
  executiveOrder: { pendingField: 'pendingExecutiveOrder', handlerPrefix: 'executive_order_' },
  bombardmentSorin: { pendingField: 'pendingBombardmentSorin', handlerPrefix: 'bombardment_sorin_' },
  firingSquad: { pendingField: 'pendingFiringSquad', handlerPrefix: 'firing_squad_' },
  coordinatedRaid: { pendingField: 'pendingCoordinatedRaid', handlerPrefix: 'coordinated_raid_' },
  awr: { pendingField: 'pendingAwr', handlerPrefix: 'awr_' },
  thereIsNoTry: { pendingField: 'pendingThereIsNoTry', handlerPrefix: 'there_is_no_try_' },
  hunterProtocol: { pendingField: 'pendingHunterProtocol', handlerPrefix: 'hunter_protocol_' },
  selfDestruct: { pendingField: 'pendingSelfDestruct', handlerPrefix: 'self_destruct_protocol_' },
  rushPush: { pendingField: 'pendingRushPush', handlerPrefix: 'rush_push_' },
  coverFire: { pendingField: 'pendingCoverFire', handlerPrefix: 'cover_fire_' },
  voracious: { pendingField: 'pendingVoracious', handlerPrefix: 'voracious_' },
  assassinsBlade: { pendingField: 'pendingAssassinsBlade', handlerPrefix: 'assassins_blade_' },
  punishingStrike: { pendingField: 'pendingPunishingStrike', handlerPrefix: 'punishing_strike_' },
  conspire: { pendingField: 'pendingConspire', handlerPrefix: 'conspire_' },
  ccConfirmation: { pendingField: 'pendingCcConfirmation', handlerPrefix: 'cc_confirm_play_' },
  negation: { pendingField: 'pendingNegation', handlerPrefix: 'cc_negate_' },
  commDisruption: { pendingField: 'pendingCommDisruptionPrompt', handlerPrefix: 'comm_disruption_' },
  orbitalBombardment: { pendingField: 'pendingOrbitalBombardment', handlerPrefix: 'orbital_bombardment_' },
  yhsiw: { pendingField: 'pendingYHSIW', handlerPrefix: 'yhsiw_' },
  illicitArms: { pendingField: 'pendingIllicitArms', handlerPrefix: 'illicit_arms_' },
  extraProtection: { pendingField: 'pendingExtraProtection', handlerPrefix: 'extra_protection_' },
  executorInterrupt: { pendingField: 'pendingExecutorInterrupt', handlerPrefix: 'executor_interrupt_' },
  blackMarket: { pendingField: 'pendingBlackMarket', handlerPrefix: 'black_market_' },
  belReorder: { pendingField: 'pendingBELReorder', handlerPrefix: 'bel_reorder_' },
};

export class InterruptSaga extends Saga {
  constructor(id, interruptType, playerNum, options = {}) {
    const config = INTERRUPT_CONFIG[interruptType];
    super(id, 'interrupt', {
      interruptType,
      playerNum,
      pendingField: config?.pendingField || `pending${interruptType}`,
      handlerPrefix: config?.handlerPrefix || `${interruptType}_`,
      ...options,
    });
  }

  resolve(choice) {
    this.state.choice = choice;
    this.recordStep('resolve', { choice });
    this.complete();
  }

  getExpectedActions() {
    if (!this.isActive()) return [];
    const prefix = this.state.handlerPrefix;
    return [`${prefix}confirm`, `${prefix}skip`];
  }
}
