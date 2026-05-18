const validateSequence = (sequence) => {
  const { frames, fps } = sequence ?? {};

  if (!Array.isArray(frames) || frames.length === 0) {
    throw new TypeError("sequence.frames must be a non-empty array");
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError("sequence.fps must be a positive finite number");
  }
};

export const getFrameAtTime = (sequence, elapsedMs) => {
  validateSequence(sequence);

  const { frames, fps, loop = true } = sequence;
  const frameDuration = 1000 / fps;
  const rawIndex = Math.floor(Math.max(0, elapsedMs) / frameDuration);
  const frameIndex = loop
    ? rawIndex % frames.length
    : Math.min(rawIndex, frames.length - 1);

  return frames[frameIndex];
};

export const SPRITE_SHEETS = {
  miner: {
    src: "./assets/workers/miner-creature-sheet.png",
    frameWidth: 96,
    frameHeight: 72,
    states: {
      idle: { frames: [0], fps: 1, loop: true },
      mine: { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 12, loop: true },
    },
  },
  hauler: {
    src: "./assets/workers/hauler-creature-sheet.png",
    frameWidth: 96,
    frameHeight: 72,
    states: {
      idle: { frames: [0], fps: 1, loop: true },
      walk: { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 12, loop: true },
      pickup: { frames: [8, 9], fps: 10, loop: false },
      unload: { frames: [10, 11], fps: 10, loop: false },
    },
  },
  warehouse: {
    src: "./assets/buildings/warehouse-sheet.png",
    frameWidth: 112,
    frameHeight: 88,
    states: {
      idle: { frames: [0], fps: 1, loop: true },
      receive: { frames: [0, 1, 2, 3], fps: 10, loop: false },
    },
  },
};
