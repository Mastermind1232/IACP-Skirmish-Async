/**
 * Training whitelist and matchup configuration.
 *
 * Defines the fixed set of deployment cards, command cards, and matchups
 * used for headless self-play training. Any card outside these sets
 * triggers a hard abort before training data is generated.
 */

// ── Whitelisted Deployment Cards (7) ─────────────────────────────────────────

export const TRAINING_WHITELIST_DCS = new Set([
  'Luke Skywalker',
  'Wookiee Warrior (Elite)',
  'Darth Vader',
  'Emperor Palpatine',
  'Stormtrooper (Elite)',
  'Boba Fett',
  'Nexu (Elite)',
]);

// ── Whitelisted Command Cards (20) ──────────────────────────────────────────

export const TRAINING_WHITELIST_CCS = new Set([
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
]);

// ── Fixed Training Matchups (2) ─────────────────────────────────────────────

export const TRAINING_MATCHUPS = [
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
];
