import catAttention from "./assets/cat/cat-attention.gif";
import catError from "./assets/cat/cat-error.gif";
import catGreet from "./assets/cat/cat-greet.gif";
import catHappy from "./assets/cat/cat-happy.gif";
import catIdle from "./assets/cat/cat-idle.gif";
import catJuggling from "./assets/cat/cat-juggling.gif";
import catLoafing from "./assets/cat/cat-loafing.gif";
import catLoafing2 from "./assets/cat/cat-loafing-2.gif";
import catLoafing3 from "./assets/cat/cat-loafing-3.gif";
import catNeedsInput from "./assets/cat/cat-needsinput.gif";
import catRoam from "./assets/cat/cat-roam.gif";
import catSad from "./assets/cat/cat-sad.gif";
import catSleeping from "./assets/cat/cat-sleeping.gif";
import catSleeping2 from "./assets/cat/cat-sleeping-2.gif";
import catSweeping from "./assets/cat/cat-sweeping.gif";
import catTalking from "./assets/cat/cat-talking.gif";
import catThinking from "./assets/cat/cat-thinking.gif";
import catThinking2 from "./assets/cat/cat-thinking-2.gif";
import catWaiting from "./assets/cat/cat-waiting.gif";
import catWorking from "./assets/cat/cat-working.gif";
import catWorking2 from "./assets/cat/cat-working-2.gif";
import catWorking3 from "./assets/cat/cat-working-3.gif";
import catWorking4 from "./assets/cat/cat-working-4.gif";
import type { PetState } from "../../shared/pet/states";

const CAT_SINGLE: Partial<Record<PetState, string>> = {
  idle: catIdle,
  roam: catRoam,
  working: catWorking,
  thinking: catThinking,
  talking: catTalking,
  juggling: catJuggling,
  sweeping: catSweeping,
  waiting: catWaiting,
  needsinput: catNeedsInput,
  happy: catHappy,
  greet: catGreet,
  attention: catAttention,
  sleeping: catSleeping,
  error: catError,
  loafing: catLoafing,
  carrying: catWorking,
  notification: catNeedsInput,
};

const CAT_POOLS: Partial<Record<PetState, string[]>> = {
  working: [catWorking, catWorking2, catWorking3, catWorking4],
  thinking: [catThinking, catThinking2],
  sleeping: [catSleeping, catSleeping2],
  loafing: [catLoafing, catLoafing2, catLoafing3],
};

export function resolveCatAsset(state: PetState, poolIndex = 0): string {
  const pool = CAT_POOLS[state];
  if (pool?.length) {
    return pool[Math.abs(poolIndex) % pool.length];
  }
  return CAT_SINGLE[state] || catIdle;
}

export function resolveFallbackCatAsset(): string {
  return catSad;
}

export const CAT_ASSET_CREDIT =
  "月薪喵皮肤素材来自抖音 @月薪喵，详见 pet/assets/cat/CREDITS.md";
