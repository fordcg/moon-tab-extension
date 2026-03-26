import * as THREE from "./vendor/three.module.js";

const MAX_DROPLETS = 24;
const MAX_ENTRIES = MAX_DROPLETS * 2;
const FIXED_DT_MS = 8;
const MAX_FRAME_DT_MS = 96;
const MAX_CATCHUP = 6;
const AUTO_SPAWN_INTERVAL_MS = 3600;
const AUTO_SPAWN_TARGET_COUNT = 5;
const DAMPING = 0.989;
const MAX_SPEED = 0.009;
const MOUSE_RADIUS = 0.14;
const MOUSE_FORCE = 0.0018;
const TENSION_RANGE = 0.12;
const TENSION_FORCE = 0.00024;
const MERGE_RATIO = 0.5;
const SPLIT_SPEED = 0.013;
const SPLIT_MIN_RADIUS = 0.04;
const BOUNCE = 0.25;
const WANDER_FORCE = 0.000015;
const CENTER_PULL = 0.000015;
const GHOST_TRAIL_STRENGTH = 1.45;
const GHOST_RADIUS_SCALE = 0.42;
const SOFT_STIFFNESS = 0.22;
const SOFT_DAMPING = 0.6;
const INITIAL_SEED_COUNT = 5;
const INITIAL_SEED_X_SPREAD = 0.55;
const INITIAL_SEED_Y_SPREAD = 0.38;
const INITIAL_SEED_BASE_RADIUS = 0.011;
const INITIAL_SEED_RANDOM_RADIUS = 0.012;
const AUTO_SPAWN_BASE_RADIUS = 0.008;
const AUTO_SPAWN_RANDOM_RADIUS = 0.005;
const POINTER_SPAWN_BASE_RADIUS = 0.007;
const POINTER_SPAWN_RANDOM_RADIUS = 0.004;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const createTinyRandomDrift = () => {
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.00015 + Math.random() * 0.00045;
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  };
};

const vertexShader = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;
#define MAX_N ${MAX_ENTRIES}

uniform vec2 uResolution;
uniform vec4 uDroplets[MAX_N];
uniform sampler2D uBackdrop;
uniform int uCount;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  float field = 0.0;
  vec2 gradient = vec2(0.0);
  vec2 lens = vec2(0.0);
  float lensWeight = 0.0;

  for (int i = 0; i < MAX_N; i++) {
    if (i >= uCount) {
      break;
    }

    vec4 d = uDroplets[i];
    vec2 center = d.xy;
    float radius = d.z;
    if (radius < 0.001) {
      continue;
    }

    vec2 delta = p - center;
    float distanceSquared = dot(delta, delta) + 0.00001;
    float contribution = radius * radius / distanceSquared;
    field += contribution;
    gradient += -2.0 * contribution / distanceSquared * delta;

    float w = radius * radius / (distanceSquared + radius * radius);
    lens += (center - p) * w;
    lensWeight += w;
  }

  lens /= (lensWeight + 0.001);
  float lensLength = length(lens);
  vec2 refractDir = lensLength > 0.00001 ? lens / lensLength : vec2(0.0);

  float threshold = 1.0;
  float edge = smoothstep(threshold - 0.08, threshold + 0.03, field);
  float bodyMask = smoothstep(threshold - 0.2, threshold + 1.5, field);

  float refractStrength = 0.022;
  float mappedLens = atan(lensLength * 6.0) * refractStrength;
  vec2 refractedUv = clamp(uv + refractDir * mappedLens * bodyMask, 0.001, 0.999);

  vec3 clean = texture2D(uBackdrop, uv).rgb;

  float chroma = 0.001 * edge;
  vec3 refracted;
  refracted.r = texture2D(uBackdrop, refractedUv + vec2(chroma, chroma * 0.5)).r;
  refracted.g = texture2D(uBackdrop, refractedUv).g;
  refracted.b = texture2D(uBackdrop, refractedUv - vec2(chroma, chroma * 0.5)).b;

  float gradLength = length(gradient);
  vec2 normalGradient = gradLength > 0.0001
    ? (gradient / gradLength) * (atan(gradLength * 0.44) * 0.22)
    : vec2(0.0);

  vec3 normal = normalize(vec3(-normalGradient, 1.0));
  vec3 light = normalize(vec3(0.3, 0.6, 1.0));
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(light + view);

  float diffuse = max(dot(normal, light), 0.0);
  float specular = pow(max(dot(normal, halfVector), 0.0), 140.0);
  float fresnel = 0.03 + 0.9 * pow(1.0 - max(dot(normal, view), 0.0), 4.0);
  float rim = smoothstep(threshold + 0.65, threshold - 0.03, field) * edge;

  float depth = smoothstep(threshold, threshold + 3.0, field);
  vec3 depthTint = mix(vec3(1.0), vec3(0.94, 0.97, 1.0), depth * 0.35);

  vec3 glass = refracted * depthTint * (0.92 + 0.08 * diffuse)
    + vec3(1.0) * specular * 0.62
    + vec3(0.9, 0.95, 1.0) * rim * 0.12
    + vec3(1.0) * fresnel * 0.06;

  float borderOuter = smoothstep(threshold - 0.09, threshold - 0.01, field);
  float borderInner = smoothstep(threshold + 0.0, threshold + 0.07, field);
  float border = borderOuter * (1.0 - borderInner) * 0.16;
  glass += vec3(1.0) * border;

  float shadowField = smoothstep(threshold - 0.35, threshold - 0.05, field);
  vec3 shadedClean = clean * (1.0 - shadowField * 0.05);

  vec3 color = mix(shadedClean, glass, edge);
  gl_FragColor = vec4(color, 1.0);
}
`;

const createDroplet = (config, restLift) => {
  const y = config.y + restLift;
  const drift = createTinyRandomDrift();
  return {
    x: config.x,
    y,
    vx: drift.vx,
    vy: drift.vy,
    r: config.r,
    area: Math.PI * config.r * config.r,
    baseRestX: config.x,
    baseRestY: config.y,
    restX: config.x,
    restY: y,
    softPrevX: config.x,
    softPrevY: y,
    softOffX: 0,
    softOffY: 0,
    softVelX: 0,
    softVelY: 0,
    age: Math.random() * 1000,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderSpeed: 0.3 + Math.random() * 0.5,
    alive: true,
  };
};

const initializeDroplets = (restLift = 0) => {
  const seedCount = Math.min(INITIAL_SEED_COUNT, MAX_DROPLETS);
  return Array.from({ length: seedCount }, () => createDroplet({
    x: (Math.random() - 0.5) * INITIAL_SEED_X_SPREAD,
    y: (Math.random() - 0.5) * INITIAL_SEED_Y_SPREAD,
    r: INITIAL_SEED_BASE_RADIUS + Math.random() * INITIAL_SEED_RANDOM_RADIUS,
  }, restLift));
};

const createBackdropContext = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { canvas, context, texture };
};

const drawHeroBackdrop = (backdrop, width, height) => {
  if (!backdrop) {
    return;
  }

  const canvasWidth = Math.max(1, Math.floor(width));
  const canvasHeight = Math.max(1, Math.floor(height));
  const { canvas, context, texture } = backdrop;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const gradient = context.createLinearGradient(0, 0, 0, canvasHeight);
  gradient.addColorStop(0, "#050916");
  gradient.addColorStop(0.38, "#0a1429");
  gradient.addColorStop(0.72, "#111f3d");
  gradient.addColorStop(1, "#182b4f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const mistLeft = context.createRadialGradient(
    canvasWidth * 0.12,
    canvasHeight * 0.18,
    0,
    canvasWidth * 0.12,
    canvasHeight * 0.18,
    canvasWidth * 0.64,
  );
  mistLeft.addColorStop(0, "rgba(170, 196, 243, 0.2)");
  mistLeft.addColorStop(1, "rgba(170, 196, 243, 0)");
  context.fillStyle = mistLeft;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const mistRight = context.createRadialGradient(
    canvasWidth * 0.86,
    canvasHeight * 0.28,
    0,
    canvasWidth * 0.86,
    canvasHeight * 0.28,
    canvasWidth * 0.56,
  );
  mistRight.addColorStop(0, "rgba(146, 174, 226, 0.16)");
  mistRight.addColorStop(1, "rgba(146, 174, 226, 0)");
  context.fillStyle = mistRight;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.save();
  context.fillStyle = "rgba(235, 244, 255, 0.45)";
  for (let index = 0; index < 28; index += 1) {
    const x = canvasWidth * (((index * 73) % 100) / 100);
    const y = canvasHeight * (0.07 + (((index * 37) % 100) / 100) * 0.56);
    const size = 0.8 + ((index * 29) % 4) * 0.35;
    context.globalAlpha = 0.2 + ((index * 17) % 10) * 0.03;
    context.fillRect(x, y, size, size);
  }
  context.restore();

  const haze = context.createRadialGradient(
    canvasWidth * 0.5,
    canvasHeight * 0.32,
    canvasWidth * 0.08,
    canvasWidth * 0.5,
    canvasHeight * 0.32,
    canvasWidth * 0.62,
  );
  haze.addColorStop(0, "rgba(195, 216, 248, 0.14)");
  haze.addColorStop(1, "rgba(195, 216, 248, 0)");
  context.fillStyle = haze;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const vignette = context.createRadialGradient(
    canvasWidth * 0.5,
    canvasHeight * 0.45,
    canvasWidth * 0.2,
    canvasWidth * 0.5,
    canvasHeight * 0.45,
    canvasWidth * 0.82,
  );
  vignette.addColorStop(0, "rgba(3, 6, 15, 0)");
  vignette.addColorStop(1, "rgba(2, 4, 10, 0.68)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  texture.needsUpdate = true;
};

const applyForces = (state, simTimeMs) => {
  const pointer = state.pointer;

  for (let index = 0; index < state.droplets.length; index += 1) {
    const droplet = state.droplets[index];
    droplet.age += FIXED_DT_MS;

    droplet.wanderAngle += (Math.random() - 0.5) * droplet.wanderSpeed;
    droplet.vx += Math.cos(droplet.wanderAngle + simTimeMs * 0.0001) * WANDER_FORCE;
    droplet.vy += Math.sin(droplet.wanderAngle + simTimeMs * 0.0001) * WANDER_FORCE;

    droplet.vx -= droplet.x * CENTER_PULL;
    droplet.vy -= droplet.y * CENTER_PULL;

    if (pointer.active) {
      const dx = droplet.x - pointer.x;
      const dy = droplet.y - pointer.y;
      const distanceSquared = dx * dx + dy * dy;
      const influenceRadius = MOUSE_RADIUS + droplet.r;
      const influenceRadiusSq = influenceRadius * influenceRadius;

      if (distanceSquared < influenceRadiusSq && distanceSquared > 0.00001) {
        const distance = Math.sqrt(distanceSquared);
        const strength = 1 - distance / influenceRadius;
        const impulse = strength * strength * MOUSE_FORCE;
        const nx = dx / distance;
        const ny = dy / distance;
        droplet.vx += nx * impulse;
        droplet.vy += ny * impulse;
      }
    }
  }

  for (let aIndex = 0; aIndex < state.droplets.length; aIndex += 1) {
    const a = state.droplets[aIndex];
    for (let bIndex = aIndex + 1; bIndex < state.droplets.length; bIndex += 1) {
      const b = state.droplets[bIndex];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSquared = dx * dx + dy * dy;
      const range = TENSION_RANGE + a.r + b.r;

      if (distanceSquared > range * range || distanceSquared <= 0.00001) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared);
      const factor = 1 - distance / range;
      const impulse = factor * TENSION_FORCE;
      const fx = (dx / distance) * impulse;
      const fy = (dy / distance) * impulse;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }
};

const integrateDroplets = (state) => {
  const limitX = state.aspect * 0.56;
  const limitY = 0.5;

  for (let index = 0; index < state.droplets.length; index += 1) {
    const droplet = state.droplets[index];
    const speed = Math.hypot(droplet.vx, droplet.vy);
    if (speed > MAX_SPEED) {
      const ratio = MAX_SPEED / speed;
      droplet.vx *= ratio;
      droplet.vy *= ratio;
    }

    droplet.x += droplet.vx;
    droplet.y += droplet.vy;
    droplet.vx *= DAMPING;
    droplet.vy *= DAMPING;

    if (droplet.x - droplet.r < -limitX) {
      droplet.x = -limitX + droplet.r;
      droplet.vx = Math.abs(droplet.vx) * BOUNCE;
    }
    if (droplet.x + droplet.r > limitX) {
      droplet.x = limitX - droplet.r;
      droplet.vx = -Math.abs(droplet.vx) * BOUNCE;
    }
    if (droplet.y - droplet.r < -limitY) {
      droplet.y = -limitY + droplet.r;
      droplet.vy = Math.abs(droplet.vy) * BOUNCE;
    }
    if (droplet.y + droplet.r > limitY) {
      droplet.y = limitY - droplet.r;
      droplet.vy = -Math.abs(droplet.vy) * BOUNCE;
    }
  }
};

const mergeDroplets = (state) => {
  for (let aIndex = 0; aIndex < state.droplets.length; aIndex += 1) {
    const a = state.droplets[aIndex];
    if (!a.alive) {
      continue;
    }

    for (let bIndex = aIndex + 1; bIndex < state.droplets.length; bIndex += 1) {
      const b = state.droplets[bIndex];
      if (!b.alive) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance >= (a.r + b.r) * MERGE_RATIO) {
        continue;
      }

      const area = a.area + b.area;
      a.x = (a.x * a.area + b.x * b.area) / area;
      a.y = (a.y * a.area + b.y * b.area) / area;
      a.vx = (a.vx * a.area + b.vx * b.area) / area;
      a.vy = (a.vy * a.area + b.vy * b.area) / area;
      a.r = Math.sqrt(area / Math.PI);
      a.area = area;
      b.alive = false;
    }
  }

  state.droplets = state.droplets.filter((droplet) => droplet.alive);
};

const splitDroplets = (state) => {
  const created = [];

  for (let index = 0; index < state.droplets.length; index += 1) {
    const droplet = state.droplets[index];
    if (droplet.r < SPLIT_MIN_RADIUS) {
      continue;
    }

    const speed = Math.hypot(droplet.vx, droplet.vy);
    if (speed < SPLIT_SPEED) {
      continue;
    }

    if (state.droplets.length + created.length >= MAX_DROPLETS) {
      break;
    }

    const halfArea = droplet.area * 0.5;
    const newRadius = Math.sqrt(halfArea / Math.PI);
    const nx = -droplet.vy / speed;
    const ny = droplet.vx / speed;
    const offset = newRadius * 0.72;

    droplet.r = newRadius;
    droplet.area = halfArea;
    droplet.x -= nx * offset;
    droplet.y -= ny * offset;

    created.push({
      x: droplet.x + nx * offset * 2,
      y: droplet.y + ny * offset * 2,
      vx: droplet.vx + nx * speed * 0.32,
      vy: droplet.vy + ny * speed * 0.32,
      r: newRadius,
      area: halfArea,
      baseRestX: droplet.baseRestX,
      baseRestY: droplet.baseRestY,
      restX: droplet.restX,
      restY: droplet.restY,
      softPrevX: droplet.x + nx * offset * 2,
      softPrevY: droplet.y + ny * offset * 2,
      softOffX: 0,
      softOffY: 0,
      softVelX: 0,
      softVelY: 0,
      age: 0,
      wanderAngle: Math.random() * Math.PI * 2,
      wanderSpeed: 0.3 + Math.random() * 0.5,
      alive: true,
    });
  }

  for (let index = 0; index < created.length; index += 1) {
    if (state.droplets.length >= MAX_DROPLETS) {
      break;
    }

    state.droplets.push(created[index]);
  }
};

const autoSpawnDroplet = (state) => {
  if (state.droplets.length >= MAX_DROPLETS || state.droplets.length >= AUTO_SPAWN_TARGET_COUNT) {
    return;
  }

  state.autoSpawnElapsedMs += FIXED_DT_MS;
  if (state.autoSpawnElapsedMs < AUTO_SPAWN_INTERVAL_MS) {
    return;
  }

  state.autoSpawnElapsedMs = 0;
  const x = (Math.random() - 0.5) * state.aspect * 0.68;
  const y = (Math.random() - 0.5) * 0.6;
  const radius = AUTO_SPAWN_BASE_RADIUS + Math.random() * AUTO_SPAWN_RANDOM_RADIUS;
  state.droplets.push({
    x,
    y,
    vx: (Math.random() - 0.5) * 0.001,
    vy: (Math.random() - 0.5) * 0.001,
    r: radius,
    area: Math.PI * radius * radius,
    baseRestX: x * 0.7,
    baseRestY: y * 0.7,
    restX: x * 0.7,
    restY: y * 0.7,
    softPrevX: x,
    softPrevY: y,
    softOffX: 0,
    softOffY: 0,
    softVelX: 0,
    softVelY: 0,
    age: 0,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderSpeed: 0.3 + Math.random() * 0.5,
    alive: true,
  });
};

const updateSoftBodies = (state) => {
  for (let index = 0; index < state.droplets.length; index += 1) {
    const droplet = state.droplets[index];
    const dx = droplet.x - droplet.softPrevX;
    const dy = droplet.y - droplet.softPrevY;

    droplet.softVelX += (dx - droplet.softOffX) * SOFT_STIFFNESS;
    droplet.softVelY += (dy - droplet.softOffY) * SOFT_STIFFNESS;
    droplet.softVelX *= SOFT_DAMPING;
    droplet.softVelY *= SOFT_DAMPING;
    droplet.softOffX += droplet.softVelX;
    droplet.softOffY += droplet.softVelY;

    droplet.softPrevX = droplet.x;
    droplet.softPrevY = droplet.y;
  }
};

const syncDropletUniforms = (state, uniforms) => {
  const dropletUniforms = uniforms.uDroplets.value;
  for (let index = 0; index < MAX_ENTRIES; index += 1) {
    dropletUniforms[index].set(0, 0, 0, 0);
  }

  const count = Math.min(state.droplets.length, MAX_DROPLETS);

  for (let index = 0; index < count; index += 1) {
    const droplet = state.droplets[index];
    dropletUniforms[index].set(droplet.x, droplet.y, droplet.r, 1);

    const ghostOffset = count + index;
    dropletUniforms[ghostOffset].set(
      droplet.x - droplet.softOffX * GHOST_TRAIL_STRENGTH,
      droplet.y - droplet.softOffY * GHOST_TRAIL_STRENGTH,
      droplet.r * GHOST_RADIUS_SCALE,
      1,
    );
  }

  uniforms.uCount.value = count * 2;
};

const spawnPointerDroplet = (state) => {
  if (!state.pointer.active || !state.pointer.down) {
    return;
  }

  if (state.droplets.length >= MAX_DROPLETS) {
    return;
  }

  state.spawnCooldownMs -= FIXED_DT_MS;
  if (state.spawnCooldownMs > 0) {
    return;
  }

  state.spawnCooldownMs = 220;
  const radius = POINTER_SPAWN_BASE_RADIUS + Math.random() * POINTER_SPAWN_RANDOM_RADIUS;
  const x = state.pointer.x + (Math.random() - 0.5) * 0.02;
  const y = state.pointer.y + (Math.random() - 0.5) * 0.02;
  const drift = createTinyRandomDrift();
  const droplet = {
    x,
    y,
    vx: drift.vx,
    vy: drift.vy,
    r: radius,
    area: Math.PI * radius * radius,
    baseRestX: x * 0.55,
    baseRestY: y * 0.55,
    restX: x * 0.55,
    restY: y * 0.55,
    softPrevX: x,
    softPrevY: y,
    softOffX: 0,
    softOffY: 0,
    softVelX: 0,
    softVelY: 0,
    age: 0,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderSpeed: 0.3 + Math.random() * 0.5,
    alive: true,
  };

  state.droplets.push(droplet);
};

const pruneDroplets = (state) => {
  if (state.droplets.length <= MAX_DROPLETS) {
    return;
  }

  state.droplets.sort((a, b) => b.r - a.r);
  state.droplets.length = MAX_DROPLETS;
};

const createUniforms = (backdropTexture) => {
  return {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDroplets: {
      value: Array.from({ length: MAX_ENTRIES }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uBackdrop: { value: backdropTexture },
    uCount: { value: 0 },
  };
};

export const initializeLiquidGlassBubbleLayer = (options = {}) => {
  const root = options.root instanceof HTMLElement ? options.root : document.getElementById("homepage-bubble-layer");
  if (!(root instanceof HTMLElement)) {
    return () => {};
  }

  const motionQuery = options.prefersReducedMotionQuery && typeof options.prefersReducedMotionQuery.matches === "boolean"
    ? options.prefersReducedMotionQuery
    : window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = () => Boolean(motionQuery && motionQuery.matches);

  root.innerHTML = "";

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    root.classList.add("is-paused");
    return () => {};
  }

  renderer.domElement.className = "homepage-bubble-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  camera.position.z = 1;

  const backdrop = createBackdropContext();
  const backdropTexture = backdrop ? backdrop.texture : new THREE.Texture();
  const uniforms = createUniforms(backdropTexture);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const state = {
    width: 1,
    height: 1,
    aspect: 1,
    droplets: initializeDroplets(),
    pointer: {
      x: 0,
      y: 0,
      active: false,
      down: false,
    },
    spawnCooldownMs: 0,
    autoSpawnElapsedMs: 0,
    simTimeMs: 0,
  };

  const syncSize = () => {
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    state.width = width;
    state.height = height;
    state.aspect = width / height;

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);

    drawHeroBackdrop(backdrop, renderer.domElement.width, renderer.domElement.height);

    const limitX = state.aspect * 0.58;
    for (let index = 0; index < state.droplets.length; index += 1) {
      const droplet = state.droplets[index];
      droplet.x = clamp(droplet.x, -limitX, limitX);
      droplet.baseRestX = clamp(droplet.baseRestX, -limitX * 0.88, limitX * 0.88);
      droplet.restX = clamp(droplet.restX, -limitX * 0.88, limitX * 0.88);
      droplet.restY = clamp(droplet.restY, -0.45, 0.45);
    }
  };

  const mapPointer = (event) => {
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const mappedX = (ratioX - 0.5) * state.aspect * 1.22;
    const mappedY = (0.5 - ratioY) * 1.02;

    const pointer = state.pointer;
    pointer.x = clamp(mappedX, -state.aspect * 0.68, state.aspect * 0.68);
    pointer.y = clamp(mappedY, -0.62, 0.62);
    pointer.active = true;
  };

  const fixedUpdate = () => {
    state.simTimeMs += FIXED_DT_MS;

    applyForces(state, state.simTimeMs);
    integrateDroplets(state);
    mergeDroplets(state);
    splitDroplets(state);
    spawnPointerDroplet(state);
    autoSpawnDroplet(state);
    pruneDroplets(state);
    updateSoftBodies(state);
  };

  const renderFrame = () => {
    syncDropletUniforms(state, uniforms);
    renderer.render(scene, camera);
  };

  const settleStaticPose = () => {
    for (let index = 0; index < state.droplets.length; index += 1) {
      const droplet = state.droplets[index];
      droplet.vx *= 0.6;
      droplet.vy *= 0.6;
      droplet.softOffX *= 0.7;
      droplet.softOffY *= 0.7;
    }

    renderFrame();
  };

  let rafId = 0;
  let lastFrameMs = 0;
  let accumulatorMs = 0;

  const stopAnimation = () => {
    if (!rafId) {
      return;
    }

    window.cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const frame = (timeMs) => {
    rafId = 0;

    if (document.hidden || prefersReducedMotion()) {
      return;
    }

    if (!lastFrameMs) {
      lastFrameMs = timeMs;
    }

    const deltaMs = clamp(timeMs - lastFrameMs, 0, MAX_FRAME_DT_MS);
    lastFrameMs = timeMs;
    accumulatorMs += deltaMs;

    let guard = 0;
    while (accumulatorMs >= FIXED_DT_MS && guard < MAX_CATCHUP) {
      fixedUpdate();
      accumulatorMs -= FIXED_DT_MS;
      guard += 1;
    }

    if (guard >= MAX_CATCHUP) {
      accumulatorMs = 0;
    }

    renderFrame();
    rafId = window.requestAnimationFrame(frame);
  };

  const startAnimation = () => {
    if (rafId || document.hidden || prefersReducedMotion()) {
      return;
    }

    root.classList.remove("is-paused");
    lastFrameMs = performance.now();
    accumulatorMs = 0;
    rafId = window.requestAnimationFrame(frame);
  };

  const handlePointerMove = (event) => {
    mapPointer(event);
    if ((prefersReducedMotion() || document.hidden) && !rafId) {
      settleStaticPose();
    }
  };

  const handlePointerLeave = () => {
    state.pointer.active = false;
    state.pointer.down = false;

    if (prefersReducedMotion() || document.hidden) {
      settleStaticPose();
    }
  };

  const handlePointerDown = (event) => {
    mapPointer(event);
    state.pointer.down = true;
    if (prefersReducedMotion() || document.hidden) {
      settleStaticPose();
    }
  };

  const handlePointerUp = () => {
    state.pointer.down = false;
    if (prefersReducedMotion() || document.hidden) {
      settleStaticPose();
    }
  };

  const handleResize = () => {
    syncSize();
    if (prefersReducedMotion() || document.hidden) {
      settleStaticPose();
    }
  };

  const handleVisibilityChange = () => {
    const hidden = document.hidden;
    root.classList.toggle("is-paused", hidden);

    if (hidden) {
      stopAnimation();
      return;
    }

    if (prefersReducedMotion()) {
      settleStaticPose();
      return;
    }

    startAnimation();
  };

  const handleReducedMotionChange = () => {
    if (prefersReducedMotion()) {
      stopAnimation();
      root.classList.add("is-paused");
      settleStaticPose();
      return;
    }

    if (!document.hidden) {
      root.classList.remove("is-paused");
      startAnimation();
    }
  };

  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(root);
  }

  renderer.domElement.addEventListener("pointermove", handlePointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointerup", handlePointerUp, { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("resize", handleResize, { passive: true });

  if (motionQuery && typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", handleReducedMotionChange);
  } else if (motionQuery && typeof motionQuery.addListener === "function") {
    motionQuery.addListener(handleReducedMotionChange);
  }

  syncSize();
  settleStaticPose();

  if (document.hidden || prefersReducedMotion()) {
    root.classList.add("is-paused");
  } else {
    startAnimation();
  }

  return () => {
    stopAnimation();
    renderer.domElement.removeEventListener("pointermove", handlePointerMove);
    renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("resize", handleResize);

    if (motionQuery && typeof motionQuery.removeEventListener === "function") {
      motionQuery.removeEventListener("change", handleReducedMotionChange);
    } else if (motionQuery && typeof motionQuery.removeListener === "function") {
      motionQuery.removeListener(handleReducedMotionChange);
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    material.dispose();
    if (backdrop) {
      backdrop.texture.dispose();
    }
    renderer.dispose();
  };
};
