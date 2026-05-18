import test from "node:test";
import assert from "node:assert/strict";

class FakeHTMLElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.isConnected = false;
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      node.isConnected = true;
      this.children.push(node);
    }
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }

    this.parentNode = null;
    this.isConnected = false;
  }

  set innerHTML(value) {
    this._innerHTML = value;
  }

  get innerHTML() {
    return this._innerHTML ?? "";
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

const createRectElement = (rect) => {
  const element = new FakeHTMLElement();
  element.rect = rect;
  return element;
};

const createRafHarness = () => {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();

  return {
    performance: {
      now: () => now,
    },
    window: {
      requestAnimationFrame(callback) {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        callbacks.delete(id);
      },
    },
    step(milliseconds) {
      now += milliseconds;
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) {
        callback(now);
      }
    },
    flushFrames(count, millisecondsPerFrame = 1000 / 60) {
      for (let index = 0; index < count; index += 1) {
        this.step(millisecondsPerFrame);
      }
    },
  };
};

const setupWorkerWorld = async () => {
  const previousHTMLElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousPerformance = globalThis.performance;

  const raf = createRafHarness();
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.document = {
    createElement: (tagName) => new FakeHTMLElement(tagName),
  };
  globalThis.window = raf.window;
  globalThis.performance = raf.performance;

  const { createWorkerSimulation } = await import(`./workers.mjs?test=${Date.now()}-${Math.random()}`);

  const cleanup = () => {
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.performance = previousPerformance;
  };

  const layerElement = new FakeHTMLElement();
  const worldElement = createRectElement({ left: 0, top: 0, width: 1200, height: 600 });
  const groundElement = createRectElement({ left: 0, top: 520, width: 1200, height: 3 });
  const mountainElement = createRectElement({ left: 120, top: 180, width: 420, height: 260 });
  const pileElement = createRectElement({ left: 640, top: 452, width: 72, height: 64 });
  const storageElement = createRectElement({ left: 920, top: 438, width: 90, height: 78 });

  return {
    cleanup,
    raf,
    createSimulation(options) {
      return createWorkerSimulation({
        layerElement,
        worldElement,
        groundElement,
        mountainElement,
        pileElement,
        storageElement,
        ...options,
      });
    },
    getWorker(role) {
      return layerElement.children.find((child) => child.dataset.role === role);
    },
  };
};

test("miner keeps mining at the mountain after a successful harvest", async () => {
  const world = await setupWorkerWorld();
  let oreRemaining = 5;
  let mineCalls = 0;

  const simulation = world.createSimulation({
    getOreRemaining: () => oreRemaining,
    getGroundOre: () => 0,
    mineMountain: () => {
      oreRemaining -= 1;
      mineCalls += 1;
      return true;
    },
    dropGroundOre: () => 0,
    pickupGroundOre: () => 0,
    storeOre: () => 0,
  });

  simulation.start();
  world.raf.flushFrames(80);

  const miner = world.getWorker("miner");
  assert.equal(mineCalls > 0, true);
  assert.equal(miner?.dataset.state, "mine");

  simulation.destroy();
  world.cleanup();
});

test("hauler pickup triggers visible ground-rock collection", async () => {
  const world = await setupWorkerWorld();
  let groundOre = 1;
  let visiblePickupCalls = 0;

  const simulation = world.createSimulation({
    getOreRemaining: () => 0,
    getGroundOre: () => groundOre,
    mineMountain: () => false,
    dropGroundOre: () => 0,
    pickupGroundOre: () => {
      if (groundOre <= 0) {
        return 0;
      }

      groundOre -= 1;
      return 1;
    },
    pickupGroundRock: () => {
      visiblePickupCalls += 1;
    },
    storeOre: () => 1,
  });

  simulation.start();
  world.raf.flushFrames(220);

  assert.equal(visiblePickupCalls, 1);

  simulation.destroy();
  world.cleanup();
});
