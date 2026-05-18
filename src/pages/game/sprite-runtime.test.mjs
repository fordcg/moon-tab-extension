import test from "node:test";
import assert from "node:assert/strict";

import { getFrameAtTime } from "./sprite-runtime.mjs";

test("getFrameAtTime loops miner frames smoothly", () => {
  const sequence = { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 12, loop: true };
  const frameDuration = 1000 / 12;
  const fullCycleDuration = frameDuration * sequence.frames.length;

  assert.equal(getFrameAtTime(sequence, 0), 0);
  assert.equal(getFrameAtTime(sequence, 84), 1);
  assert.equal(getFrameAtTime(sequence, frameDuration), 1);
  assert.equal(getFrameAtTime(sequence, 250), 3);
  assert.equal(getFrameAtTime(sequence, fullCycleDuration), 0);
  assert.equal(getFrameAtTime(sequence, 667), 0);
});

test("getFrameAtTime clamps non-looping warehouse frames", () => {
  const sequence = { frames: [0, 1, 2, 3], fps: 10, loop: false };
  const finalFrameStart = (sequence.frames.length - 1) * (1000 / sequence.fps);

  assert.equal(getFrameAtTime(sequence, 0), 0);
  assert.equal(getFrameAtTime(sequence, 120), 1);
  assert.equal(getFrameAtTime(sequence, 260), 2);
  assert.equal(getFrameAtTime(sequence, finalFrameStart), 3);
  assert.equal(getFrameAtTime(sequence, 999), 3);
});

test("getFrameAtTime clamps negative elapsed time to the first frame", () => {
  const sequence = { frames: [4, 5, 6, 7], fps: 12, loop: true };

  assert.equal(getFrameAtTime(sequence, -1), 4);
  assert.equal(getFrameAtTime(sequence, -250), 4);
});

test("getFrameAtTime rejects missing or empty frames metadata", () => {
  assert.throws(() => getFrameAtTime({ fps: 12, loop: true }, 0), {
    name: "TypeError",
  });
  assert.throws(() => getFrameAtTime({ frames: [], fps: 12, loop: true }, 0), {
    name: "TypeError",
  });
});

test("getFrameAtTime rejects invalid fps metadata", () => {
  assert.throws(() => getFrameAtTime({ frames: [0, 1], fps: 0, loop: true }, 0), {
    name: "RangeError",
  });
  assert.throws(() => getFrameAtTime({ frames: [0, 1], fps: Number.NaN, loop: true }, 0), {
    name: "RangeError",
  });
});
