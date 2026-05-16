# GAME DECK Rock Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scripted rock drops in `GAME DECK` with Matter.js-driven rock sprites that collide, roll, lightly bounce, rotate, sleep, and pile near a mountain that is 60% taller.

**Architecture:** Keep the page as DOM-rendered HTML/CSS/ESM. Load a vendored local Matter.js browser build, simulate rocks in a dedicated `rock-physics.mjs` module, and sync rigid-body state onto absolute-positioned sprite elements in a dedicated rock layer. The existing page module stays responsible for mining state, tooltip behavior, search, return navigation, and horizontal dragging.

**Tech Stack:** Manifest V3 extension page, native ES modules, local vendored Matter.js browser build, DOM/CSS transforms, Playwright smoke verifier

---

## File Structure

**Create:**
- `src/pages/game/vendor/matter.min.js` — vendored official browser build of Matter.js
- `src/pages/game/rock-physics.mjs` — physics world setup, spawn API, DOM sync, cleanup, sleeping-aware recycling
- `docs/superpowers/plans/2026-05-16-game-deck-rock-physics.md` — this implementation plan

**Modify:**
- `src/pages/game/index.html` — add the rock layer and load the local Matter.js script before the module entry
- `src/pages/game/index.css` — enlarge the mountain, add sprite-rock presentation, and keep pointer behavior scoped
- `src/pages/game/index.mjs` — replace the scripted landed-rock path with physics integration
- `.tmp/verify_newtab_extension.py` — add smoke checks for the taller mountain, sprite rocks, and pile behavior

**Git convention:** all commit messages in this task use Chinese.

---

### Task 1: Add Failing Smoke Coverage For The New Rock Scene

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add new result keys for the sprite-physics checks**

In the `result = { ... }` block, add these fields next to the existing `game_deck_ore_*` entries:

```python
        "game_deck_ore_mountain_taller": False,
        "game_deck_ore_rocks_use_images": False,
        "game_deck_ore_rocks_pile_near_base": False,
        "game_deck_ore_rocks_do_not_overlap_visibly": False,
```

- [ ] **Step 2: Add exact page checks that should fail before implementation**

After the existing `game_deck_ore_stage_changes_as_resource_drops` check block, add these verifier snippets:

```python
                result["game_deck_ore_mountain_taller"] = page.evaluate(
                    """() => {
                        const mountain = document.querySelector('.ore-mountain');
                        const rect = mountain?.getBoundingClientRect();
                        if (!rect) {
                            return false;
                        }

                        return rect.height >= 220 && rect.width >= 340;
                    }"""
                )

                result["game_deck_ore_rocks_use_images"] = page.evaluate(
                    """() => {
                        const sprite = document.querySelector('.ore-rock-drop__sprite');
                        if (!(sprite instanceof HTMLImageElement)) {
                            return false;
                        }

                        return sprite.currentSrc.includes('ore-pebble-')
                            && sprite.naturalWidth > 0
                            && sprite.naturalHeight > 0;
                    }"""
                )

                result["game_deck_ore_rocks_pile_near_base"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const ground = document.querySelector('.game-ground-line');
                        if (!mountain || !target || !ground) {
                            return false;
                        }

                        const rect = target.getBoundingClientRect();
                        for (let index = 0; index < 8; index += 1) {
                            target.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                clientX: rect.left + rect.width * 0.58,
                                clientY: rect.top + rect.height * 0.44,
                            }));
                            await new Promise((resolve) => setTimeout(resolve, 60));
                        }

                        await new Promise((resolve) => setTimeout(resolve, 2200));

                        const groundRect = ground.getBoundingClientRect();
                        const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                        if (rocks.length < 6) {
                            return false;
                        }

                        const settled = rocks.filter((rock) => {
                            const rockRect = rock.getBoundingClientRect();
                            const centerY = rockRect.top + rockRect.height / 2;
                            return Math.abs(centerY - groundRect.top) <= 42;
                        });

                        const xs = settled.map((rock) => rock.getBoundingClientRect().left);
                        const spread = Math.max(...xs) - Math.min(...xs);
                        return settled.length >= 5 && spread <= 240;
                    }"""
                )

                result["game_deck_ore_rocks_do_not_overlap_visibly"] = page.evaluate(
                    """() => {
                        const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                        if (rocks.length < 4) {
                            return false;
                        }

                        for (let i = 0; i < rocks.length; i += 1) {
                            const rectA = rocks[i].getBoundingClientRect();
                            const ax = rectA.left + rectA.width / 2;
                            const ay = rectA.top + rectA.height / 2;
                            const radiusA = Math.min(rectA.width, rectA.height) / 2;

                            for (let j = i + 1; j < rocks.length; j += 1) {
                                const rectB = rocks[j].getBoundingClientRect();
                                const bx = rectB.left + rectB.width / 2;
                                const by = rectB.top + rectB.height / 2;
                                const radiusB = Math.min(rectB.width, rectB.height) / 2;
                                const distance = Math.hypot(ax - bx, ay - by);
                                if (distance < Math.min(radiusA, radiusB) * 0.66) {
                                    return false;
                                }
                            }
                        }

                        return true;
                    }"""
                )
```

Add the corresponding assertions near the current ore assertions:

```python
                assert result["game_deck_ore_mountain_taller"], "expected ore mountain to be about 60% taller than the current version"
                assert result["game_deck_ore_rocks_use_images"], "expected dropped rocks to use ore sprite images"
                assert result["game_deck_ore_rocks_pile_near_base"], "expected dropped rocks to settle into a compact pile near the mountain base"
                assert result["game_deck_ore_rocks_do_not_overlap_visibly"], "expected piled rocks not to visually pass through each other"
```

- [ ] **Step 3: Run the verifier and confirm RED**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected: FAIL with the new image-sprite or taller-mountain assertion because the current implementation still uses outline-only rock drops and the shorter mountain.

---

### Task 2: Vendor Matter.js And Create The Physics Module

**Files:**
- Create: `src/pages/game/vendor/matter.min.js`
- Create: `src/pages/game/rock-physics.mjs`

- [ ] **Step 1: Vendor the official browser build locally**

Run:

```powershell
New-Item -ItemType Directory -Force src\pages\game\vendor | Out-Null
Invoke-WebRequest https://brm.io/matter-js/build/matter.min.js -OutFile src\pages\game\vendor\matter.min.js
```

Expected: `src/pages/game/vendor/matter.min.js` exists and is non-empty.

- [ ] **Step 2: Create the dedicated physics module**

Create `src/pages/game/rock-physics.mjs` with this implementation:

```js
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
```

- [ ] **Step 3: Check the new module syntax**

Run:

```powershell
node --check src/pages/game/rock-physics.mjs
```

Expected: exits with code `0`.

- [ ] **Step 4: Commit the vendored runtime and physics module**

Run:

```powershell
git add src/pages/game/vendor/matter.min.js src/pages/game/rock-physics.mjs
git commit -m "功能：引入落石物理模块"
```

Expected: commit succeeds with a Chinese message.

---

### Task 3: Raise The Mountain And Add The Sprite Rock Layer

**Files:**
- Modify: `src/pages/game/index.html`
- Modify: `src/pages/game/index.css`

- [ ] **Step 1: Update the scene markup to load Matter.js and expose the rock layer**

In `src/pages/game/index.html`, change the game-world block and closing scripts to:

```html
      <section class="game-scene" aria-label="游戏场景">
        <div class="game-world">
          <div class="game-ground-line" aria-hidden="true"></div>
          <div class="ore-rock-layer" aria-hidden="true"></div>
          <button
            class="ore-mountain"
            type="button"
            data-ore="100"
            data-stage="5"
            aria-label="采集石山，剩余 100"
          >
            <span class="ore-mountain__tooltip" aria-hidden="true">100</span>
            <svg class="ore-mountain__art" viewBox="0 0 420 290" aria-hidden="true">
              <path
                class="ore-mountain__hitbox ore-mountain__hitbox--5"
                d="M20 286C48 272 82 258 122 253C160 248 190 236 213 210C231 190 246 164 260 146C279 145 299 159 320 183C342 208 367 220 390 220C404 220 414 240 420 286L420 286L20 286Z"
              />
              <path
                class="ore-mountain__hitbox ore-mountain__hitbox--4"
                d="M26 286C54 274 88 264 128 260C163 257 193 246 216 224C234 207 249 185 262 171C280 172 299 184 319 203C339 221 361 232 384 236C398 239 410 252 418 286L418 286L26 286Z"
              />
              <path
                class="ore-mountain__hitbox ore-mountain__hitbox--3"
                d="M34 286C64 277 97 270 136 268C171 266 200 258 223 241C242 228 257 211 270 199C286 201 302 210 320 224C340 239 360 249 381 254C396 258 408 266 416 286L416 286L34 286Z"
              />
              <path
                class="ore-mountain__hitbox ore-mountain__hitbox--2"
                d="M44 286C76 281 110 278 148 277C181 276 210 271 235 261C256 253 273 242 288 236C304 238 320 246 338 255C356 264 376 272 396 277C404 279 411 282 416 286L416 286L44 286Z"
              />
              <path
                class="ore-mountain__hitbox ore-mountain__hitbox--1"
                d="M58 286C92 283 127 281 164 280C197 279 229 277 261 274C292 271 323 273 354 277C384 280 405 282 418 286L418 286L58 286Z"
              />
              <path
                class="ore-mountain__shape ore-mountain__shape--5"
                d="M20 286C48 272 82 258 122 253C160 248 190 236 213 210C231 190 246 164 260 146C279 145 299 159 320 183C342 208 367 220 390 220C404 220 414 240 420 286"
              />
              <path
                class="ore-mountain__shape ore-mountain__shape--4"
                d="M26 286C54 274 88 264 128 260C163 257 193 246 216 224C234 207 249 185 262 171C280 172 299 184 319 203C339 221 361 232 384 236C398 239 410 252 418 286"
              />
              <path
                class="ore-mountain__shape ore-mountain__shape--3"
                d="M34 286C64 277 97 270 136 268C171 266 200 258 223 241C242 228 257 211 270 199C286 201 302 210 320 224C340 239 360 249 381 254C396 258 408 266 416 286"
              />
              <path
                class="ore-mountain__shape ore-mountain__shape--2"
                d="M44 286C76 281 110 278 148 277C181 276 210 271 235 261C256 253 273 242 288 236C304 238 320 246 338 255C356 264 376 272 396 277C404 279 411 282 416 286"
              />
              <path
                class="ore-mountain__shape ore-mountain__shape--1"
                d="M58 286C92 283 127 281 164 280C197 279 229 277 261 274C292 271 323 273 354 277C384 280 405 282 418 286"
              />
            </svg>
          </button>
        </div>
      </section>
    </main>
    <script src="./vendor/matter.min.js"></script>
    <script type="module" src="./index.mjs"></script>
```

- [ ] **Step 2: Replace the old circle-rock styling with sprite-rock styling and a bigger mountain**

In `src/pages/game/index.css`, replace the current mountain and rock blocks with:

```css
.ore-mountain {
  position: absolute;
  left: clamp(124px, 14vw, 244px);
  bottom: calc(2cm + 3px);
  width: clamp(360px, 32vw, 460px);
  padding: 0;
  border: 0;
  background: transparent;
  color: #000;
  cursor: crosshair;
  appearance: none;
  transform-origin: 50% 100%;
  touch-action: manipulation;
  pointer-events: none;
}

.ore-mountain__art {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.ore-rock-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ore-rock-drop {
  position: absolute;
  left: 0;
  top: 0;
  width: 40px;
  height: 40px;
  pointer-events: none;
  transform: translate(-50%, -50%);
  will-change: left, top, transform;
}

.ore-rock-drop__sprite {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  filter: none;
}

@media (max-width: 820px) {
  .ore-mountain {
    left: 92px;
    width: min(72vw, 360px);
  }
}
```

Keep the existing tooltip and hitbox rules. Delete the old `border-radius` outline-only `.ore-rock-drop` styling block so the sprite image is the only visible rock representation.

- [ ] **Step 3: Confirm the markup and CSS changed in the expected places**

Run:

```powershell
rg -n "ore-rock-layer|ore-rock-drop__sprite|vendor/matter.min.js|viewBox=\"0 0 420 290\"" src/pages/game/index.html src/pages/game/index.css
```

Expected: matches for all four strings.

- [ ] **Step 4: Commit the taller mountain and sprite layer**

Run:

```powershell
git add src/pages/game/index.html src/pages/game/index.css
git commit -m "样式：抬高石山并接入落石贴图"
```

Expected: commit succeeds with a Chinese message.

---

### Task 4: Integrate Mining Logic With The Physics Module

**Files:**
- Modify: `src/pages/game/index.mjs`

- [ ] **Step 1: Import and initialize the physics layer**

At the top of `src/pages/game/index.mjs`, add this import:

```js
import { createRockPhysics } from "./rock-physics.mjs";
```

Then replace the old scripted rock-drop path with this integration:

```js
let rockPhysics = null;

const initializeRockPhysics = () => {
  if (rockPhysics || !(gameWorld instanceof HTMLElement) || !(groundLine instanceof HTMLElement) || !(oreMountain instanceof HTMLButtonElement)) {
    return;
  }

  try {
    rockPhysics = createRockPhysics({
      worldElement: gameWorld,
      groundElement: groundLine,
      mountainElement: oreMountain,
      maxRocks: 100,
    });
  } catch (error) {
    console.warn("Failed to initialize rock physics", error);
  }
};

const refreshRockPhysics = () => {
  rockPhysics?.refresh();
};
```

- [ ] **Step 2: Remove the old scripted `spawnRockDrop` implementation and route mining into Matter.js**

Delete the entire old `spawnRockDrop` function. In the mining handler inside `setupOreMountain`, replace the old call with:

```js
    if (!rockPhysics) {
      initializeRockPhysics();
    }

    rockPhysics?.spawnRock({
      x: point.x,
      y: point.y,
    });
```

Also add these lifecycle hooks near the existing `startButton` and setup code:

```js
startButton?.addEventListener("click", () => {
  document.body.dataset.gameState = "playing";
  if (gameStateLabel instanceof HTMLElement) {
    gameStateLabel.textContent = "PLAYING";
  }

  initializeRockPhysics();
  window.requestAnimationFrame(refreshRockPhysics);
});

window.addEventListener("resize", () => {
  window.requestAnimationFrame(refreshRockPhysics);
});
```

- [ ] **Step 3: Verify the game module syntax**

Run:

```powershell
node --check src/pages/game/index.mjs
node --check src/pages/game/rock-physics.mjs
```

Expected: both commands exit with code `0`.

- [ ] **Step 4: Run the full smoke verifier and make it GREEN**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected: exits with code `0`, and the new rock checks all report `true`.

- [ ] **Step 5: Commit the integrated behavior**

Run:

```powershell
git add src/pages/game/index.mjs .tmp/verify_newtab_extension.py
git commit -m "功能：接入石头碰撞与滚动表现"
```

Expected: commit succeeds with a Chinese message.

---

### Task 5: Final Scope And Stability Review

**Files:**
- Inspect: `src/pages/game/index.html`
- Inspect: `src/pages/game/index.css`
- Inspect: `src/pages/game/index.mjs`
- Inspect: `src/pages/game/rock-physics.mjs`
- Inspect: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Check that no out-of-scope mechanics leaked in**

Run:

```powershell
rg "pickup|inventory|craft|背包|拾取|合成|deform|terrain" src/pages/game .tmp/verify_newtab_extension.py
```

Expected: no matches.

- [ ] **Step 2: Check the repo status without touching unrelated work**

Run:

```powershell
git status --short
```

Expected: only the intended game-page, verifier, vendor, and doc files are changed by this feature; unrelated pre-existing dirty files may still appear and must not be reverted.

- [ ] **Step 3: Make the final verification commit**

Run:

```powershell
git add docs/superpowers/plans/2026-05-16-game-deck-rock-physics.md
git commit -m "文档：补充落石物理实施计划"
```

Expected: commit succeeds with a Chinese message.

---

## Self-Review

Spec coverage:

- Matter.js local vendoring: Task 2.
- DOM-rendered sprite rocks with physics sync: Tasks 2, 3, and 4.
- Mountain height +60% and wider rounded silhouette: Task 3.
- Collision, roll, light bounce, rotation, sleep: Task 2.
- Pile concentrated near the mountain base: Task 2 plus the verifier checks in Task 1.
- Existing mining interaction preserved and still silhouette-bound: Task 4.
- Smoke coverage for images, pile shape, and overlap behavior: Task 1, verified in Task 4.

Placeholder scan:

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Commit messages are specified and all are in Chinese, per user preference.

Type consistency:

- The integration API is consistently named `createRockPhysics`, with returned methods `spawnRock`, `refresh`, and `destroy`.
- The sprite selector is consistently `.ore-rock-drop__sprite`.
- The vendored browser build path is consistently `src/pages/game/vendor/matter.min.js`.
