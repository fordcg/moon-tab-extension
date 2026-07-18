/** Shared pet state vocabulary (ported from LLMPET Octopus states). */

export const STATE_PRIORITY = {
  error: 8,
  notification: 7,
  sweeping: 6,
  attention: 5,
  carrying: 4,
  juggling: 4,
  waiting: 4,
  needsinput: 4,
  working: 3,
  thinking: 2,
  talking: 2,
  happy: 2,
  greet: 2,
  loafing: 1,
  idle: 1,
  roam: 1,
  sleeping: 0,
} as const;

export type PetState = keyof typeof STATE_PRIORITY;

export const ONESHOT_TTL_MS: Partial<Record<PetState, number>> = {
  attention: 15_000,
  carrying: 15_000,
  sweeping: 20_000,
  error: 45_000,
  happy: 4_000,
  greet: 3_000,
  talking: 6_000,
};

export const RENDER_STATE_WORDS: PetState[] = Object.keys(STATE_PRIORITY) as PetState[];

export function getStatePriority(state: string | undefined): number {
  if (!state) {
    return 0;
  }
  return STATE_PRIORITY[state as PetState] ?? 0;
}

export function pickDominantState(states: Array<string | undefined>): PetState {
  let best: PetState = "idle";
  let bestPriority = -1;
  for (const state of states) {
    const priority = getStatePriority(state);
    if (priority > bestPriority) {
      bestPriority = priority;
      best = (state as PetState) || "idle";
    }
  }
  return best;
}
