# Drift Findings — what Python disagrees with JS about

- Files replayed: **43** (clean: 16)
- Steps replayed: **8,541**
- Diffs surfaced: **7,822**
- Steps that errored: **0**

## Top diverging state fields

Each row: how many step-level diffs touched that top-level state field. "Top-level" = the first segment of the diff path (`figurePositions.1.X` → `figurePositions`).

| # of diffs | Field |
|---|---|
| 2,697 | `pendingCombat` |
| 700 | `lastDefeatInfo` |
| 561 | `dcActionsData` |
| 469 | `roundPhase` |
| 367 | `figureMoved` |
| 310 | `attackPerformedThisActivation` |
| 266 | `currentActivationTurnPlayerId` |
| 158 | `p1ActivationsRemaining` |
| 156 | `currentRound` |
| 156 | `initiativePlayerId` |
| 156 | `p1ActivatedDcIndices` |
| 156 | `p2ActivatedDcIndices` |
| 156 | `p2ActivationsRemaining` |
| 143 | `attackTargets` |
| 139 | `movementBank` |
| 136 | `activationDamagedFigures` |
| 132 | `specialActionUsedThisActivation` |
| 84 | `player1VP` |
| 82 | `player2VP` |
| 81 | `harshEnvironmentActive` |
| 81 | `noCommandDrawThisRound` |
| 81 | `p1LaunchPanelFlippedThisRound` |
| 81 | `p2LaunchPanelFlippedThisRound` |
| 81 | `powerConverterUsedThisRound` |
| 51 | `pendingDcAbilityChoice` |
| 49 | `pendingPounceSpaceChoice` |
| 47 | `pendingBoRifleKallus` |
| 43 | `activationKills` |
| 40 | `figurePositions` |
| 40 | `totalDamageReceived` |

## Errors by action type

| # | Action prefix |
|---|---|

## Top error messages

| # | Error |
|---|---|

## Diff-producing steps by action type

| # | Action prefix |
|---|---|
| 566 | `phase_gate` |
| 291 | `combat_gate` |
| 266 | `pass_activation` |
| 262 | `end_end` |
| 257 | `dc_special` |
| 203 | `dc_end` |
| 179 | `dc_move` |
| 136 | `combat_roll` |
| 127 | `dc_activate` |
| 119 | `move_pick` |
| 113 | `status_phase` |
| 102 | `combat_ready` |
| 70 | `attack` |
| 51 | `dc_ability` |
| 42 | `combat_surge` |
| 42 | `pounce` |
| 31 | `combat_reroll` |
| 13 | `combat_resolve` |

## First example diff per action type

### `attack`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 9  customId: `attack_target_hl2dc1_0_0`
- sample diffs:
```
  - attackPerformedThisActivation = {'hl2dc1': True}  (only in left)
  ~ dcActionsData.hl2dc1.remaining: 2 != 1
  + pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Han Solo (Rebel Hero)', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Han Solo (Rebel Hero)-1-0', 'coord': 'c12', 'label': 'Han Solo (Rebel Hero)', 'hasLOS': True, 'dist': 1}, 'targetStats': {'defense': ['white'], 'cost': 5, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 1, 'combatThreadId': 'thread-fake-msg-1', 'combatDeclareMsgId': 'fake-msg-1', 'combatPreMsgId': 'fake-msg-2', 'p1Ready': False, 'p2Ready': False, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False}  (only in right)
```

### `combat_gate`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 14  customId: `combat_gate_00001`
- sample diffs:
```
  - attackPerformedThisActivation = {'hl2dc1': True}  (only in left)
  ~ pendingCombat.combatGate.p2Ready: False != True
  - pendingCombat.phase = 'gate'  (only in left)
```

### `combat_ready`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 10  customId: `combat_ready_00001`
- sample diffs:
```
  - attackPerformedThisActivation = {'hl2dc1': True}  (only in left)
```

### `combat_reroll`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 16  customId: `combat_reroll_00001_atk_1`
- sample diffs:
```
  - attackPerformedThisActivation = {'hl2dc1': True}  (only in left)
  ~ pendingCombat.attackDiceResults[1].acc: 3 != 1
  ~ pendingCombat.attackRoll.acc: 8 != 6
  ~ pendingCombat.attackerRerollsRemaining: 2 != 1
```

### `combat_resolve`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 94  customId: `combat_resolve_ready_00001`
- sample diffs:
```
  + activationDamagedFigures = {'hl1dc1': ['Stormtrooper (Regular)-1-2']}  (only in right)
  + attackPerformedThisActivation = {'hl1dc1': True}  (only in right)
  - lastDefeatInfo = {'playerNum': 2, 'figureKey': 'Stormtrooper (Regular)-1-1', 'dcName': 'Stormtrooper (Regular)'}  (only in left)
  ~ p2DcList[1].healthState[2][0]: 3 != 2
  ~ totalDamageReceived.2: 3 != 4
```

### `combat_roll`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 12  customId: `combat_roll_00001`
- sample diffs:
```
  - attackPerformedThisActivation = {'hl2dc1': True}  (only in left)
  + pendingCombat.attackDiceResults = [{'color': 'blue', 'acc': 5, 'dmg': 1, 'surge': 0}, {'color': 'green', 'acc': 3, 'dmg': 2, 'surge': 0}]  (only in right)
  + pendingCombat.attackRoll = {'acc': 8, 'dmg': 3, 'surge': 0}  (only in right)
```

### `combat_surge`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 93  customId: `combat_surge_00001_2`
- sample diffs:
```
  - lastDefeatInfo = {'playerNum': 2, 'figureKey': 'Stormtrooper (Regular)-1-1', 'dcName': 'Stormtrooper (Regular)'}  (only in left)
  ~ pendingCombat.surgeAccuracy: 0 != 2
  + pendingCombat.surgeBlast = 0  (only in right)
  + pendingCombat.surgeRecover = 0  (only in right)
  + pendingCombat.surgeSpentCount = {'2': 1}  (only in right)
  - pendingCombat.triggeredSurges = ['surge_2']  (only in left)
```

### `dc_ability`

- file: `anchorhead-cantina-bar_game_001.jsonl`  seq: 22  customId: `dc_ability_choice_00002_hl2dc0_0_1`
- sample diffs:
```
  - pendingCombat = {'gameId': '00002', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc0', 'attackerDcName': 'Boba Fett', 'defenderDcName': 'Chewbacca', 'bonusPierce': 0, 'attackerDisplayName': 'Boba Fett', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Boba Fett-1-0', 'target': {'figureKey': 'Chewbacca-1-0', 'coord': 'a12', 'label': 'Chewbacca', 'hasLOS': True, 'dist': 2}, 'targetStats': {'defense': ['white', 'black'], 'cost': 15, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 2, 'combatThreadId': 'thread-fake-msg-91', 'combatDeclareMsgId': 'fake-msg-91', 'combatPreMsgId': 'fake-msg-92', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 8, 'dmg': 5, 'surge': 1}, 'defenseRoll': {'block': 2, 'evade': 0, 'dodge': True}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-95', 'attackDiceResults': [{'color': 'blue', 'acc': 3, 'dmg': 1, 'surge': 1}, {'color': 'green', 'acc': 2, 'dmg': 2, 'surge': 0}, {'color': 'green', 'acc': 3, 'dmg': 2, 'surge': 0}], 'defenseDiceResults': [{'color': 'white', 'block': 0, 'evade': 0, 'dodge': True}, {'color': 'black', 'block': 2, 'evade': 0, 'dodge': False}], 'defenseDiceCount': 2, 'attackerRerollsRemaining': 0, 'defenderRerollsRemaining': 0, 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': True, 'p2Ready': False}, 'phase': 'gate'}  (only in left)
  + pendingPounceSpaceChoice = {'hl2dc0': {'gameId': '00002', 'playerNum': 2, 'figureIndex': 0, 'msgId': 'hl2dc0', 'abilityId': 'wrist_cord', 'validSpaces': ['a13', 'b13', 'a15', 'b15'], 'targetFigureKey': 'Stormtrooper (Regular)-1-0'}}  (only in right)
```

### `dc_activate`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 26  customId: `dc_activate_00001_2_0`
- sample diffs:
```
  - pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Han Solo (Rebel Hero)', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Han Solo (Rebel Hero)-1-0', 'coord': 'c12', 'label': 'Han Solo (Rebel Hero)', 'hasLOS': True, 'dist': 1}, 'targetStats': {'defense': ['white'], 'cost': 5, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 1, 'combatThreadId': 'thread-fake-msg-1', 'combatDeclareMsgId': 'fake-msg-1', 'combatPreMsgId': 'fake-msg-2', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 6, 'dmg': 3, 'surge': 0}, 'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-5', 'attackDiceResults': [{'color': 'blue', 'acc': 5, 'dmg': 1, 'surge': 0}, {'color': 'green', 'acc': 1, 'dmg': 2, 'surge': 0}], 'defenseDiceResults': [{'color': 'white', 'block': 0, 'evade': 0, 'dodge': True}], 'defenseDiceCount': 1, 'attackerRerollsRemaining': 1, 'defenderRerollsRemaining': 0, 'attackerRerolledIndices': [1], 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': False, 'p2Ready': True}, 'phase': 'gate'}  (only in left)
```

### `dc_end`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 6  customId: `dc_end_activation_hl1dc1`
- sample diffs:
```
  + attackTargets = {'hl1dc1_0': [{'figureKey': 'Boba Fett-1-0', 'coord': 'a14', 'label': 'Boba Fett', 'hasLOS': True, 'dist': 2}, {'figureKey': 'Stormtrooper (Regular)-1-0', 'coord': 'b13', 'label': 'Stormtrooper (Regular)', 'hasLOS': True, 'dist': 1}, {'figureKey': 'Stormtrooper (Regular)-1-1', 'coord': 'b12', 'label': 'Stormtrooper (Regular)', 'hasLOS': True, 'dist': 1}]}  (only in right)
```

### `dc_move`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 22  customId: `dc_move_hl2dc1_f0`
- sample diffs:
```
  - pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Han Solo (Rebel Hero)', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Han Solo (Rebel Hero)-1-0', 'coord': 'c12', 'label': 'Han Solo (Rebel Hero)', 'hasLOS': True, 'dist': 1}, 'targetStats': {'defense': ['white'], 'cost': 5, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 1, 'combatThreadId': 'thread-fake-msg-1', 'combatDeclareMsgId': 'fake-msg-1', 'combatPreMsgId': 'fake-msg-2', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 6, 'dmg': 3, 'surge': 0}, 'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-5', 'attackDiceResults': [{'color': 'blue', 'acc': 5, 'dmg': 1, 'surge': 0}, {'color': 'green', 'acc': 1, 'dmg': 2, 'surge': 0}], 'defenseDiceResults': [{'color': 'white', 'block': 0, 'evade': 0, 'dodge': True}], 'defenseDiceCount': 1, 'attackerRerollsRemaining': 1, 'defenderRerollsRemaining': 0, 'attackerRerolledIndices': [1], 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': False, 'p2Ready': True}, 'phase': 'gate'}  (only in left)
```

### `dc_special`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 47  customId: `dc_special_1_hl2dc0`
- sample diffs:
```
  ~ attackTargets.hl2dc0_0[0].dist: 6 != 4
  + dcActionsData.hl2dc0.specialsUsed = [1]  (only in right)
  + pendingPounceSpaceChoice = {'hl2dc0': {'gameId': '00001', 'playerNum': 2, 'figureIndex': 0, 'msgId': 'hl2dc0', 'abilityId': 'wrist_flamethrower', 'specialIdx': 1, 'validSpaces': ['g12', 'h12', 'f12', 'g13', 'g11', 'h13', 'h11', 'f13', 'f11', 'i12', 'i13', 'i11', 'e12', 'e13', 'e11', 'g14', 'h14', 'f14', 'g10', 'h10', 'f10', 'i14', 'i10', 'e14', 'e10']}}  (only in right)
```

### `end_end`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 38  customId: `end_end_of_round_00001`
- sample diffs:
```
  + attackPerformedThisActivation = {'hl2dc1': True}  (only in right)
  + figureMoved = {'Han Solo (Rebel Hero)-1-0': True, 'Stormtrooper (Regular)-1-0': True, 'Boba Fett-1-0': True}  (only in right)
  - harshEnvironmentActive = False  (only in left)
  - noCommandDrawThisRound = False  (only in left)
  - p1LaunchPanelFlippedThisRound = False  (only in left)
  - p2LaunchPanelFlippedThisRound = False  (only in left)
```

### `move_pick`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 23  customId: `move_pick_hl2dc1_0_b16`
- sample diffs:
```
  - pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Han Solo (Rebel Hero)', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Han Solo (Rebel Hero)-1-0', 'coord': 'c12', 'label': 'Han Solo (Rebel Hero)', 'hasLOS': True, 'dist': 1}, 'targetStats': {'defense': ['white'], 'cost': 5, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 1, 'combatThreadId': 'thread-fake-msg-1', 'combatDeclareMsgId': 'fake-msg-1', 'combatPreMsgId': 'fake-msg-2', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 6, 'dmg': 3, 'surge': 0}, 'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-5', 'attackDiceResults': [{'color': 'blue', 'acc': 5, 'dmg': 1, 'surge': 0}, {'color': 'green', 'acc': 1, 'dmg': 2, 'surge': 0}], 'defenseDiceResults': [{'color': 'white', 'block': 0, 'evade': 0, 'dodge': True}], 'defenseDiceCount': 1, 'attackerRerollsRemaining': 1, 'defenderRerollsRemaining': 0, 'attackerRerolledIndices': [1], 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': False, 'p2Ready': True}, 'phase': 'gate'}  (only in left)
```

### `pass_activation`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 7  customId: `pass_activation_turn_00001`
- sample diffs:
```
  ~ currentActivationTurnPlayerId: 'player1' != 'player2'
```

### `phase_gate`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 36  customId: `phase_gate_ready_00001`
- sample diffs:
```
  - pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Han Solo (Rebel Hero)', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Han Solo (Rebel Hero)-1-0', 'coord': 'c12', 'label': 'Han Solo (Rebel Hero)', 'hasLOS': True, 'dist': 1}, 'targetStats': {'defense': ['white'], 'cost': 5, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 1, 'combatThreadId': 'thread-fake-msg-1', 'combatDeclareMsgId': 'fake-msg-1', 'combatPreMsgId': 'fake-msg-2', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 6, 'dmg': 3, 'surge': 0}, 'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-5', 'attackDiceResults': [{'color': 'blue', 'acc': 5, 'dmg': 1, 'surge': 0}, {'color': 'green', 'acc': 1, 'dmg': 2, 'surge': 0}], 'defenseDiceResults': [{'color': 'white', 'block': 0, 'evade': 0, 'dodge': True}], 'defenseDiceCount': 1, 'attackerRerollsRemaining': 1, 'defenderRerollsRemaining': 0, 'attackerRerolledIndices': [1], 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': False, 'p2Ready': True}, 'phase': 'gate'}  (only in left)
```

### `pounce`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 152  customId: `pounce_space_00001_hl2dc0_0_k7`
- sample diffs:
```
  - lastDefeatInfo = {'playerNum': 1, 'figureKey': 'Han Solo (Rebel Hero)-1-0', 'dcName': 'Han Solo (Rebel Hero)'}  (only in left)
  - pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Chewbacca', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Chewbacca-1-0', 'coord': 'd17', 'label': 'Chewbacca', 'hasLOS': True, 'dist': 3}, 'targetStats': {'defense': ['white', 'black'], 'cost': 15, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 3, 'combatThreadId': 'thread-fake-msg-50', 'combatDeclareMsgId': 'fake-msg-50', 'combatPreMsgId': 'fake-msg-51', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 3, 'dmg': 0, 'surge': 2}, 'defenseRoll': {'block': 3, 'evade': 0, 'dodge': False}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-54', 'attackDiceResults': [{'color': 'blue', 'acc': 2, 'dmg': 0, 'surge': 1}, {'color': 'green', 'acc': 1, 'dmg': 0, 'surge': 1}], 'defenseDiceResults': [{'color': 'white', 'block': 1, 'evade': 0, 'dodge': False}, {'color': 'black', 'block': 2, 'evade': 0, 'dodge': False}], 'defenseDiceCount': 2, 'attackerRerollsRemaining': 0, 'defenderRerollsRemaining': 0, 'attackerRerolledIndices': [1, 0], 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'evadeCancelledSurge': 0, 'surgeRemaining': 0, 'surgeDamage': 1, 'surgePierce': 0, 'surgeAccuracy': 2, 'surgeBlast': 0, 'surgeRecover': 0, 'surgeSpentCount': {'0': 1, '1': 1}, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': True, 'p2Ready': False}, 'phase': 'gate'}  (only in left)
```

### `status_phase`

- file: `anchorhead-cantina-bar_game_000.jsonl`  seq: 34  customId: `status_phase_00001`
- sample diffs:
```
  - pendingCombat = {'gameId': '00001', 'attackerPlayerNum': 2, 'defenderPlayerNum': 1, 'attackerMsgId': 'hl2dc1', 'attackerDcName': 'Stormtrooper (Regular)', 'defenderDcName': 'Han Solo (Rebel Hero)', 'bonusPierce': 0, 'attackerDisplayName': 'Stormtrooper (Regular)', 'attackerFigureIndex': 0, 'attackerFigureKey': 'Stormtrooper (Regular)-1-0', 'target': {'figureKey': 'Han Solo (Rebel Hero)-1-0', 'coord': 'c12', 'label': 'Han Solo (Rebel Hero)', 'hasLOS': True, 'dist': 1}, 'targetStats': {'defense': ['white'], 'cost': 5, 'figures': 1}, 'blockSurgeAbilities': False, 'defensePoolRemoveMax': 0, 'attackInfo': {'dice': ['blue', 'green'], 'type': 'range'}, 'isRanged': True, 'distanceToTarget': 1, 'combatThreadId': 'thread-fake-msg-1', 'combatDeclareMsgId': 'fake-msg-1', 'combatPreMsgId': 'fake-msg-2', 'p1Ready': True, 'p2Ready': True, 'attackRoll': {'acc': 6, 'dmg': 3, 'surge': 0}, 'defenseRoll': {'block': 0, 'evade': 0, 'dodge': True}, 'attackTargetMsgId': 'fake-msg', 'darksaberBlastToCleave': False, 'rollMessageId': 'fake-msg-5', 'attackDiceResults': [{'color': 'blue', 'acc': 5, 'dmg': 1, 'surge': 0}, {'color': 'green', 'acc': 1, 'dmg': 2, 'surge': 0}], 'defenseDiceResults': [{'color': 'white', 'block': 0, 'evade': 0, 'dodge': True}], 'defenseDiceCount': 1, 'attackerRerollsRemaining': 1, 'defenderRerollsRemaining': 0, 'attackerRerolledIndices': [1], 'defensibleResolved': True, 'getDownResolved': True, 'callTheShotsResolved': True, 'heavyRepeaterResolved': True, 'combatGate': {'phase': 'pre_resolve', 'p1Ready': False, 'p2Ready': True}, 'phase': 'gate'}  (only in left)
```

## First error per action type

| Action | File | Error |
|---|---|---|

