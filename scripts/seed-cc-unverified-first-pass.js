/**
 * First-pass card text for unverified CCs (from reading card images).
 * Run: node scripts/seed-cc-unverified-first-pass.js
 * Fills cost, playableBy, timing, and effect for each unverified card.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const effectsPath = join(root, 'data', 'cc-effects.json');
const verifiedPath = join(root, 'data', 'cc-verified.json');
const namesPath = join(root, 'scripts', 'cc-names.js');

const effectsData = JSON.parse(readFileSync(effectsPath, 'utf8'));
const cards = effectsData.cards || {};
const verified = new Set(
  (JSON.parse(readFileSync(verifiedPath, 'utf8')).verified || [])
);
const ccNamesRaw = readFileSync(namesPath, 'utf8');
const namesMatch = ccNamesRaw.match(/const CC_NAMES = (\[.*\]);/s);
const allNames = namesMatch ? JSON.parse(namesMatch[1]) : [];
const traitPlaceholders = new Set(['Heavy Weapon', 'Hunter', 'Smuggler', 'Spy', 'Technician', 'Trooper', 'Vehicle', 'Wookiee']);
const unverifiedNames = allNames.filter((n) => !verified.has(n) && !traitPlaceholders.has(n));

// First-pass data from card images: { cost, playableBy, timing, effect }. Omit field to leave existing or use default.
const firstPass = {
  'Mandalorian Steel': { cost: 2, playableBy: 'Any Figure', timing: 'startOfRound', effect: 'Use at the start of the round. During this round, after an attack resolves targeting a friendly figure, if it spent a surge during that attack, it recovers 1 Damage.' },
  'No Cheating': { cost: 1, playableBy: 'Asajj Ventress', timing: 'atStartOfActivationOfHostileFigureInYourLineOfSight', effect: 'Use at the start of the activation of a hostile figure in your line of sight. During this round, that figure\'s attack type becomes blank, and when it declares an attack, it removes one attack die from its attack pool.' },
  'Second Chance': { cost: 2, playableBy: 'Any Unique Figure', timing: 'startOfRound', effect: 'Place this card on your Deployment card at the start of a round. Before you would be defeated, or at the end of this round, recover 2 Damage and discard this card.' },
  'Self-Augmentation': { cost: 0, playableBy: 'TECHNICIAN', timing: 'duringActivation', effect: 'Use during your activation to place this card on your Deployment card. You gain the DROID trait. While attacking, you may reroll one attack die.' },
  'Self-Defense': { cost: 0, playableBy: 'Any Figure', timing: 'whenHostileFigureEntersAdjacentSpace', effect: 'Use when a hostile figure enters a space adjacent to you. That figure suffers 1 Damage.' },
  'Set a Trap': { cost: 1, playableBy: 'Any Figure', timing: 'startOfRound', effect: 'Use at the start of a round and choose a map tile. At the end of the round, choose one of your figures on that tile to interrupt to perform an attack targeting a hostile figure on that tile.' },
  'Set for Stun': { cost: 0, playableBy: 'Any Figure', timing: 'specialAction', effect: 'Perform an attack. If the target would suffer 1 or more Damage, reduce the Damage suffered to 0. Then, the target becomes Stunned.' },
  'Set the Charges': { cost: 2, playableBy: 'TECHNICIAN', timing: 'specialAction', effect: 'Choose a space within 3 spaces and roll a blue die. Open any unlocked doors adjacent to that space. Then, each figure or object on or adjacent to that space suffers Damage equal to the combined Damage and Evade results.' },
  'Shadow Ops': { cost: 3, playableBy: "Mak Eshka'rey", timing: 'duringActivation', effect: 'Until the end of the round, the opposing player cannot play Command cards.' },
  'Shared Experience': { cost: 1, playableBy: 'DROID or VEHICLE', timing: 'duringActivation', effect: 'Use during your activation. Spend 3 movement points to become Focused. When a friendly DROID or VEHICLE is defeated, you may re-draw this card.' },
  'Signal Jammer': { cost: 1, playableBy: 'Any Figure', timing: 'startOfRound', effect: 'Put this card into play at the start of a round. When any player plays a Command card, discard that card and cancel its effects. Then, discard this card.' },
  'Single Purpose': { cost: 1, playableBy: 'Any Figure', timing: 'startOfActivation', effect: 'Use at the start of your activation. You may use the same special action up to twice during this activation.' },
  'Sit Tight': { cost: 0, playableBy: 'Any Figure', timing: 'startOfRound', effect: 'Use at the start of a round. You do not activate any groups this round until you have more ready Deployment cards than your opponent.' },
  'Slippery Target': { cost: 2, playableBy: 'SMUGGLER or SPY', timing: 'whenHostileFigureEntersAdjacentSpace', effect: 'Use when a hostile figure enters an adjacent space. Gain movement points equal to your Speed.' },
  'Smuggled Supplies': { cost: 1, playableBy: 'SMUGGLER', timing: 'startOfActivation', effect: 'Use at the start of your activation to recover 2 Damage, apply +1 Surge to your attack results until the end of the round, or apply +1 Block to your defense results until the end of the round.' },
  "Smuggler's Tricks": { cost: 1, playableBy: 'SMUGGLER', timing: 'duringActivation', effect: 'Choose a tile or token you are on or adjacent to. Until the start of the next round, your opponent counts as having 1 fewer figure on or adjacent to that tile or token.' },
  'Sniper Configuration': { cost: 1, playableBy: 'Cassian Andor', timing: 'specialAction', effect: 'Perform an attack. You may draw line of sight from any friendly figure, but still measure range from this figure. Apply +2 Accuracy and Pierce 2 to the attack results.' },
  'Son of Skywalker': { cost: 3, playableBy: 'Luke Skywalker', timing: 'afterActivationResolves', effect: 'After a figure resolves an activation, ready your Deployment card.' },
  'Spinning Kick': { cost: 1, playableBy: 'Tress Hacnua', timing: 'duringAttack', effect: 'Use while attacking. This attack gains Cleave 1 and Cleave 2.' },
  'Squad Swarm': { cost: 2, playableBy: 'Any Figure', timing: 'afterYouResolveGroupsActivation', effect: "Use after activating a group. You may immediately activate another ready group with the same name. The combined cost of both groups cannot exceed 15." },
  'Stall for Time': { cost: 0, playableBy: 'LEADER or SPY', timing: 'startOfRound', effect: 'Use at the start of a round. Your opponent places 1 random Command card from his hand on top of his Command deck.' },
  'Static Pulse': { cost: 1, playableBy: 'Iden Versio or Dio', timing: 'duringActivation', effect: "For each hostile figure adjacent to a friendly 'Dio,' you may have that figure suffer 2 Damage or become Weakened. If 'Dio' is not in play, put 'Dio' into play in your space instead." },
  'Stay Down': { cost: 2, playableBy: 'Biv Bodhrik', timing: 'afterYouResolveCloseAndPersonal', effect: 'Use after resolving "Close and Personal." If the target was not defeated, perform an additional attack with the same target. Then, you become Stunned.' },
  'Stealth Tactics': { cost: 1, playableBy: 'Any Small Figure', timing: 'whileDefending', effect: 'Use while defending to add 1 white die to your defense pool.' },
  'Still Faster Than You': { cost: 2, playableBy: 'Cad Bane', timing: 'atStartOfActivationOfHostileFigureInYourLineOfSight', effect: "Use at the start of a hostile figure's activation to interrupt to move 2 spaces and perform an attack targeting a different hostile figure." },
  'Stimulants': { cost: 0, playableBy: 'SMUGGLER', timing: 'duringActivation', effect: 'You or an adjacent figure suffers 1 Damage, then gains 1 movement point and becomes Focused.' },
  'Strategic Shift': { cost: 1, playableBy: 'SPY', timing: 'duringActivation', effect: 'A player of your choice shuffles his hand of Command cards into his deck. Then, that player draws 2 cards.' },
  'Strength in Numbers': { cost: 1, playableBy: 'Any Figure', timing: 'afterYouResolveGroupsActivation', effect: "Use after you resolve a group's activation. You may immediately activate another group. The combined deployment cost of these groups cannot exceed 12." },
  'Supercharge': { cost: 1, playableBy: 'TECHNICIAN', timing: 'specialAction', effect: 'Perform an attack. As you roll dice, add yellow dice to the attack pool until there are 4 attack dice total. After the attack resolves, you suffer Damage equal to the number of dice added this way.' },
  'Support Specialist': { cost: 2, playableBy: 'Del Meeko', timing: 'duringActivation', effect: 'Choose a friendly DROID, TECHNICIAN, or TROOPER within 3 spaces. That figure interrupts to perform an action.' },
  'Survival Instincts': { cost: 1, playableBy: 'CREATURE', timing: 'startOfActivation', effect: 'Use at the start of your activation. Until the end of the round, apply +1 Block and +1 Evade to your defense results.' },
  'Take it Down': { cost: 3, playableBy: 'Gideon Argus', timing: 'duringActivation', effect: 'Choose an adjacent friendly figure. That figure performs an attack. Apply +2 Damage to the attack results.' },
  'Take Position': { cost: 0, playableBy: 'Non-Massive GUARDIAN or VEHICLE', timing: 'duringActivation', effect: 'Use during your activation. During this round, apply +1 Block to your defense results and you cannot be pushed, except by MASSIVE figures.' },
  'Targeting Network': { cost: 0, playableBy: 'DROID or HEAVY WEAPON', timing: 'duringAttack', effect: 'Use while attacking to reroll 1 attack die. While this card is in your discard pile, your DROIDS gain: Re-draw this card.' },
  'Telekinetic Throw': { cost: 1, playableBy: 'FORCE USER', timing: 'specialAction', effect: 'Choose a hostile figure in your line of sight within 3 spaces. Roll 2 blue dice. That figure suffers Damage equal to the Damage results.' },
  'Unlimited Power': { cost: 2, playableBy: 'Emperor Palpatine', timing: 'useWhenYouUseEmperor', effect: 'Use when you use "Emperor." You may choose any other friendly figure on the map instead of another friendly figure within 4 spaces.' },
  'Vanish': { cost: 2, playableBy: 'Davith Elso', timing: 'duringActivation', effect: 'You cannot suffer or receive conditions until your next activation. At the start of your next activation, gain 4 movement points.' },
  'Veteran Instincts': { cost: 1, playableBy: 'Any Unique Figure', timing: 'duringActivation', effect: 'Use during your activation to gain 1 Surge or 1 Evade. Then, gain 1 Block or 1 Dodge.' },
  'You Will Not Deny Me': { cost: 2, playableBy: 'Fifth Brother', timing: 'other', effect: "When discarded, place this card on your 'Fifth Brother' Deployment card instead. You cannot be defeated nor recover Damage. You ignore your HARMFUL conditions. When a hostile figure is defeated, or at the end of the next round, return this card to the game box." },
  'Terminal Network': { cost: 2, playableBy: 'R2-D2', timing: 'specialAction', effect: 'Use while adjacent to a terminal. Until the start of the next round, you gain control of all terminals, regardless of which figures are adjacent to them.' },
  'Terminal Protocol': { cost: 1, playableBy: 'DROID', timing: 'duringActivation', effect: 'Roll 1 green die. Each other figure and object in or adjacent to your space suffers Damage equal to the Damage results. Then, you are defeated.' },
  'There is Another': { cost: 0, playableBy: 'Leia Organa', timing: 'startOfRound', effect: 'Use at the start of a round. Until the end of the round, you gain the FORCE USER trait and apply +1 Surge to your attack results.' },
  'There Is No Try': { cost: 2, playableBy: 'Yoda', timing: 'other', effect: "Use when a friendly FORCE USER within 4 spaces rolls any number of dice. Choose one of those dice and turn it to any other side. On that die, convert each Block result to 2 Damage and 1 Surge." },
  'To the Limit': { cost: 0, playableBy: 'Any Figure', timing: 'afterYouMove', effect: 'Use after you resolve a move during your activation to perform 1 additional action. Then you become Stunned.' },
  'Tools for the Job': { cost: 2, playableBy: 'Hunter or Smuggler', timing: 'whenYouDeclareAttack', effect: 'Use when you declare an attack to add 1 attack die of your choice to the attack pool.' },
  'Tough Luck': { cost: 1, playableBy: 'Any Figure', timing: 'other', effect: "Use after your opponent rerolls a die. Remove that die's result from the results." },
  'Toxic Dart': { cost: 0, playableBy: 'Hunter or Smuggler', timing: 'duringActivation', effect: 'Use during your activation. A hostile figure within 3 spaces and in line of sight suffers 1 Damage and becomes Weakened.' },
  'Trandoshan Terror': { cost: 2, playableBy: 'Bossk', timing: 'whenYouDeclareIndiscriminateFire', effect: "Use when you declare 'Indiscriminate Fire.' Add 1 yellow die to the dice pool." },
  'Transmit the Plans': { cost: 0, playableBy: 'Bodhi Rook', timing: 'specialAction', effect: 'Distribute 2 Strain among friendly figures. If you are adjacent to a terminal, gain 2 VPs.' },
  'Triangulate': { cost: 2, playableBy: 'DROID', timing: 'specialAction', effect: 'A figure within 5 spaces and line of sight suffers Damage equal to the number of DROIDS friendly to you with line of sight to it, to a maximum of 3 Damage.' },
  'Utinni!': { cost: 1, playableBy: 'Any Figure', timing: 'startOfRound', effect: 'Use at the start of a round. During this round, each friendly Jawa Scavenger gains +1 Speed, +1 Accuracy, and [Surge]: If you are attacking a figure, gain 1 VP.' },
  'Whistling Birds': { cost: 2, playableBy: 'The Mandalorian', timing: 'specialAction', effect: 'Move up to 2 spaces, then choose up to 3 figures within 2 spaces and roll 1 red die. Each of those figures suffers Damage equal to the Damage results.' },
  'Wild Attack': { cost: 0, playableBy: 'Any Figure', timing: 'whenYouDeclareAttack', effect: 'Use when you declare an attack. Add 1 red die to the attack pool and 1 white die to the defense pool.' },
  'Wild Fire': { cost: 1, playableBy: 'CT-1701', timing: 'duringAttack', effect: 'Use while attacking to remove up to 2 dice of your choice from the defense pool.' },
  'Wild Fury': { cost: 2, playableBy: 'Creature or Wookiee', timing: 'duringActivation', effect: 'Use during your activation. You become Focused and may perform multiple attacks during this activation. At the end of your activation, become Stunned and Bleeding.' },
  'Windfall': { cost: 0, playableBy: 'Doctor Aphra', timing: 'whenCommandCardDiscardedFromHandOrDeck', effect: "Use when a Command card is discarded from your hand or deck. You gain VPs equal to that card's cost. When this card is discarded from your hand or deck, gain 1 VP." },
  'Worth Every Credit': { cost: 2, playableBy: 'Any Figure', timing: 'duringActivation', effect: 'Use during your activation to discard 1 HARMFUL condition and gain 2 movement points. When the next hostile figure is defeated during this activation, gain 2 VPs.' },
  'Wreak Vengeance': { cost: 1, playableBy: 'Maul', timing: 'useWhenYouUseDualBladedFury', effect: "Use when you use 'Dual-Bladed Fury.' You may choose both effects instead of only 1." },
  'Stroke of Brilliance': { cost: 0, playableBy: 'Greedo', timing: 'whenAttackDeclaredOnYou', effect: 'Use when an attack targeting you is declared. Apply +2 Block and +1 Evade to the defense results.' },
};

const DEFAULT_PLACEHOLDER = 'First pass – verify effect from card.';

let updated = 0;
for (const name of unverifiedNames) {
  const data = firstPass[name];
  if (!cards[name]) cards[name] = { cost: null, playableBy: 'Any Figure', timing: 'other', effect: '', effectType: 'manual' };
  const entry = cards[name];
  if (data) {
    if (data.cost != null) entry.cost = data.cost;
    if (data.playableBy != null) entry.playableBy = data.playableBy;
    if (data.timing != null) entry.timing = data.timing;
    if (data.effect != null) entry.effect = data.effect;
    updated++;
  } else {
    if (entry.effect == null || String(entry.effect).trim() === '') {
      entry.effect = DEFAULT_PLACEHOLDER;
      entry.playableBy = entry.playableBy || 'Any Figure';
      updated++;
    }
  }
}

effectsData.source = effectsData.source || 'CC Effect Editor';
effectsData.cards = cards;
writeFileSync(effectsPath, JSON.stringify(effectsData, null, 2), 'utf8');
console.log(`Updated ${updated} unverified CCs with first-pass data (cost, playableBy, timing, effect).`);
console.log(`Unverified count: ${unverifiedNames.length}`);
