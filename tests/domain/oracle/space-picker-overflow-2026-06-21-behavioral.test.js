/**
 * Space picker must render valid Discord components for the widest/tallest maps —
 * no row above Discord's 5-button / 5-row / 25-option limits, nothing dropped
 * (alexanbv 2026-06-21). Tallest map = 28 rows (devaron-garrison); widest row =
 * 36 cells (corellian-underground).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowPickerButtons, getSpaceChoiceRows } from '../../../src/discord/components.js';

function assertValidMessage(rows) {
  assert.ok(rows.length <= 5, `<=5 action rows (got ${rows.length})`);
  for (const r of rows) {
    const comps = r.components || [];
    const isSelect = comps.length === 1 && (comps[0].data?.type === 3 || comps[0].data?.options);
    if (isSelect) {
      const opts = comps[0].data?.options || comps[0].options || [];
      assert.ok(opts.length <= 25, `select menu <=25 options (got ${opts.length})`);
    } else {
      assert.ok(comps.length <= 5, `<=5 buttons per row (got ${comps.length})`);
    }
  }
}

describe('space picker — tier-1 row picker', () => {
  it('uses a select menu (<=25 options) when a selection spans >20 rows', () => {
    const spaces = Array.from({ length: 28 }, (_, i) => `a${i + 1}`); // 28 distinct rows
    const { rows } = buildRowPickerButtons(spaces, 'space_row_g1_');
    assertValidMessage(rows);
    assert.equal(rows.length, 1, 'collapses to a single select-menu row');
    const menu = rows[0].components[0];
    assert.ok(menu.data?.options?.length >= 25 || menu.options?.length >= 25, 'menu offered up to 25 rows');
    assert.equal(menu.data?.custom_id, 'space_row_g1_', 'select customId routes to handleSpaceRow');
  });

  it('uses buttons (leaving room for an action row) when rows <= 20', () => {
    const spaces = Array.from({ length: 20 }, (_, i) => `a${i + 1}`);
    const { rows } = buildRowPickerButtons(spaces, 'space_row_g1_');
    assertValidMessage(rows);
    assert.ok(rows.length <= 4, 'at most 4 button rows so a 5th action row still fits');
  });
});

describe('space picker — tier-2 cell pager', () => {
  it('chunks a 36-cell row into <=5-button rows that paginate (4 rows/page)', () => {
    const cells = Array.from({ length: 36 }, (_, i) => `${String.fromCharCode(97 + (i % 26))}1`);
    const { rows: cellRows } = getSpaceChoiceRows('cc_space_g1_', cells, { spaces: cells }, Infinity, {});
    for (const r of cellRows) assert.ok(r.components.length <= 5, '<=5 cells per button row');
    // Page = 4 cell-rows + 1 action row = 5 (Discord max).
    const pages = Math.ceil(cellRows.length / 4);
    assert.ok(pages >= 2, '36 cells need >=2 pages');
    for (let p = 0; p < pages; p++) {
      const pageRows = cellRows.slice(p * 4, p * 4 + 4);
      assertValidMessage([...pageRows, { components: [{}, {}] }]); // + a stub action row
    }
  });
});
