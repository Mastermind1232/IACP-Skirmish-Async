import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFavoriteConfirmButtons,
  buildFavoriteConfirmContent,
  buildFavoritesListPayload,
  buildFavoriteDetailPayload,
} from '../../src/handlers/favorites.js';

// ── buildFavoriteConfirmButtons ──

describe('buildFavoriteConfirmButtons', () => {
  it('shows Save + Confirm + Cancel when no existing favorite', () => {
    const row = buildFavoriteConfirmButtons('g1', 1, null);
    const buttons = row.components;
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].data.custom_id, 'squad_confirm_g1_1');
    assert.equal(buttons[0].data.label, 'Confirm Deck');
    assert.equal(buttons[1].data.custom_id, 'fav_save_g1_1');
    assert.equal(buttons[1].data.label, 'Save to Favorites');
    assert.equal(buttons[2].data.custom_id, 'squad_cancel_g1_1');
    assert.equal(buttons[2].data.label, 'Cancel');
  });

  it('shows Rename + Remove + Confirm + Cancel when favorite exists', () => {
    const row = buildFavoriteConfirmButtons('g2', 2, { saved_name: 'My Deck', id: 7 });
    const buttons = row.components;
    assert.equal(buttons.length, 4);
    assert.equal(buttons[0].data.label, 'Confirm Deck');
    assert.equal(buttons[1].data.custom_id, 'fav_rename_g2_2');
    assert.equal(buttons[1].data.label, 'Rename Favorite');
    assert.equal(buttons[2].data.custom_id, 'fav_remove_g2_2');
    assert.equal(buttons[2].data.label, 'Remove Favorite');
    assert.equal(buttons[3].data.label, 'Cancel');
  });
});

// ── buildFavoriteConfirmContent ──

describe('buildFavoriteConfirmContent', () => {
  it('returns base text when no favorite', () => {
    assert.equal(buildFavoriteConfirmContent('deck list here', null), 'deck list here');
  });

  it('prepends star label when favorite exists', () => {
    const result = buildFavoriteConfirmContent('deck list here', { saved_name: 'My Rebels' });
    assert.ok(result.startsWith('★ **Saved favorite:** "My Rebels"'));
    assert.ok(result.includes('deck list here'));
  });
});

// ── buildFavoritesListPayload ──

describe('buildFavoritesListPayload', () => {
  it('returns empty message when no favorites', () => {
    const payload = buildFavoritesListPayload([]);
    assert.ok(payload.content.includes("don't have any"));
    assert.equal(payload.components.length, 0);
  });

  it('returns null-safe for null input', () => {
    const payload = buildFavoritesListPayload(null);
    assert.ok(payload.content.includes("don't have any"));
  });

  it('builds select menu from favorites list', () => {
    const favs = [
      { id: 1, saved_name: 'Rebel Troopers', affiliation: 'Rebel', point_total: 40, use_count: 3 },
      { id: 2, saved_name: 'Empire Elite', affiliation: 'Imperial', point_total: 39, use_count: 0 },
    ];
    const payload = buildFavoritesListPayload(favs);
    assert.ok(payload.content.includes('2 decks'));
    assert.equal(payload.components.length, 1);
    const select = payload.components[0].components[0];
    assert.equal(select.options.length, 2);
    assert.equal(select.options[0].data.label, 'Rebel Troopers');
    assert.equal(select.options[0].data.value, '1');
    assert.equal(select.options[1].data.label, 'Empire Elite');
  });

  it('truncates long saved_name labels', () => {
    const longName = 'A'.repeat(150);
    const favs = [{ id: 1, saved_name: longName, affiliation: 'Rebel', point_total: 40, use_count: 0 }];
    const payload = buildFavoritesListPayload(favs);
    const label = payload.components[0].components[0].options[0].data.label;
    assert.ok(label.length <= 100);
  });
});

// ── buildFavoriteDetailPayload ──

describe('buildFavoriteDetailPayload', () => {
  const fav = {
    id: 5,
    saved_name: 'My Rebels',
    affiliation: 'Rebel',
    point_total: 40,
    deck_data: { dcList: ['Luke Skywalker'], ccList: ['Son of Skywalker'], dcCount: 1, ccCount: 1 },
    created_at: '2025-01-15T00:00:00Z',
    last_used_at: '2025-02-01T00:00:00Z',
    use_count: 5,
  };

  const deps = {
    validateDeckLegal: (squad) => ({ legal: true, dcTotal: 10, ccTotal: 5, errors: [] }),
    buildSquadConfirmText: (squad, val) => `Deck: ${squad.dcList.join(', ')}`,
  };

  it('includes favorite name and affiliation in content', () => {
    const { content } = buildFavoriteDetailPayload(fav, deps);
    assert.ok(content.includes('★ **My Rebels**'));
    assert.ok(content.includes('Rebel'));
    assert.ok(content.includes('40pt'));
  });

  it('includes deck text from buildSquadConfirmText', () => {
    const { content } = buildFavoriteDetailPayload(fav, deps);
    assert.ok(content.includes('Luke Skywalker'));
  });

  it('includes usage stats', () => {
    const { content } = buildFavoriteDetailPayload(fav, deps);
    assert.ok(content.includes('Used 5 times'));
  });

  it('has Rename, Remove, and Back buttons', () => {
    const { components } = buildFavoriteDetailPayload(fav, deps);
    assert.equal(components.length, 1);
    const buttons = components[0].components;
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].data.label, 'Rename Favorite');
    assert.equal(buttons[0].data.custom_id, 'fav_list_rename_5');
    assert.equal(buttons[1].data.label, 'Remove Favorite');
    assert.equal(buttons[1].data.custom_id, 'fav_list_remove_5');
    assert.equal(buttons[2].data.label, 'Back to List');
  });

  it('handles deck_data as JSON string', () => {
    const favStr = { ...fav, deck_data: JSON.stringify(fav.deck_data) };
    const { content } = buildFavoriteDetailPayload(favStr, deps);
    assert.ok(content.includes('Luke Skywalker'));
  });
});
