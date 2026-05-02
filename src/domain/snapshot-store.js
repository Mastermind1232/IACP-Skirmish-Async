import { insertSnapshot as dbInsertSnapshot, getLatestSnapshot as dbGetLatestSnapshot, deleteSnapshots as dbDeleteSnapshots } from '../db.js';

export const SNAPSHOT_INTERVAL = 50;

export async function saveSnapshot(gameId, version, state) {
  const stripped = JSON.parse(JSON.stringify(state));
  delete stripped.undoStack;
  delete stripped.moveGridMessageIds;
  await dbInsertSnapshot(gameId, version, stripped);
}

export async function loadLatestSnapshot(gameId) {
  return dbGetLatestSnapshot(gameId);
}

export async function deleteSnapshots(gameId) {
  return dbDeleteSnapshots(gameId);
}

export function shouldSnapshot(version) {
  return version > 0 && version % SNAPSHOT_INTERVAL === 0;
}
