import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auraGrantedSurges } from './surge-auras.js';
import { getDcEffects, getMapRegistry, getMapData } from '../data-loader.js';

// Pick a real MOBILE attacker DC + a real map with adjacency.
const e = getDcEffects();
const mobileDc = Object.keys(e).find((n) => (e[n].keywords || []).map((k) => String(k).toUpperCase()).includes('MOBILE'));
let map = null, ms = null;
for (const m of getMapRegistry()) { const d = getMapData(m.id); if (d?.adjacency && Object.keys(d.adjacency).length > 3) { map = m; ms = d; break; } }
const coords = ms ? Object.keys(ms.adjacency) : [];
const anchor = coords.find((c) => (ms.adjacency[c] || []).length > 0);
const adj = anchor ? ms.adjacency[anchor][0] : null;
const far = coords[coords.length - 1];

describe('surge-auras: Gar Saxon grants its surges to a MOBILE figure in range', () => {
  const combat = { attackerPlayerNum: 1, attackerFigureKey: `${mobileDc}-1-0`, attackerDcName: mobileDc };
  const game = (saxonPos) => ({ selectedMap: { id: map.id }, figurePositions: { 1: { [`${mobileDc}-1-0`]: anchor, 'Gar Saxon-1-0': saxonPos } } });

  it('a MOBILE attacker within 4 of a friendly Gar Saxon gains Gar Saxon\'s surges', () => {
    assert.deepEqual(auraGrantedSurges(game(adj), combat), ['accuracy 2', 'block token', 'damage 1']);
  });

  it('out of range → no granted surges', () => {
    assert.deepEqual(auraGrantedSurges(game(far), combat), []);
  });

  it('no Gar Saxon on the board → no granted surges', () => {
    assert.deepEqual(auraGrantedSurges({ selectedMap: { id: map.id }, figurePositions: { 1: { [`${mobileDc}-1-0`]: anchor } } }, combat), []);
  });
});
