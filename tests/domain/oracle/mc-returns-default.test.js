/**
 * MC-returns default (2026-04-17) — after the fork test (final-250 avgVP
 * 56.51 vs 53.89 for matched n-step control) established a credit-assignment
 * ceiling, USE_MC_RETURNS is now default-on in learnings.js. This test
 * pins that default and the override toggle so a silent flip (intentional
 * or otherwise) doesn't regress the training target quietly.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getUseMcReturns,
  setUseMcReturns,
} from '../../headless/learnings.js';

describe('MC returns default target', () => {
  afterEach(() => setUseMcReturns(true)); // restore module default

  it('is enabled on module load', () => {
    assert.equal(getUseMcReturns(), true,
      'USE_MC_RETURNS must default to true after fork-test verdict');
  });

  it('setUseMcReturns(false) flips it off (n-step override path)', () => {
    setUseMcReturns(false);
    assert.equal(getUseMcReturns(), false);
  });

  it('setUseMcReturns(true) restores default', () => {
    setUseMcReturns(false);
    setUseMcReturns(true);
    assert.equal(getUseMcReturns(), true);
  });

  it('coerces non-boolean to boolean (guard against truthy strings)', () => {
    setUseMcReturns(0);
    assert.equal(getUseMcReturns(), false);
    setUseMcReturns('x');
    assert.equal(getUseMcReturns(), true);
  });
});
