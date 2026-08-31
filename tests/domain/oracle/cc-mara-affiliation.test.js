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
import { firstSeenArmyAffiliation } from '../../../src/game/adaptive-skills-helpers.js';
import { getDcEffects } from '../../../src/data-loader.js';

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

describe('a companion takes its HOST affiliation, not its own card', () => {
  // alexanbv 2026-08-29: "a companion always have the affiliation of the parent
  // figure, no matter the affiliation of the card. For example, the child
  // attached to Onar is a scum."
  //
  // The Child's own card prints "Any", and [Clan of Two] is what attaches it.
  // Onar Koma is Scum, so The Child is Scum while riding him — and Rebel on a
  // Rebel host. The companion's own card never decides.
  const CHILD = 'The Child-2-0';

  // The host must differ from what the LIST would resolve to, or the test proves
  // nothing: with the companion rule removed the code falls through to the list
  // affiliation, and in a single-faction list that is the same answer by
  // accident. So the Rebel DC is listed FIRST (making the list read Rebel) while
  // the companion's host is the Scum one.
  const hostedBy = (hostDc, decoyFirst) => ({
    gameId: 'g',
    p1DcList: [{ dcName: decoyFirst }, { dcName: hostDc }, { dcName: 'The Child' }],
    p1DcMessageIds: ['m0', 'm1', 'm2'],
    p1DcAttachments: { m1: ['Clan of Two'] },
    figurePositions: {
      1: { [`${decoyFirst}-1-0`]: 'e18', [`${hostDc}-2-0`]: 'e19', [CHILD]: 'e20' },
    },
  });

  it("is Scum on Onar Koma even when the list reads Rebel — alexanbv's example", () => {
    const g = hostedBy('Onar Koma', 'Luke Skywalker');
    assert.equal(firstSeenArmyAffiliation(g.p1DcList, getDcEffects()), 'rebel',
      'the list itself reads Rebel, so a list-based answer would be wrong');
    assert.equal(effectiveFigureAffiliation(g, 1, 'The Child', CHILD), 'scum',
      'the HOST decides, not the list');
  });

  it('is Rebel on a Rebel host even when the list reads Scum', () => {
    const g = hostedBy('Luke Skywalker', 'Onar Koma');
    assert.equal(firstSeenArmyAffiliation(g.p1DcList, getDcEffects()), 'scum');
    assert.equal(effectiveFigureAffiliation(g, 1, 'The Child', CHILD), 'rebel');
  });

  it('follows a live-registered host too, not just an attachment', () => {
    // Companions arrive two ways: declared by an attachment, or registered in
    // companionHostMap when they enter play. Both must resolve the host.
    const g = {
      gameId: 'g',
      p1DcList: [{ dcName: 'Luke Skywalker' }, { dcName: 'Onar Koma' }, { dcName: 'The Child' }],
      p1DcMessageIds: ['m0', 'm1', 'm2'],
      companionHostMap: { [CHILD]: { hostFigureKey: 'Onar Koma-2-0', playerNum: 1 } },
      figurePositions: { 1: { 'Luke Skywalker-1-0': 'e18', 'Onar Koma-2-0': 'e19', [CHILD]: 'e20' } },
    };
    assert.equal(effectiveFigureAffiliation(g, 1, 'The Child', CHILD), 'scum');
  });

  it('a non-companion is unaffected', () => {
    const g = hostedBy('Onar Koma', 'Luke Skywalker');
    assert.equal(effectiveFigureAffiliation(g, 1, 'Onar Koma', 'Onar Koma-2-0'), 'scum');
  });
});
