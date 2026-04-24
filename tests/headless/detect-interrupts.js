#!/usr/bin/env node
/**
 * JS shim for movement-interrupt detection parity.
 *
 * Reads {game, playerNum, figureKey, path} from stdin.
 * Runs detectPostMoveInterrupts; prints {ok, triggers}.
 */
import { detectPostMoveInterrupts } from '../../src/game/movement-interrupts.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify({ok: false, error: 'empty stdin'}));
    process.exit(2);
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) {
    process.stdout.write(JSON.stringify({ok: false, error: `bad JSON: ${e.message}`}));
    process.exit(2);
  }
  const {game, playerNum, figureKey, path} = payload;
  try {
    const triggers = detectPostMoveInterrupts(game, playerNum, figureKey, path);
    process.stdout.write(JSON.stringify({ok: true, triggers}));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: `${e.constructor.name}: ${e.message}`,
      stack: e.stack,
    }));
    process.exit(1);
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ok: false, error: `top: ${e.message}`}));
  process.exit(3);
});
