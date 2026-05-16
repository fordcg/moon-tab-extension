const ROCK_TEXTURES = [
  new URL("./assets/rocks/source/ore-pebble-01.png", import.meta.url).href,
  new URL("./assets/rocks/source/ore-pebble-02.png", import.meta.url).href,
  new URL("./assets/rocks/source/ore-pebble-03.png", import.meta.url).href,
];

const FIXED_DT = 1000 / 60;
const DEFAULT_MAX_ROCKS = 100;
const WORLD_STATE_BY_ELEMENT = new WeakMap();

const GROUND_BODY_WIDTH_MARGIN = 400;
const GROUND_BODY_HEIGHT = 36;
const GROUND_BODY_VERTICAL_OFFSET = 18;
const SETTLING_SLOPE_WIDTH = 220;
const SETTLING_SLOPE_HEIGHT = 20;
const SETTLING_SLOPE_OFFSET_X = 92;
const SETTLING_SLOPE_OFFSET_Y = -18;
const SETTLING_SLOPE_ANGLE = -0.09;
const SETTLING_BACKSTOP_WIDTH = 18;
const SETTLING_BACKSTOP_HEIGHT = 120;
const SETTLING_BACKSTOP_OFFSET_X = 198;
const SETTLING_BACKSTOP_OFFSET_Y = -58;
const MOUNTAIN_BASE_RATIO = 0.76;
const INITIAL_RISE_X_SPEED_MIN = 3.4;
const INITIAL_RISE_X_SPEED_MAX = 5.1;
const INITIAL_RISE_Y_SPEED_MIN = -4.2;
const INITIAL_RISE_Y_SPEED_MAX = -2.8;
const INITIAL_ANGULAR_VELOCITY_MIN = -0.08;
const INITIAL_ANGULAR_VELOCITY_MAX = 0.08;
const ROCK_RESTITUTION = 0.18;
const ROCK_FRICTION = 0.72;
const ROCK_FRICTION_AIR = 0.018;
const ROCK_DENSITY = 0.0026;
const ROCK_SLEEP_THRESHOLD = 30;
const ROCK_SLOP = 0.08;
const ROCK_RADIUS_MIN = 15;
const ROCK_RADIUS_MAX = 22;
const ROCK_SCALE_MIN = 0.92;
const ROCK_SCALE_MAX = 1.16;
const STATIC_FRICTION = 0.88;
const STATIC_RESTITUTION = 0.08;
const SLOPE_FRICTION = 0.94;
const SLOPE_RESTITUTION = 0.04;
const BACKSTOP_FRICTION = 0.9;
const BACKSTOP_RESTITUTION = 0.04;

const randomBetween = (min, max) => min + Math.random() * (max - min);

const pickTexture = () =>
  ROCK_TEXTURES[Math.floor(Math.random() * ROCK_TEXTURES.length)];

export const createRockPhysics = ({
  worldElement,
  groundElement,
  mountainElement,
  maxRocks = DEFAULT_MAX_ROCKS,
}) => {
  const MatterApi = globalThis.Matter;

  if (!MatterApi) {
    throw new Error("Matter.js is not available on globalThis");
  }

  if (!(worldElement instanceof HTMLElement)) {
    throw new Error("worldElement is required");
  }

  if (!(groundElement instanceof HTMLElement)) {
    throw new Error("groundElement is required");
  }

  if (!(mountainElement instanceof HTMLElement)) {
    throw new Error("mountainElement is required");
  }

  const existingState = WORLD_STATE_BY_ELEMENT.get(worldElement);
  if (existingState && !existingState.destroyed) {
    return existingState.controls;
  }

  const { Engine, Bodies, Body, Composite } = MatterApi;
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.04;

  const rockLayer =
    worldElement.querySelector(":scope > .ore-rock-layer") ??
    document.createElement("div");
  const ownsRockLayer = !rockLayer.isConnected;

  if (!(rockLayer instanceof HTMLElement)) {
    throw new Error("rock layer could not be created");
  }

  if (ownsRockLayer) {
    rockLayer.className = "ore-rock-layer";
    rockLayer.setAttribute("aria-hidden", "true");
    worldElement.append(rockLayer);
  }

  const state = {
    rockLayer,
    engine,
    rocks: [],
    statics: [],
    rafId: 0,
    lastNow: performance.now(),
    destroyed: false,
    controls: null,
  };

  WORLD_STATE_BY_ELEMENT.set(worldElement, state);

  const removeRock = (rock) => {
    Composite.remove(engine.world, rock.body);
    if (rock.element.isConnected) {
      rock.element.remove();
    }
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
    if (!rock.element.isConnected) {
      return;
    }

    const size = rock.radius * 2;
    rock.element.style.width = `${size}px`;
    rock.element.style.height = `${size}px`;
    rock.element.style.left = `${rock.body.position.x}px`;
    rock.element.style.top = `${rock.body.position.y}px`;
    rock.element.style.transform =
      `translate(-50%, -50%) rotate(${rock.body.angle}rad) scale(${rock.scale})`;
  };

  const rebuildStatics = () => {
    if (state.destroyed) {
      return;
    }

    for (const body of state.statics) {
      Composite.remove(engine.world, body);
    }

    state.statics = [];

    const worldRect = worldElement.getBoundingClientRect();
    const groundRect = groundElement.getBoundingClientRect();
    const mountainRect = mountainElement.getBoundingClientRect();
    const groundTop = groundRect.top - worldRect.top;
    const mountainBaseX =
      mountainRect.left - worldRect.left + mountainRect.width * MOUNTAIN_BASE_RATIO;

    const groundBody = Bodies.rectangle(
      worldElement.offsetWidth / 2,
      groundTop + GROUND_BODY_VERTICAL_OFFSET,
      worldElement.offsetWidth + GROUND_BODY_WIDTH_MARGIN,
      GROUND_BODY_HEIGHT,
      {
        isStatic: true,
        friction: STATIC_FRICTION,
        restitution: STATIC_RESTITUTION,
      },
    );

    const settlingSlope = Bodies.rectangle(
      mountainBaseX + SETTLING_SLOPE_OFFSET_X,
      groundTop + SETTLING_SLOPE_OFFSET_Y,
      SETTLING_SLOPE_WIDTH,
      SETTLING_SLOPE_HEIGHT,
      {
        isStatic: true,
        angle: SETTLING_SLOPE_ANGLE,
        friction: SLOPE_FRICTION,
        restitution: SLOPE_RESTITUTION,
      },
    );

    const settlingBackstop = Bodies.rectangle(
      mountainBaseX + SETTLING_BACKSTOP_OFFSET_X,
      groundTop + SETTLING_BACKSTOP_OFFSET_Y,
      SETTLING_BACKSTOP_WIDTH,
      SETTLING_BACKSTOP_HEIGHT,
      {
        isStatic: true,
        friction: BACKSTOP_FRICTION,
        restitution: BACKSTOP_RESTITUTION,
      },
    );

    state.statics = [groundBody, settlingSlope, settlingBackstop];
    Composite.add(engine.world, state.statics);
  };

  const spawnRock = ({ x, y }) => {
    if (state.destroyed) {
      return;
    }

    const radius = randomBetween(ROCK_RADIUS_MIN, ROCK_RADIUS_MAX);
    const scale = randomBetween(ROCK_SCALE_MIN, ROCK_SCALE_MAX);
    const body = Bodies.circle(x, y, radius, {
      restitution: ROCK_RESTITUTION,
      friction: ROCK_FRICTION,
      frictionAir: ROCK_FRICTION_AIR,
      density: ROCK_DENSITY,
      sleepThreshold: ROCK_SLEEP_THRESHOLD,
      slop: ROCK_SLOP,
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
      x: randomBetween(INITIAL_RISE_X_SPEED_MIN, INITIAL_RISE_X_SPEED_MAX),
      y: randomBetween(INITIAL_RISE_Y_SPEED_MIN, INITIAL_RISE_Y_SPEED_MAX),
    });
    Body.setAngularVelocity(
      body,
      randomBetween(INITIAL_ANGULAR_VELOCITY_MIN, INITIAL_ANGULAR_VELOCITY_MAX),
    );

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
    if (state.destroyed) {
      return;
    }

    const delta = Math.min(32, now - state.lastNow || FIXED_DT);
    state.lastNow = now;
    Engine.update(engine, delta);

    for (const rock of state.rocks) {
      syncRock(rock);
    }

    state.rafId = requestAnimationFrame(tick);
  };

  rebuildStatics();
  const controls = {
    spawnRock,
    refresh() {
      if (state.destroyed) {
        return;
      }

      rebuildStatics();
    },
    destroy() {
      if (state.destroyed) {
        return;
      }

      state.destroyed = true;
      cancelAnimationFrame(state.rafId);
      for (const rock of [...state.rocks]) {
        removeRock(rock);
      }
      for (const body of state.statics) {
        Composite.remove(engine.world, body);
      }
      if (state.rockLayer.isConnected) {
        state.rockLayer.replaceChildren();
      }
      if (ownsRockLayer && rockLayer.isConnected) {
        rockLayer.remove();
      }
      WORLD_STATE_BY_ELEMENT.delete(worldElement);
    },
  };

  state.controls = controls;
  state.rafId = requestAnimationFrame(tick);

  return controls;
};
