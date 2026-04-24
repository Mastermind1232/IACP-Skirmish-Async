#!/usr/bin/env node
/**
 * JS-side ability-apply CLI for Python parity harness.
 *
 * Reads one JSON line from stdin of shape:
 *   { abilityId, game, context, multiStep? }
 *
 * Calls src/game/abilities.js:resolveAbility(abilityId, context) after
 * attaching `game` into context. Prints result as JSON to stdout:
 *   { ok: true, game, result, iterations? } — on success
 *   { ok: false, error, stack }             — on thrown exception
 *
 * When `multiStep: true`, the CLI loops: if resolveAbility returns
 * `{applied: false, requiresChoice}`, we re-invoke with
 * `choiceIndex: 0`; if it returns `{requiresSpaceChoice}`, we pick
 * the first validSpace; if it returns `{requiresTargetChoice}` or has
 * `targetFigureKeys`, we pick the first. Up to 5 iterations to avoid
 * infinite loops. This simulates the JS handler path (dc-play-area.js)
 * which collects user picks and re-invokes resolveAbility.
 *
 * Designed for per-ability parity testing against the Python engine.
 * Not a performance path — one process per call.
 */
import { resolveAbility } from '../../src/game/abilities.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify({
      ok: false, error: 'empty stdin',
    }));
    process.exit(2);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false, error: `invalid JSON: ${e.message}`,
    }));
    process.exit(2);
  }
  const { abilityId, game = {}, context = {}, multiStep = false } = payload;
  if (!abilityId) {
    process.stdout.write(JSON.stringify({
      ok: false, error: 'missing abilityId',
    }));
    process.exit(2);
  }
  // Attach game into context; resolveAbility mutates game in-place.
  let ctx = { ...context, game };
  const iterations = [];
  const MAX_ITER = 5;
  try {
    let result = resolveAbility(abilityId, ctx);
    iterations.push({ result, ctxKeys: Object.keys(ctx) });

    if (multiStep) {
      for (let i = 0; i < MAX_ITER; i++) {
        if (result.applied) break;
        let nextCtx = null;
        if (result.requiresChoice && Array.isArray(result.choiceOptions)) {
          nextCtx = { ...ctx, choiceIndex: 0 };
        } else if (result.requiresSpaceChoice
                   && Array.isArray(result.validSpaces)
                   && result.validSpaces.length > 0) {
          nextCtx = { ...ctx, chosenSpace: result.validSpaces[0] };
        } else if (result.requiresTargetChoice
                   && Array.isArray(result.targetFigureKeys)
                   && result.targetFigureKeys.length > 0) {
          nextCtx = { ...ctx, targetFigureKey: result.targetFigureKeys[0] };
        } else if (Array.isArray(result.targetFigureKeys)
                   && result.targetFigureKeys.length > 0
                   && !ctx.targetFigureKey) {
          nextCtx = { ...ctx, targetFigureKey: result.targetFigureKeys[0] };
        } else {
          break;
        }
        ctx = nextCtx;
        result = resolveAbility(abilityId, ctx);
        iterations.push({ result, ctxKeys: Object.keys(ctx) });
      }
    }

    process.stdout.write(JSON.stringify({
      ok: true,
      abilityId,
      game,
      result,
      iterations: multiStep ? iterations.length : undefined,
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false,
      abilityId,
      error: `${e.constructor.name}: ${e.message}`,
      stack: e.stack,
    }));
    process.exit(1);
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: `top-level: ${e.message}`,
    stack: e.stack,
  }));
  process.exit(3);
});
