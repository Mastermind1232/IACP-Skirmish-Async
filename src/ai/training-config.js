/**
 * Training whitelist and matchup configuration.
 *
 * Defines the fixed set of deployment cards, command cards, and matchups
 * used for headless self-play training. Any card outside these sets
 * triggers a hard abort before training data is generated.
 */

// ── Whitelisted Deployment Cards (25) ────────────────────────────────────────

export const TRAINING_WHITELIST_DCS = new Set([
  // Original 7
  'Luke Skywalker',
  'Wookiee Warrior (Elite)',
  'Darth Vader',
  'Emperor Palpatine',
  'Stormtrooper (Elite)',
  'Boba Fett',
  'Nexu (Elite)',
  // Wave 1 Expansion (10) — archetype diversity
  'Bantha Rider',                   // Ultra-tank (21HP), Scum
  'Leia Organa',                    // LEADER + support + recovery surge, Rebel
  'Bo-Katan Kryze',                 // High surge complexity (4 options), ranged, Scum
  'Rebel Trooper (Elite)',          // 3-fig ranged swarm, Rebel
  '74-Z Speeder Bike (Elite)',      // Vehicle, 2-fig fast ranged, Imperial
  'Yoda',                           // Slow support (spd 3), Rebel
  'Wookiee Warrior (Regular)',      // Non-elite variant (11HP vs 13HP), Rebel
  'The Armorer',                    // Melee support, Scum
  '0-0-0',                          // Droid w/ special ability, Imperial
  'CT-1701',                        // Mid-range Rebel unique
  // Wave 2 Expansion (8) — new tactical problems
  'Gaarkhan',                       // AoE melee berserker, brutal_cleave, Rebel
  'Gideon Argus',                   // Ultra-squishy commander (5HP), on_my_mark, Rebel
  'C-3P0',                          // Non-combatant support droid (4HP), Rebel
  'Mara Jade',                      // Cross-faction flex melee, Any
  'BT-1',                           // Droid ranged w/ AoE missile_salvo, Imperial
  'Thrawn',                         // Imperial strategist/commander, strategize
  'Chewbacca',                      // Bodyguard/protector tank (14HP), Rebel
  'Paz Vizsla',                     // Scum heavy infantry w/ strain pressure
]);

// ── Whitelisted Command Cards (35) ──────────────────────────────────────────

export const TRAINING_WHITELIST_CCS = new Set([
  // Original 20
  'Burst Fire',
  'Concentrated Fire',
  'Covering Fire',
  'Deadeye',
  'Deflection',
  'Dirty Trick',
  'Disorient',
  'Element of Surprise',
  'Focus',
  'Force Lightning',
  'Force Push',
  'Hunt Them Down',
  'Lock On',
  'Lure of the Dark Side',
  'Marksman',
  'Ready Weapons',
  'Take Cover',
  'Take Initiative',
  'Urgency',
  'Wookiee Rage',
  // Wave 1 Expansion (10) — timing diversity
  'Brace Yourself',           // 0-cost, whenAttackDeclaredOnYou — defensive
  'Ambush',                   // 1-cost, whenAttackDeclaredOnYou — reactive
  'Blitz',                    // 1-cost, duringAttack — offensive combat
  'Fleet Footed',             // 0-cost, duringActivation — movement utility
  'Expose Weakness',          // 0-cost, duringActivation — debuff
  'Deadly Precision',         // 0-cost, startOfActivation — offensive
  'Bodyguard',                // 1-cost, whenAttackDeclaredOnAdjacentFriendly — positional
  'Battlefield Awareness',    // 1-cost, afterAttackDice — combat reactive
  'Celebration',              // 0-cost, afterUniqueHostileDefeated — kill reward
  'Force Rush',               // 0-cost, startOfActivation — movement burst
  // Wave 2 Expansion (5) — counter-play + new timings
  'Negation',                 // 1-cost, whenCommandCardPlayed — counter-play
  'Parry',                    // 0-cost, whileDefending — melee counter
  'Planning',                 // 0-cost, specialAction — utility action
  'Call the Vanguard',        // 2-cost, startOfRound — round-start tempo
  'Heart of Freedom',         // 2-cost, startOfActivation — activation burst
]);

// ── Training Maps (6 with valid deployment zones) ───────────────────────────

export const TRAINING_MAPS = [
  'mos-eisley-outskirts',
  'corellian-underground',
  'lothal-wastes',
  'chopper-base-atollon',
  'devaron-garrison',
  'hoth-battle-station',
];

// ── Fixed Training Matchups (8) ─────────────────────────────────────────────

export const TRAINING_MATCHUPS = [
  // ── Original 2 (preserved for regression testing) ─────────────────────────
  {
    label: 'Rebels vs Imperial',
    p1Deck: {
      name: 'Default Rebels',
      dcList: ['Luke Skywalker', 'Wookiee Warrior (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
      dcCount: 2,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Default Imperial',
      dcList: ['Darth Vader', 'Emperor Palpatine', 'Stormtrooper (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
      dcCount: 3,
      ccCount: 15,
    },
  },
  {
    label: 'Rebels vs Scum',
    p1Deck: {
      name: 'Default Rebels',
      dcList: ['Luke Skywalker', 'Wookiee Warrior (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Force Push', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons'],
      dcCount: 2,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Default Scum',
      dcList: ['Boba Fett', 'Nexu (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Cover', 'Take Initiative', 'Marksman', 'Ready Weapons', 'Urgency', 'Wookiee Rage'],
      dcCount: 2,
      ccCount: 15,
    },
  },

  // ── Expansion 6 (new matchups for coverage) ───────────────────────────────

  // Matchup 3: Swarm vs elite — many weak bodies vs fewer tough ones
  {
    label: 'Rebel Swarm vs Imperial Armor',
    p1Deck: {
      name: 'Rebel Swarm',
      dcList: ['Leia Organa', 'Rebel Trooper (Elite)', 'CT-1701'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Fleet Footed', 'Take Cover', 'Take Initiative', 'Bodyguard', 'Celebration', 'Force Rush', 'Urgency', 'Deadly Precision', 'Brace Yourself'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Imperial Armor',
      dcList: ['Darth Vader', '74-Z Speeder Bike (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Dirty Trick', 'Element of Surprise', 'Focus', 'Lock On', 'Take Cover', 'Take Initiative', 'Blitz', 'Ambush', 'Battlefield Awareness', 'Marksman', 'Ready Weapons'],
      dcCount: 2,
      ccCount: 15,
    },
  },

  // Matchup 4: Ultra-tank + ranged vs support + melee — asymmetric HP pools
  {
    label: 'Scum Heavies vs Rebel Defense',
    p1Deck: {
      name: 'Scum Heavies',
      dcList: ['Bantha Rider', 'Bo-Katan Kryze'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Expose Weakness', 'Marksman', 'Lure of the Dark Side', 'Urgency'],
      dcCount: 2,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Rebel Defense',
      dcList: ['Leia Organa', 'Wookiee Warrior (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Force Push', 'Take Cover', 'Take Initiative', 'Bodyguard', 'Brace Yourself', 'Fleet Footed', 'Wookiee Rage', 'Celebration', 'Ready Weapons'],
      dcCount: 2,
      ccCount: 15,
    },
  },

  // Matchup 5: Multi-fig vs multi-unit — crowded board positioning
  {
    label: 'Imperial Line vs Scum Raiders',
    p1Deck: {
      name: 'Imperial Line',
      dcList: ['Stormtrooper (Elite)', '74-Z Speeder Bike (Elite)', '0-0-0'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Element of Surprise', 'Focus', 'Lock On', 'Take Cover', 'Take Initiative', 'Blitz', 'Battlefield Awareness', 'Marksman', 'Ready Weapons', 'Deadly Precision'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Scum Raiders',
      dcList: ['Boba Fett', 'The Armorer', 'Nexu (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Initiative', 'Ambush', 'Expose Weakness', 'Urgency', 'Blitz', 'Brace Yourself'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // Matchup 6: Slow support + fast hero vs tanky melee pair
  {
    label: 'Jedi Council vs Sith Lords',
    p1Deck: {
      name: 'Jedi Council',
      dcList: ['Luke Skywalker', 'Yoda'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Force Push', 'Force Rush', 'Take Cover', 'Take Initiative', 'Fleet Footed', 'Bodyguard', 'Celebration', 'Deadly Precision', 'Brace Yourself'],
      dcCount: 2,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Sith Lords',
      dcList: ['Darth Vader', 'Emperor Palpatine'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Dirty Trick', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Expose Weakness', 'Lure of the Dark Side', 'Marksman'],
      dcCount: 2,
      ccCount: 15,
    },
  },

  // Matchup 7: Broad roster — 6 DCs on board, diverse profiles
  {
    label: 'Rebel Alliance vs Scum Muscle',
    p1Deck: {
      name: 'Rebel Alliance',
      dcList: ['CT-1701', 'Wookiee Warrior (Regular)', 'Rebel Trooper (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Take Cover', 'Take Initiative', 'Wookiee Rage', 'Fleet Footed', 'Bodyguard', 'Celebration', 'Brace Yourself', 'Ready Weapons', 'Urgency'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Scum Muscle',
      dcList: ['Bantha Rider', 'Bo-Katan Kryze', 'The Armorer'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Expose Weakness', 'Urgency', 'Marksman'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // Matchup 8: Imperial heavy vs Rebel support-heavy
  {
    label: 'Imperial Elite vs Rebel Guerrillas',
    p1Deck: {
      name: 'Imperial Elite',
      dcList: ['Darth Vader', '0-0-0', 'Stormtrooper (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Dirty Trick', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Battlefield Awareness', 'Marksman', 'Ready Weapons'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Rebel Guerrillas',
      dcList: ['Luke Skywalker', 'Leia Organa', 'Yoda'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Force Push', 'Force Rush', 'Take Cover', 'Take Initiative', 'Fleet Footed', 'Bodyguard', 'Celebration', 'Deadly Precision', 'Brace Yourself'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // ── Wave 2 Expansion (5 new matchups) ─────────────────────────────────────

  // Matchup 9: Protect-the-commander — melee rush with squishy support vs ranged kiting
  {
    label: 'Rebel Melee Storm vs Scum Firepower',
    p1Deck: {
      name: 'Rebel Melee Storm',
      dcList: ['Gaarkhan', 'Chewbacca', 'Gideon Argus'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Wookiee Rage', 'Bodyguard', 'Brace Yourself', 'Fleet Footed', 'Heart of Freedom', 'Parry', 'Celebration', 'Take Initiative', 'Negation'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Scum Firepower',
      dcList: ['Paz Vizsla', 'Bo-Katan Kryze', 'The Armorer'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Expose Weakness', 'Negation', 'Marksman'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // Matchup 10: Combined arms command vs individual hero play
  {
    label: 'Imperial Combined Arms vs Rebel Heroes',
    p1Deck: {
      name: 'Imperial Combined Arms',
      dcList: ['Thrawn', 'BT-1', 'Stormtrooper (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Lock On', 'Take Initiative', 'Blitz', 'Battlefield Awareness', 'Marksman', 'Ready Weapons', 'Planning', 'Call the Vanguard', 'Negation'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Rebel Heroes',
      dcList: ['Luke Skywalker', 'Leia Organa', 'Mara Jade'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Force Push', 'Force Rush', 'Take Cover', 'Take Initiative', 'Fleet Footed', 'Celebration', 'Heart of Freedom', 'Deadly Precision', 'Parry'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // Matchup 11: All-tech ranged vs melee Force users — asymmetric engagement ranges
  {
    label: 'Droid Coalition vs Force Council',
    p1Deck: {
      name: 'Droid Coalition',
      dcList: ['BT-1', '0-0-0', '74-Z Speeder Bike (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deadeye', 'Deflection', 'Element of Surprise', 'Focus', 'Lock On', 'Take Cover', 'Take Initiative', 'Blitz', 'Battlefield Awareness', 'Marksman', 'Ready Weapons', 'Planning'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Force Council',
      dcList: ['Luke Skywalker', 'Yoda', 'Gaarkhan'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Force Push', 'Force Rush', 'Wookiee Rage', 'Take Initiative', 'Fleet Footed', 'Bodyguard', 'Celebration', 'Heart of Freedom', 'Parry'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // Matchup 12: Protector + non-combatant + screen vs fast assassin trio
  {
    label: 'Bodyguard Formation vs Assassins',
    p1Deck: {
      name: 'Bodyguard Formation',
      dcList: ['Chewbacca', 'C-3P0', 'Rebel Trooper (Elite)'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Element of Surprise', 'Focus', 'Take Cover', 'Take Initiative', 'Bodyguard', 'Brace Yourself', 'Fleet Footed', 'Celebration', 'Negation', 'Planning', 'Heart of Freedom'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Assassin Trio',
      dcList: ['Boba Fett', 'Nexu (Elite)', 'Mara Jade'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Expose Weakness', 'Urgency', 'Deadly Precision'],
      dcCount: 3,
      ccCount: 15,
    },
  },

  // Matchup 13: Imperial strategic depth vs Scum raw stats advantage
  {
    label: 'Imperial Doctrine vs Scum Muscle',
    p1Deck: {
      name: 'Imperial Doctrine',
      dcList: ['Thrawn', 'Darth Vader', 'BT-1'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Covering Fire', 'Deflection', 'Dirty Trick', 'Element of Surprise', 'Focus', 'Force Lightning', 'Lock On', 'Take Initiative', 'Blitz', 'Battlefield Awareness', 'Marksman', 'Planning', 'Call the Vanguard'],
      dcCount: 3,
      ccCount: 15,
    },
    p2Deck: {
      name: 'Scum Muscle',
      dcList: ['Paz Vizsla', 'Bantha Rider', 'Bo-Katan Kryze'],
      ccList: ['Burst Fire', 'Concentrated Fire', 'Dirty Trick', 'Disorient', 'Element of Surprise', 'Focus', 'Hunt Them Down', 'Lure of the Dark Side', 'Lock On', 'Take Initiative', 'Blitz', 'Ambush', 'Expose Weakness', 'Urgency', 'Negation'],
      dcCount: 3,
      ccCount: 15,
    },
  },
];
