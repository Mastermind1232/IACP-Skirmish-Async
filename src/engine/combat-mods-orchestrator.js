// Mods-window live orchestrator — slice C wiring (alexanbv 2026-06-14).
//
// Drives the mods gate across Discord button events (the live flow is event-
// driven, not a single async loop — so this is the stateful counterpart to
// runGate). The actual effects + prompts live in the handler layer and are
// injected as `dispatches`; this module owns only the SEQUENCING:
//   active side → auto-fire its passives → if it has interactive abilities,
//   post the player-ordered choose window and pause; else pass the side; when
//   both sides are done, signal completion.
//
// Event cycle:
//   _enterStep4 (flag on) → build gate → driveModsGate
//     • posts choose window for the active side → pauses
//   player picks ability  → handler posts that ability's prompt
//   ability resolves       → recordModsChoice + driveModsGate (next pending / side)
//   player clicks Done     → passModsSide + driveModsGate
//   gate complete          → dispatches.onComplete (dodge check → step5 surge)

import {
  activeSide,
  autoResolvePassives,
  pendingInteractive,
  passGate,
  chooseAbility,
} from './combat-ability-gate.js';

/**
 * Advance the mods gate until it needs player input or completes.
 * @param {object} gate  combat-ability-gate gate (e.g. combat.modsGate)
 * @param {object} dispatches
 * @param {(side:string,id:string)=>Promise<void>|void} dispatches.firePassive
 * @param {(side:string,pendingIds:string[])=>Promise<void>|void} dispatches.postChooseWindow
 * @param {()=>Promise<void>|void} dispatches.onComplete
 * @param {boolean} [dispatches.autoPassEmpty] when true (self-play / headless),
 *   a side with no pending interactive abilities is auto-passed WITHOUT posting
 *   a window (preserves the old auto-advance so self-play games don't stall on a
 *   button nobody clicks). Live games leave this false so every window posts.
 */
export async function driveModsGate(gate, dispatches) {
  if (!gate) { await dispatches.onComplete(); return; }
  let guard = 0;
  while (true) {
    if (++guard > 1000) throw new Error('driveModsGate: iteration guard exceeded');
    const side = activeSide(gate);
    if (!side) { await dispatches.onComplete(); return; }
    for (const id of autoResolvePassives(gate, side)) {
      if (dispatches.firePassive) await dispatches.firePassive(side, id);
    }
    const pending = pendingInteractive(gate, side);
    // alexanbv 2026-06-23: ALWAYS post the choose window for the active side and
    // pause — even with zero pending abilities the player must click Done; no
    // window auto-skips. (_postGateChooseWindow always appends the Done button.)
    // Self-play / headless auto-passes empty sides so it doesn't stall.
    if (pending.length === 0 && dispatches.autoPassEmpty) {
      passGate(gate, side);
      continue;
    }
    if (dispatches.postChooseWindow) await dispatches.postChooseWindow(side, pending);
    return; // pause for the player's pick/done
  }
}

/** Player picked an interactive ability and it resolved — record it on the gate. */
export function recordModsChoice(gate, side, abilityId) {
  chooseAbility(gate, side, abilityId);
}

/** Player clicked Done — pass this side's gate. */
export function passModsSide(gate, side) {
  passGate(gate, side);
}
