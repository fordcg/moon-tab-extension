const MatterApi = globalThis.Matter;

if (!MatterApi) {
  throw new Error("Matter.js is not available on globalThis");
}

const { Engine, Bodies, Body, Composite } = MatterApi;

const ROCK_TEXTURES = [
  new URL("./assets/rocks/source/ore-pebble-01.png", import.meta.url).href,
  new URL("./assets/rocks/source/ore-pebble-02.png", import.meta.url).href,
  new URL("./assets/rocks/source/ore-pebble-03.png", import.meta.url).href,
];

const FIXED_DT = 1000 / 60;
const DEFAULT_MAX_ROCKS = 100;

const randomBetween = (min, max) => min + Math.random() * (max - min);

const pickTexture = () =>
  ROCK_TEXTURES[Math.floor(Math.random() * ROCK_TEXTURES.length)];

export const createRockPhysics = ({
  worldElement,
  groundElement,
  mountainElement,
  maxRocks = DEFAULT_MAX_ROCKS,
}) => {
  if (!(worldElement instanceof HTMLElement)) {
    throw new Error("worldElement is required");
  }

  if (!(groundElement instanceof HTMLElement)) {
    throw new Error("groundElement is required");
  }

  if (!(mountainElement instanceof HTMLElement)) {
    throw new Error("mountainElement is required");
  }

  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.04;

  const rockLayer = document.createElement("div");
  rockLayer.className = "ore-rock-layer";
  rockLayer.setAttribute("aria-hidden", "true");
  worldElement.append(rockLayer);

  const state = {
    rockLayer,
    engine,
    rocks: [],
    statics: [],
    rafId: 0,
    lastNow: performance.now(),
  };

  const removeRock = (rock) => {
    Composite.remove(engine.world, rock.body);
    rock.element.remove();
    state.rocks = state.rocks.filter((entry) => entry !== rock);
  };

  const recycleSleepingRocks = () => {
    if (state.rocks.length <= maxRocks) {
      return;
    }

    const removable = state.rocks
      .filter((rock) => rock.body.isSleeping)
      .sort((left, right) => left.spawnedAt - right.spawnedAt);

    while (state.rocks.length > maxRocks && removable.length > 0) {
      removeRock(removable.shift());
    }

    while (state.rocks.length > maxRocks) {
      removeRock(state.rocks[0]);
    }
  };

  const syncRock = (rock) => {
    const size = rock.radius * 2;
    rock.element.style.width = `${size}px`;
    rock.element.style.height = `${size}px`;
    rock.element.style.left = `${rock.body.position.x}px`;
    rock.element.style.top = `${rock.body.position.y}px`;
    rock.element.style.transform =
      `translate(-50%, -50%) rotate(${rock.body.angle}rad) scale(${rock.scale})`;
  };

  const rebuildStatics = () => {
    for (const body of state.statics) {
      Composite.remove(engine.world, body);
    }

    state.statics = [];

    const worldRect = worldElement.getBoundingClientRect();
    const groundRect = groundElement.getBoundingClientRect();
    const mountainRect = mountainElement.getBoundingClientRect();
    const groundTop = groundRect.top - worldRect.top;
    const mountainBaseX = mountainRect.left - worldRect.left + mountainRect.width * 0.76;

    const groundBody = Bodies.rectangle(
      worldElement.offsetWidth / 2,
      groundTop + 18,
      worldElement.offsetWidth + 400,
      36,
      {
        isStatic: true,
        friction: 0.88,
        restitution: 0.08,
      },
    );

    const settlingSlope = Bodies.rectangle(
      mountainBaseX + 92,
      groundTop - 18,
      220,
      20,
      {
        isStatic: true,
        angle: -0.09,
        friction: 0.94,
        restitution: 0.04,
      },
    );

    const settlingBackstop = Bodies.rectangle(
      mountainBaseX + 198,
      groundTop - 58,
      18,
      120,
      {
        isStatic: true,
        friction: 0.9,
        restitution: 0.04,
      },
    );

    state.statics = [groundBody, settlingSlope, settlingBackstop];
    Composite.add(engine.world, state.statics);
  };

  const spawnRock = ({ x, y }) => {
    const radius = randomBetween(15, 22);
    const scale = randomBetween(0.92, 1.16);
    const body = Bodies.circle(x, y, radius, {
      restitution: 0.18,
      friction: 0.72,
      frictionAir: 0.018,
      density: 0.0026,
      sleepThreshold: 30,
      slop: 0.08,
    });

    const element = document.createElement("span");
    element.className = "ore-rock-drop";

    const sprite = document.createElement("img");
    sprite.className = "ore-rock-drop__sprite";
    sprite.src = pickTexture();
    sprite.alt = "";
    sprite.decoding = "async";
    sprite.draggable = false;

    element.append(sprite);
    rockLayer.append(element);

    Body.setVelocity(body, {
      x: randomBetween(3.4, 5.1),
      y: randomBetween(-4.2, -2.8),
    });
    Body.setAngularVelocity(body, randomBetween(-0.08, 0.08));

    const rock = {
      body,
      element,
      sprite,
      radius,
      scale,
      spawnedAt: performance.now(),
    };

    state.rocks.push(rock);
    Composite.add(engine.world, body);
    syncRock(rock);
    recycleSleepingRocks();
  };

  const tick = (now) => {
    const delta = Math.min(32, now - state.lastNow || FIXED_DT);
    state.lastNow = now;
    Engine.update(engine, delta);

    for (const rock of state.rocks) {
      syncRock(rock);
    }

    state.rafId = requestAnimationFrame(tick);
  };

  rebuildStatics();
  state.rafId = requestAnimationFrame(tick);

  return {
    spawnRock,
    refresh() {
      rebuildStatics();
    },
    destroy() {
      cancelAnimationFrame(state.rafId);
      for (const rock of [...state.rocks]) {
        removeRock(rock);
      }
      for (const body of state.statics) {
        Composite.remove(engine.world, body);
      }
      rockLayer.remove();
    },
  };
};
