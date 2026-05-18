import { createRockPhysics } from "./rock-physics.mjs";
import { createWorkerSimulation } from "./workers.mjs";
import { runPageTransition } from "../../shared/page-transition.mjs";

const clock = document.getElementById("game-clock");
const searchForm = document.getElementById("game-search-form");
const searchInput = document.getElementById("game-search-input");
const returnButton = document.getElementById("return-pet-page");
const startButton = document.getElementById("start-game");
const gameScene = document.querySelector(".game-scene");
const gameWorld = document.querySelector(".game-world");
const oreMountain = document.querySelector(".ore-mountain");
const oreTooltip = oreMountain?.querySelector(".ore-mountain__tooltip");
const oreHitTargets = oreMountain ? Array.from(oreMountain.querySelectorAll(".ore-mountain__hitbox")) : [];
const groundLine = document.querySelector(".game-ground-line");
const groundOreCount = document.getElementById("ground-ore-count");
const storedOreCount = document.getElementById("stored-ore-count");
const orePile = document.querySelector(".game-ore-pile");
const storageZone = document.querySelector(".game-storage");
const workerLayer = document.querySelector(".game-worker-layer");
const gameStateLabel = document.querySelector(".game-deck-state");
const extensionApi = typeof chrome !== "undefined" ? chrome : null;
const initialOreCount = 100;
const resourceState = {
  oreRemaining: initialOreCount,
  groundOre: 0,
  storedOre: 0,
};
let orePhysics = null;
let workerSimulation = null;
let orePhysicsRefreshFrame = 0;

const formatTime = (date) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

const updateClock = () => {
  if (clock instanceof HTMLTimeElement) {
    const now = new Date();
    clock.textContent = formatTime(now);
    clock.dateTime = now.toISOString();
  }
};

const buildPetPageUrl = () =>
  extensionApi?.runtime?.getURL
    ? extensionApi.runtime.getURL("src/pages/newtab/index.html")
    : "./../newtab/index.html";

const runBingSearch = (query) => {
  window.location.href = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
};

const isPlaying = () => document.body.dataset.gameState === "playing";
const randomBetween = (min, max) => min + Math.random() * (max - min);

const ensureOrePhysics = () => {
  if (
    orePhysics
    || !(gameWorld instanceof HTMLElement)
    || !(groundLine instanceof HTMLElement)
    || !(oreMountain instanceof HTMLButtonElement)
  ) {
    return;
  }

  orePhysics = createRockPhysics({
    worldElement: gameWorld,
    groundElement: groundLine,
    mountainElement: oreMountain,
  });
};

const ensureWorkerSimulation = () => {
  if (
    workerSimulation
    || !(workerLayer instanceof HTMLElement)
    || !(gameWorld instanceof HTMLElement)
    || !(groundLine instanceof HTMLElement)
    || !(oreMountain instanceof HTMLButtonElement)
    || !(orePile instanceof HTMLElement)
    || !(storageZone instanceof HTMLElement)
  ) {
    return;
  }

  workerSimulation = createWorkerSimulation({
    layerElement: workerLayer,
    worldElement: gameWorld,
    groundElement: groundLine,
    mountainElement: oreMountain,
    pileElement: orePile,
    storageElement: storageZone,
    getOreRemaining: () => resourceState.oreRemaining,
    getGroundOre: () => resourceState.groundOre,
    mineMountain: (point) => mineMountainAtPoint(point, { depositToGround: true }),
    dropGroundOre: (amount) => addGroundOre(amount),
    pickupGroundOre: (amount) => pickupGroundOre(amount),
    pickupGroundRock: (point) => orePhysics?.pickupRock(point),
    storeOre: (amount) => storeOre(amount),
  });
};

const destroyWorldSystems = () => {
  if (orePhysicsRefreshFrame) {
    window.cancelAnimationFrame(orePhysicsRefreshFrame);
    orePhysicsRefreshFrame = 0;
  }

  orePhysics?.destroy();
  orePhysics = null;
  workerSimulation?.destroy();
  workerSimulation = null;
};

const scheduleOrePhysicsRefresh = () => {
  if (!orePhysics && !workerSimulation) {
    return;
  }

  if (orePhysicsRefreshFrame) {
    return;
  }

  orePhysicsRefreshFrame = window.requestAnimationFrame(() => {
    orePhysicsRefreshFrame = 0;
    orePhysics?.refresh();
    workerSimulation?.refresh();
  });
};

const getOreStage = (oreRemaining) => {
  if (oreRemaining >= 76) {
    return 5;
  }

  if (oreRemaining >= 51) {
    return 4;
  }

  if (oreRemaining >= 26) {
    return 3;
  }

  if (oreRemaining >= 1) {
    return 2;
  }

  return 1;
};

const updateOreMountainState = (oreRemaining) => {
  if (!(oreMountain instanceof HTMLButtonElement)) {
    return;
  }

  resourceState.oreRemaining = oreRemaining;
  oreMountain.dataset.ore = String(oreRemaining);
  oreMountain.dataset.stage = String(getOreStage(oreRemaining));
  oreMountain.disabled = oreRemaining <= 0;
  oreMountain.setAttribute("aria-label", `采集石山，剩余 ${oreRemaining}`);
  if (oreTooltip instanceof HTMLElement) {
    oreTooltip.textContent = String(oreRemaining);
  }
};

const pulseMountain = () => {
  if (!(oreMountain instanceof HTMLElement)) {
    return;
  }

  oreMountain.dataset.mining = "true";
  window.clearTimeout(pulseMountain.timeoutId);
  pulseMountain.timeoutId = window.setTimeout(() => {
    delete oreMountain.dataset.mining;
  }, 190);
};

pulseMountain.timeoutId = 0;

const syncResourceState = () => {
  if (groundOreCount instanceof HTMLElement) {
    groundOreCount.textContent = String(resourceState.groundOre);
  }

  if (storedOreCount instanceof HTMLElement) {
    storedOreCount.textContent = String(resourceState.storedOre);
  }

  if (orePile instanceof HTMLElement) {
    orePile.dataset.hasOre = resourceState.groundOre > 0 ? "true" : "false";
  }

  if (storageZone instanceof HTMLElement) {
    storageZone.dataset.active = resourceState.storedOre > 0 ? "true" : "false";
  }
};

const addGroundOre = (amount = 1) => {
  if (amount <= 0) {
    return 0;
  }

  resourceState.groundOre += amount;
  syncResourceState();
  return amount;
};

const pickupGroundOre = (amount = 1) => {
  const taken = Math.min(amount, resourceState.groundOre);
  if (taken <= 0) {
    return 0;
  }

  resourceState.groundOre -= taken;
  syncResourceState();
  return taken;
};

const storeOre = (amount = 1) => {
  if (amount <= 0) {
    return 0;
  }

  resourceState.storedOre += amount;
  syncResourceState();
  return amount;
};

const positionOreTooltip = (clientX, clientY) => {
  if (!(oreMountain instanceof HTMLElement) || !(oreTooltip instanceof HTMLElement)) {
    return;
  }

  const x = Math.min(window.innerWidth - 72, clientX + 16);
  const y = Math.max(10, clientY - 22);
  oreTooltip.style.setProperty("--tooltip-x", `${x}px`);
  oreTooltip.style.setProperty("--tooltip-y", `${y}px`);
};

const showOreTooltip = (clientX, clientY) => {
  if (!(oreMountain instanceof HTMLElement)) {
    return;
  }

  positionOreTooltip(clientX, clientY);
  oreMountain.dataset.tooltipVisible = "true";
};

const hideOreTooltip = () => {
  if (!(oreMountain instanceof HTMLElement)) {
    return;
  }

  delete oreMountain.dataset.tooltipVisible;
};

const buildWorldPoint = (clientX, clientY) => {
  if (!(gameWorld instanceof HTMLElement) || !(oreMountain instanceof HTMLElement)) {
    return { x: 0, y: 0 };
  }

  const worldRect = gameWorld.getBoundingClientRect();
  const mountainRect = oreMountain.getBoundingClientRect();
  const safeX = Number.isFinite(clientX) && clientX > 0 ? clientX : mountainRect.left + mountainRect.width * 0.56;
  const safeY = Number.isFinite(clientY) && clientY > 0 ? clientY : mountainRect.top + mountainRect.height * 0.58;

  return {
    x: safeX - worldRect.left,
    y: safeY - worldRect.top,
  };
};

const spawnOreChips = (origin) => {
  if (!(gameWorld instanceof HTMLElement)) {
    return;
  }

  const chipCount = Math.floor(randomBetween(2, 5));

  for (let index = 0; index < chipCount; index += 1) {
    const chip = document.createElement("span");
    chip.className = "ore-chip";
    chip.style.left = `${origin.x}px`;
    chip.style.top = `${origin.y}px`;
    chip.style.setProperty("--dx", `${randomBetween(-24, 24).toFixed(1)}px`);
    chip.style.setProperty("--dy", `${randomBetween(-20, 12).toFixed(1)}px`);
    chip.style.setProperty("--rotation", `${randomBetween(-70, 70).toFixed(1)}deg`);
    gameWorld.append(chip);
    window.setTimeout(() => chip.remove(), 700);
  }
};

const mineMountainAtPoint = (point, { depositToGround = true, tooltipPoint = null } = {}) => {
  if (!isPlaying() || resourceState.oreRemaining <= 0) {
    return false;
  }

  updateOreMountainState(resourceState.oreRemaining - 1);
  pulseMountain();
  spawnOreChips(point);
  ensureOrePhysics();
  orePhysics?.refresh();
  orePhysics?.spawnRock(point);

  if (depositToGround) {
    addGroundOre(1);
  }

  if (tooltipPoint) {
    showOreTooltip(tooltipPoint.x, tooltipPoint.y);
  }

  return true;
};

const setupOreMountain = () => {
  if (!(oreMountain instanceof HTMLButtonElement)) {
    return;
  }

  let lastPointer = null;

  const rememberPointer = (event) => {
    lastPointer = {
      x: event.clientX,
      y: event.clientY,
    };
  };

  const mine = (event) => {
    if (!isPlaying()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const point = buildWorldPoint(
      event.clientX || lastPointer?.x,
      event.clientY || lastPointer?.y,
    );

    mineMountainAtPoint(point, {
      depositToGround: true,
      tooltipPoint: lastPointer,
    });
  };

  for (const target of oreHitTargets) {
    target.addEventListener("pointerenter", (event) => {
      rememberPointer(event);
      showOreTooltip(event.clientX, event.clientY);
    });

    target.addEventListener("pointermove", (event) => {
      rememberPointer(event);
      showOreTooltip(event.clientX, event.clientY);
    });

    target.addEventListener("pointerleave", () => {
      hideOreTooltip();
    });

    target.addEventListener("pointerdown", (event) => {
      rememberPointer(event);
      event.stopPropagation();
    });

    target.addEventListener("pointerup", (event) => {
      event.stopPropagation();
    });

    target.addEventListener("click", mine);
  }

  updateOreMountainState(initialOreCount);
  syncResourceState();
};

const setupSceneDrag = (scene) => {
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartScrollLeft = 0;

  const safelySetPointerCapture = (pointerId) => {
    try {
      scene.setPointerCapture?.(pointerId);
    } catch {
      // Synthetic verifier events do not create an active pointer capture target.
    }
  };

  const safelyReleasePointerCapture = (pointerId) => {
    try {
      scene.releasePointerCapture?.(pointerId);
    } catch {
      // Matching the safe capture path keeps drag tests and real input quiet.
    }
  };

  scene.addEventListener("pointerdown", (event) => {
    if (!isPlaying() || event.button !== 0 || event.target.closest(".ore-mountain")) {
      return;
    }

    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartScrollLeft = scene.scrollLeft;
    scene.dataset.dragging = "true";
    safelySetPointerCapture(event.pointerId);
  });

  scene.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    scene.scrollLeft = dragStartScrollLeft + (dragStartX - event.clientX);
  });

  const stopDrag = (event) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    dragPointerId = null;
    delete scene.dataset.dragging;
    safelyReleasePointerCapture(event.pointerId);
  };

  scene.addEventListener("pointerup", stopDrag);
  scene.addEventListener("pointercancel", stopDrag);
};

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!(searchInput instanceof HTMLInputElement)) {
    return;
  }

  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }

  runBingSearch(query);
});

returnButton?.addEventListener("click", () => {
  void runPageTransition({
    documentRef: document,
    windowRef: window,
    label: "RETURNING TO PET DECK",
    mode: "return-pet",
    onComplete: () => {
      window.location.href = buildPetPageUrl();
    },
  });
});

startButton?.addEventListener("click", () => {
  document.body.dataset.gameState = "playing";
  if (gameStateLabel instanceof HTMLElement) {
    gameStateLabel.textContent = "PLAYING";
  }

  ensureOrePhysics();
  ensureWorkerSimulation();
  orePhysics?.refresh();
  workerSimulation?.refresh();
  workerSimulation?.start();
  scheduleOrePhysicsRefresh();
});

window.addEventListener("resize", scheduleOrePhysicsRefresh);
window.addEventListener("pageshow", scheduleOrePhysicsRefresh);
window.addEventListener("pagehide", destroyWorldSystems, { once: true });

if (gameScene instanceof HTMLElement) {
  setupSceneDrag(gameScene);
}

setupOreMountain();

updateClock();
window.setInterval(updateClock, 1000);
