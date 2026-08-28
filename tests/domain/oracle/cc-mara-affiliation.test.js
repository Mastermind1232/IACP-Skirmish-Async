/**
 * Mara Jade takes her LIST's affiliation, and that binds both halves of what she
 * can play.
 *
 * alexanbv 2026-08-28:
 *   "mara Jades affiliation matches the list affiliation. Mara jade may only
 *    play unique CC of figure matching her affiliation. So if the list contains
 *    a unique figure that doesn't match the affiliation of the list, Mara may
 *    not play this card."
 *   "This also applies to faction restricted cards like HoF PoG Worth every
 *    credit etc"
 *
 * Her card prints affiliation "Any", which is right for deck-building and
 * useless for this rule — there was nothing to compare against. Two live bugs
 * came out of that, in opposite directions:
 *
 *   Fast Learner offered her EVERY unique-figure card in the game, Rebel cards
 *   in an Imperial list included.
 *
 *   Faction-restricted cards (Heart of Freedom, Price of Glory, Worth Every
 *   Credit) offered her NONE of them, because "any" matches no faction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCcPlayerOptions, effectiveFigureAffiliation, uniqueCcFigureAffiliation } from '../../../src/game/unique-figure-ccs.js';

const MARA = 'Mara Jade-1-0';

function list(names) {
  const dcs = names.map((n) => ({ dcName: n }));
  return {
    gameId: 'g',
    p1DcList: dcs,
    p1DcMessageIds: dcs.map((_, i) => `m${i}`),
    figurePositions: { 1: Object.fromEntries(dcs.map((d, i) => [`${d.dcName}-${i + 1}-0`, 'e19'])) },
  };
}
const maraOffered = (g, card) => getCcPlayerOptions(g, 1, card).some((o) => o.figureKey === MARA);

describe('Mara counts as her list affiliation', () => {
  it('an Imperial list makes her Imperial', () => {
    assert.equal(effectiveFigureAffiliation(list(['Mara Jade', 'Darth Vader']), 1, 'Mara Jade'), 'imperial');
  });
  it('a Rebel list makes her Rebel', () => {
    assert.equal(effectiveFigureAffiliation(list(['Mara Jade', 'Luke Skywalker']), 1, 'Mara Jade'), 'rebel');
  });
  it('a figure with its own affiliation is unaffected by the list', () => {
    assert.equal(effectiveFigureAffiliation(list(['Mara Jade', 'Darth Vader']), 1, 'Darth Vader'), 'imperial');
  });
});

describe('Fast Learner is faction-bound', () => {
  const imperial = () => list(['Mara Jade', 'Darth Vader']);
  const rebel = () => list(['Mara Jade', 'Luke Skywalker']);

  it('CAN borrow a matching-faction card', () => {
    // Imperial list, Imperial-symbol cards.
    assert.equal(maraOffered(imperial(), 'Demoralizing Monologue'), true); // Moff Gideon
    assert.equal(maraOffered(imperial(), 'Deploy the Garrison!'), true);   // Director Krennic
    assert.equal(maraOffered(imperial(), 'Cloned Reinforcements'), true);  // Dr. Royce Hemlock
    assert.equal(maraOffered(imperial(), 'Eerie Visage'), true);           // 0-0-0
    assert.equal(maraOffered(imperial(), 'Cavalry Charge'), true);         // Captain Terro
  });

  it('CANNOT borrow a card from another faction', () => {
    assert.equal(maraOffered(imperial(), "Cal's Buddy"), false);      // Cal Kestis, Rebel
    assert.equal(maraOffered(imperial(), 'Built on Hope'), false);    // Jyn Erso, Rebel
    assert.equal(maraOffered(imperial(), 'Cheat to Win'), false);     // Lando, Rebel
    assert.equal(maraOffered(imperial(), 'Blaze of Glory'), false);   // IG-88, Scum
    assert.equal(maraOffered(imperial(), 'Blood Feud'), false);       // Jabba, Scum
  });

  it('flips with the list', () => {
    assert.equal(maraOffered(rebel(), "Cal's Buddy"), true);
    assert.equal(maraOffered(rebel(), 'Built on Hope'), true);
    assert.equal(maraOffered(rebel(), 'Demoralizing Monologue'), false);
    assert.equal(maraOffered(rebel(), 'Deploy the Garrison!'), false);
  });

  it('the card-side affiliation lookup is real', () => {
    assert.equal(uniqueCcFigureAffiliation('Demoralizing Monologue'), 'imperial');
    assert.equal(uniqueCcFigureAffiliation("Cal's Buddy"), 'rebel');
    assert.equal(uniqueCcFigureAffiliation('Blaze of Glory'), 'scum');
    assert.equal(uniqueCcFigureAffiliation('Deadeye'), null, 'not a unique-figure card');
  });
});

describe('faction-restricted cards follow the same rule', () => {
  it('Mara may play her own faction and not another', () => {
    // Heart of Freedom REBEL, Price of Glory IMPERIAL, Worth Every Credit SCUM.
    const imp = list(['Mara Jade', 'Darth Vader']);
    assert.equal(maraOffered(imp, 'Price of Glory'), true, 'Imperial list, Imperial card');
    assert.equal(maraOffered(imp, 'Heart of Freedom'), false);
    assert.equal(maraOffered(imp, 'Worth Every Credit'), false);

    const reb = list(['Mara Jade', 'Luke Skywalker']);
    assert.equal(maraOffered(reb, 'Heart of Freedom'), true, 'Rebel list, Rebel card');
    assert.equal(maraOffered(reb, 'Price of Glory'), false);
  });

  it('a list with no affiliation at all offers her nothing', () => {
    // Mara alone: "Any" everywhere, so there is no faction to inherit.
    const solo = list(['Mara Jade']);
    assert.equal(maraOffered(solo, 'Heart of Freedom'), false);
    assert.equal(maraOffered(solo, 'Price of Glory'), false);
    assert.equal(maraOffered(solo, 'Worth Every Credit'), false);
  });
});
