const ROCK_TEXTURE = new URL("./assets/rocks/source/ore-pebble.png", import.meta.url).href;

const FIXED_DT = 1000 / 60;
const DEFAULT_MAX_ROCKS = 100;
const WORLD_STATE_BY_ELEMENT = new WeakMap();

const GROUND_BODY_WIDTH_MARGIN = 400;
const GROUND_BODY_HEIGHT = 36;
const GROUND_BODY_VERTICAL_OFFSET = 18;
const SETTLING_SLOPE_WIDTH = 156;
const SETTLING_SLOPE_HEIGHT = 10;
const SETTLING_SLOPE_OFFSET_X = 72;
const SETTLING_SLOPE_OFFSET_Y = 5;
const SETTLING_SLOPE_ANGLE = 0.08;
const MOUNTAIN_BASE_RATIO = 0.83;
const INITIAL_RISE_X_SPEED_MIN = 2.7;
const INITIAL_RISE_X_SPEED_MAX = 4.1;
const INITIAL_RISE_Y_SPEED_MIN = -4.5;
const INITIAL_RISE_Y_SPEED_MAX = -3.1;
const INITIAL_ANGULAR_VELOCITY_MIN = -0.05;
const INITIAL_ANGULAR_VELOCITY_MAX = 0.05;
const ROCK_RESTITUTION = 0.18;
const ROCK_FRICTION = 0.72;
const ROCK_FRICTION_AIR = 0.01;
const ROCK_DENSITY = 0.0023;
const ROCK_SLEEP_THRESHOLD = 90;
const ROCK_SLOP = 0.08;
const ROCK_WIDTH_MIN = 18;
const ROCK_WIDTH_MAX = 26;
const ROCK_HEIGHT_MIN = 12;
const ROCK_HEIGHT_MAX = 18;
const ROCK_SCALE_MIN = 0.78;
const ROCK_SCALE_MAX = 0.92;
const ROCK_SPAWN_OFFSET_X = 8;
const ROCK_SPAWN_OFFSET_Y = -10;
const ROCK_SPAWN_CLEARANCE_TRIES = 8;
const ROCK_SPAWN_CLEARANCE_STEP_X = 3;
const ROCK_SPAWN_CLEARANCE_STEP_Y = 10;
const STATIC_FRICTION = 0.88;
const STATIC_RESTITUTION = 0.08;
const SLOPE_FRICTION = 0.94;
const SLOPE_RESTITUTION = 0.04;
const randomBetween = (min, max) => min + Math.random() * (max - min);

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

  const { Engine, Bodies, Body, Composite, Query } = MatterApi;
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.1;

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
    groundTop: 0,
    rafId: 0,
    lastNow: performance.now(),
    accumulator: 0,
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

    rock.element.style.width = `${rock.width}px`;
    rock.element.style.height = `${rock.height}px`;
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

    state.statics = [groundBody, settlingSlope];
    state.groundTop = groundTop;
    Composite.add(engine.world, state.statics);
  };

  const spawnRock = ({ x, y }) => {
    if (state.destroyed) {
      return;
    }

    const width = randomBetween(ROCK_WIDTH_MIN, ROCK_WIDTH_MAX);
    const height = randomBetween(ROCK_HEIGHT_MIN, ROCK_HEIGHT_MAX);
    const scale = randomBetween(ROCK_SCALE_MIN, ROCK_SCALE_MAX);
    const body = Bodies.rectangle(x, y, width, height, {
      restitution: ROCK_RESTITUTION,
      friction: ROCK_FRICTION,
      frictionAir: ROCK_FRICTION_AIR,
      density: ROCK_DENSITY,
      sleepThreshold: ROCK_SLEEP_THRESHOLD,
      slop: ROCK_SLOP,
      chamfer: {
        radius: Math.min(width, height) * 0.46,
      },
    });
    const obstacles = [
      ...state.statics,
      ...state.rocks.map((rock) => rock.body),
    ];
    let spawnX = x + ROCK_SPAWN_OFFSET_X;
    let spawnY = y + ROCK_SPAWN_OFFSET_Y;

    for (let attempt = 0; attempt < ROCK_SPAWN_CLEARANCE_TRIES; attempt += 1) {
      Body.setPosition(body, { x: spawnX, y: spawnY });
      if (Query.collides(body, obstacles).length === 0) {
        break;
      }

      spawnX += ROCK_SPAWN_CLEARANCE_STEP_X;
      spawnY -= Math.max(ROCK_SPAWN_CLEARANCE_STEP_Y, height * 0.72);
    }

    const element = document.createElement("span");
    element.className = "ore-rock-drop";

    const sprite = document.createElement("img");
    sprite.className = "ore-rock-drop__sprite";
    sprite.src = ROCK_TEXTURE;
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
      width,
      height,
      scale,
      spawnedAt: performance.now(),
    };

    state.rocks.push(rock);
    Composite.add(engine.world, body);
    syncRock(rock);
    recycleSleepingRocks();
  };

  const pickupRock = ({ x } = {}) => {
    if (state.destroyed || state.rocks.length === 0) {
      return false;
    }

    const groundedRocks = state.rocks.filter(
      (rock) =>
        rock.body.isSleeping
        || rock.body.position.y >= state.groundTop - 42,
    );
    const candidates = groundedRocks.length > 0 ? groundedRocks : state.rocks;
    const targetX = Number.isFinite(x) ? x : null;
    const [rockToRemove] = [...candidates].sort((left, right) => {
      const leftDistanceX = targetX === null ? 0 : Math.abs(left.body.position.x - targetX);
      const rightDistanceX = targetX === null ? 0 : Math.abs(right.body.position.x - targetX);
      const leftDistanceY = Math.abs(left.body.position.y - state.groundTop);
      const rightDistanceY = Math.abs(right.body.position.y - state.groundTop);
      const leftScore = leftDistanceX * 1.1 + leftDistanceY - (left.body.isSleeping ? 18 : 0);
      const rightScore = rightDistanceX * 1.1 + rightDistanceY - (right.body.isSleeping ? 18 : 0);
      return leftScore - rightScore;
    });

    if (!rockToRemove) {
      return false;
    }

    removeRock(rockToRemove);
    return true;
  };

  const tick = (now) => {
    if (state.destroyed) {
      return;
    }

    const delta = Math.min(48, now - state.lastNow || FIXED_DT);
    state.lastNow = now;
    state.accumulator += delta;

    while (state.accumulator >= FIXED_DT) {
      Engine.update(engine, FIXED_DT);
      state.accumulator -= FIXED_DT;
    }

    for (const rock of state.rocks) {
      syncRock(rock);
    }

    state.rafId = requestAnimationFrame(tick);
  };

  rebuildStatics();
  const controls = {
    spawnRock,
    pickupRock,
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
