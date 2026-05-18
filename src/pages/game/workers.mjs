const WALK_EPSILON = 1.2;
const MINER_SPEED = 90;
const HAULER_SPEED = 76;
const MINER_MINE_TIME = 0.82;
const HAULER_PICKUP_TIME = 0.34;
const HAULER_UNLOAD_TIME = 0.36;

const createWorkerElement = (role) => {
  const element = document.createElement("div");
  element.className = "game-worker";
  element.dataset.role = role;
  element.dataset.state = "idle";
  element.dataset.carry = "0";
  element.innerHTML = `
    <div class="game-worker__rig">
      <span class="game-worker__shadow"></span>
      <span class="game-worker__head"></span>
      <span class="game-worker__torso"></span>
      <span class="game-worker__arm game-worker__arm--rear"></span>
      <span class="game-worker__arm game-worker__arm--front"></span>
      <span class="game-worker__leg game-worker__leg--rear"></span>
      <span class="game-worker__leg game-worker__leg--front"></span>
      <span class="game-worker__tool"></span>
      <span class="game-worker__load"></span>
    </div>
  `;
  return element;
};

const createWorker = (role, speed) => ({
  role,
  speed,
  phase: "idle",
  state: "idle",
  carry: 0,
  facing: 1,
  x: 0,
  y: 0,
  targetX: 0,
  timer: 0,
  element: createWorkerElement(role),
});

const setWorkerState = (worker, state) => {
  worker.state = state;
  worker.element.dataset.state = state;
  worker.element.dataset.carry = worker.carry > 0 ? "1" : "0";
};

const renderWorker = (worker) => {
  worker.element.style.left = `${worker.x}px`;
  worker.element.style.top = `${worker.y}px`;
  worker.element.style.transform = `translate(-50%, -100%) scaleX(${worker.facing})`;
  worker.element.dataset.carry = worker.carry > 0 ? "1" : "0";
};

const moveWorker = (worker, dt) => {
  const deltaX = worker.targetX - worker.x;
  if (Math.abs(deltaX) <= WALK_EPSILON) {
    worker.x = worker.targetX;
    return true;
  }

  worker.facing = deltaX >= 0 ? 1 : -1;
  const travel = Math.min(Math.abs(deltaX), worker.speed * dt);
  worker.x += Math.sign(deltaX) * travel;
  return false;
};

const readNumericDataset = (element, key, fallback) => {
  if (!(element instanceof HTMLElement)) {
    return fallback;
  }

  const rawValue = element.dataset[key];
  const parsed = Number.parseFloat(rawValue ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const createWorkerSimulation = ({
  layerElement,
  worldElement,
  groundElement,
  mountainElement,
  pileElement,
  storageElement,
  getOreRemaining,
  getGroundOre,
  mineMountain,
  dropGroundOre,
  pickupGroundOre,
  pickupGroundRock,
  storeOre,
}) => {
  if (!(layerElement instanceof HTMLElement)) {
    throw new Error("layerElement is required");
  }

  const miner = createWorker("miner", MINER_SPEED);
  const hauler = createWorker("hauler", HAULER_SPEED);
  layerElement.append(miner.element, hauler.element);

  const state = {
    miner,
    hauler,
    anchors: null,
    initialized: false,
    running: false,
    rafId: 0,
    lastNow: performance.now(),
    destroyed: false,
  };

  const buildAnchors = () => {
    if (
      !(worldElement instanceof HTMLElement)
      || !(groundElement instanceof HTMLElement)
      || !(mountainElement instanceof HTMLElement)
      || !(pileElement instanceof HTMLElement)
      || !(storageElement instanceof HTMLElement)
    ) {
      return null;
    }

    const worldRect = worldElement.getBoundingClientRect();
    const groundRect = groundElement.getBoundingClientRect();
    const mountainRect = mountainElement.getBoundingClientRect();
    const pileRect = pileElement.getBoundingClientRect();
    const storageRect = storageElement.getBoundingClientRect();

    const toWorldX = (rect, ratio = 0.5) => rect.left - worldRect.left + rect.width * ratio;
    const toWorldY = (rect, ratio = 0.5) => rect.top - worldRect.top + rect.height * ratio;

    const pileCenterX = toWorldX(pileRect, 0.5);
    const storageCenterX = toWorldX(storageRect, 0.5);
    const mineStandRatio = readNumericDataset(mountainElement, "mineStandRatio", 0.6);
    const mineEffectXRatio = readNumericDataset(mountainElement, "mineEffectXRatio", 0.63);
    const mineEffectYRatio = readNumericDataset(mountainElement, "mineEffectYRatio", 0.56);
    const minerPileOffsetX = readNumericDataset(pileElement, "minerAnchorOffsetX", -22);
    const haulerPileOffsetX = readNumericDataset(pileElement, "haulerAnchorOffsetX", 16);
    const haulerWaitOffsetX = readNumericDataset(storageElement, "waitAnchorOffsetX", -26);
    const storageOffsetX = readNumericDataset(storageElement, "unloadAnchorOffsetX", 0);
    const mineStandX = mountainRect.left - worldRect.left + mountainRect.width * mineStandRatio;

    return {
      groundY: groundRect.top - worldRect.top + 1,
      mineStandX,
      mineEffectX: mountainRect.left - worldRect.left + mountainRect.width * mineEffectXRatio,
      mineEffectY: toWorldY(mountainRect, mineEffectYRatio),
      minerPileX: pileCenterX + minerPileOffsetX,
      haulerPileX: pileCenterX + haulerPileOffsetX,
      haulerWaitX: storageCenterX + haulerWaitOffsetX,
      storageX: storageCenterX + storageOffsetX,
    };
  };

  const syncAnchoredPositions = () => {
    state.anchors = buildAnchors();
    if (!state.anchors) {
      return;
    }

    const { anchors } = state;

    if (!state.initialized) {
      miner.x = anchors.mineStandX;
      hauler.x = anchors.haulerWaitX;
      miner.y = anchors.groundY;
      hauler.y = anchors.groundY;
      miner.targetX = anchors.mineStandX;
      hauler.targetX = anchors.haulerWaitX;
      state.initialized = true;
    } else {
      miner.y = anchors.groundY;
      hauler.y = anchors.groundY;
    }

    renderWorker(miner);
    renderWorker(hauler);
  };

  const updateMiner = (dt) => {
    const { anchors } = state;
    if (!anchors) {
      return;
    }

    switch (miner.phase) {
      case "walkToMine":
        miner.targetX = anchors.mineStandX;
        setWorkerState(miner, "walk");
        if (moveWorker(miner, dt)) {
          if (getOreRemaining() > 0) {
            miner.phase = "mine";
            miner.timer = MINER_MINE_TIME;
            setWorkerState(miner, "mine");
          } else {
            miner.phase = "idle";
            setWorkerState(miner, "idle");
          }
        }
        break;

      case "mine":
        if (getOreRemaining() <= 0) {
          miner.phase = "idle";
          setWorkerState(miner, "idle");
          break;
        }

        miner.timer -= dt;
        if (miner.timer <= 0) {
          const mined = mineMountain({
            x: anchors.mineEffectX,
            y: anchors.mineEffectY,
          });
          if (mined) {
            miner.carry = 0;
            if (getOreRemaining() > 0) {
              miner.phase = "mine";
              miner.timer = MINER_MINE_TIME;
              setWorkerState(miner, "mine");
            } else {
              miner.phase = "idle";
              setWorkerState(miner, "idle");
            }
          } else {
            miner.phase = "idle";
            setWorkerState(miner, "idle");
          }
        }
        break;

      case "walkToPile":
      case "drop":
        miner.carry = 0;
        miner.phase = getOreRemaining() > 0 ? "walkToMine" : "idle";
        setWorkerState(miner, miner.phase === "idle" ? "idle" : "walk");
        break;

      case "idle":
      default:
        miner.targetX = anchors.mineStandX;
        if (Math.abs(miner.targetX - miner.x) > WALK_EPSILON) {
          setWorkerState(miner, "walk");
          moveWorker(miner, dt);
        } else {
          setWorkerState(miner, "idle");
        }
        if (getOreRemaining() > 0) {
          miner.phase = "walkToMine";
        }
        break;
    }
  };

  const updateHauler = (dt) => {
    const { anchors } = state;
    if (!anchors) {
      return;
    }

    switch (hauler.phase) {
      case "walkToPile":
        hauler.targetX = anchors.haulerPileX;
        setWorkerState(hauler, "walk");
        if (moveWorker(hauler, dt)) {
          hauler.phase = "pickup";
          hauler.timer = HAULER_PICKUP_TIME;
          setWorkerState(hauler, "pickup");
        }
        break;

      case "pickup":
        if (getGroundOre() <= 0) {
          hauler.phase = "wait";
          setWorkerState(hauler, "idle");
          break;
        }

        hauler.timer -= dt;
        if (hauler.timer <= 0) {
          const picked = pickupGroundOre(1);
          if (picked > 0) {
            pickupGroundRock?.({
              x: anchors.haulerPileX,
              y: anchors.groundY,
            });
            hauler.carry = picked;
            hauler.phase = "walkToStorage";
            setWorkerState(hauler, "walk");
          } else {
            hauler.phase = "wait";
            setWorkerState(hauler, "idle");
          }
        }
        break;

      case "walkToStorage":
        hauler.targetX = anchors.storageX;
        setWorkerState(hauler, "walk");
        if (moveWorker(hauler, dt)) {
          hauler.phase = "unload";
          hauler.timer = HAULER_UNLOAD_TIME;
          setWorkerState(hauler, "unload");
        }
        break;

      case "unload":
        hauler.timer -= dt;
        if (hauler.timer <= 0) {
          if (hauler.carry > 0) {
            storeOre(hauler.carry);
          }
          hauler.carry = 0;
          hauler.phase = "wait";
          setWorkerState(hauler, "idle");
        }
        break;

      case "wait":
      default:
        hauler.targetX = anchors.haulerWaitX;
        if (Math.abs(hauler.targetX - hauler.x) > WALK_EPSILON) {
          setWorkerState(hauler, "walk");
          moveWorker(hauler, dt);
        } else {
          setWorkerState(hauler, "idle");
        }
        if (getGroundOre() > 0) {
          hauler.phase = "walkToPile";
        }
        break;
    }
  };

  const tick = (now) => {
    if (state.destroyed || !state.running) {
      return;
    }

    const dt = Math.min(0.05, (now - state.lastNow || 1000 / 60) / 1000);
    state.lastNow = now;

    updateMiner(dt);
    updateHauler(dt);
    renderWorker(miner);
    renderWorker(hauler);

    state.rafId = window.requestAnimationFrame(tick);
  };

  syncAnchoredPositions();

  return {
    start() {
      if (state.destroyed || state.running) {
        return;
      }

      state.running = true;
      state.lastNow = performance.now();
      miner.carry = 0;
      miner.phase = getOreRemaining() > 0 ? "walkToMine" : "idle";
      hauler.phase = hauler.carry > 0 ? "walkToStorage" : "wait";
      state.rafId = window.requestAnimationFrame(tick);
    },
    stop() {
      if (!state.running) {
        return;
      }

      state.running = false;
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    },
    refresh() {
      syncAnchoredPositions();
    },
    destroy() {
      if (state.destroyed) {
        return;
      }

      state.destroyed = true;
      state.running = false;
      window.cancelAnimationFrame(state.rafId);
      miner.element.remove();
      hauler.element.remove();
    },
  };
};
