// ═════════════════════════════════════════════════════════════════════
// CatNon Helper — Three.js Radial Navigation (Q-20261012-radial-nav)
// States: HUB_IDLE → OPENING_RING → RING_INTERACTIVE →
//         TRANSITIONING_TO_TOOL → TOOL_ACTIVE → TRANSITIONING_TO_HUB
// ═════════════════════════════════════════════════════════════════════

const NAV3D_TOOLS = [
  { id: 'schedule',   label: 'Schedule',  sub: 'Tasks & plans',  color: 0xf5ee38 },
  { id: 'notes',      label: 'Notes',     sub: 'Rich-text docs', color: 0x00e5ff },
  { id: 'pictures',   label: 'Gallery',   sub: 'Albums & media', color: 0xff2a70 },
  { id: 'filedrop',   label: 'FileDrop',  sub: 'P2P transfer',   color: 0x2bf784 },
  { id: 'netinfo',    label: 'Network',   sub: 'Diagnostics',    color: 0x2979ff },
  { id: 'backtracker',label: 'Backtracker', sub: 'GPS tracing',  color: 0xffa726 },
  { id: 'imgpdf',     label: 'Image→PDF', sub: 'Converter',      color: 0xb388ff },
  { id: 'qr',         label: 'QR Code',   sub: 'Exports PNG',    color: 0x00e5ff },
];

const NAV3D_STATE = {
  IDLE: 0, OPENING: 1, RING: 2, TO_TOOL: 3, TOOL: 4, TO_HUB: 5,
};
let nav3dState = NAV3D_STATE.IDLE; // HUB_IDLE

const NAV3D_CONFIG = {
  ringRadius: 5.2,
  ringTiltX: -0.42,
  ringTiltZ: 0.08,
  camFOV: 50,
  openDuration: 620,   // ms — spec: hub→ring 350–650
  closeDuration: 420,
  inertia: 0.92,       // rotational friction per frame (config s.5)
  flickGain: 0.35,     // release velocity → residual angular velocity
  snapAngle: Math.PI / NAV3D_TOOLS.length / 2, // subtle snap target
  debounceMs: 220,     // tap-vs-drag threshold
};

// ── Globals ─────────────────────────────────────────────────────────
let renderer, scene, camera, canvas;
let hubGroup, ringGroup, panelMeshes = [], hubMesh;
let ringLights;
let activeToolId = null;
let lastRingRotation = 0;      // restored on back
let bubbleMesh, bubbleT = -1;
let geoCache = {};
let isDragging = false;
let dragAngle = 0, lastPointerAngle = 0, dragVel = 0;
let pointerStart = { x: 0, y: 0 };
let movedBeyondThreshold = false;
let idleT = 0;
let clock = null;
let renderPaused = false;

const redMode = (() => { // reduced motion
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
})();

// ── Shared helpers (pre-allocated; no per-frame allocation) ──────────
const _v = new (window.THREE ? THREE.Vector3 : Object)();

// ── Geometry/material caches ────────────────────────────────────────
function getGeometry(key, builder) {
  if (!geoCache[key]) geoCache[key] = builder();
  return geoCache[key];
}
function getMaterial(key, props) {
  if (!geoCache[key]) geoCache[key] = new THREE.MeshStandardMaterial(props);
  return geoCache[key];
}

// ═════════════════════════════════════════════════════════════════════
// SCENE / CAMERA SETUP (concern 1)
// ═════════════════════════════════════════════════════════════════════
function nav3dInit() {
  if (!window.THREE) { nav3dFallback('three.js not loaded'); return; }
  canvas = document.getElementById('nav3d-canvas');
  if (!canvas) { nav3dFallback('canvas missing'); return; }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    nav3dFallback('WebGL unavailable: ' + err.message);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // s.10 DPR clamp
  renderer.setClearColor(0x050811, 1);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050811, 0.045);
  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(NAV3D_CONFIG.camFOV, 1, 0.1, 100);
  camera.position.set(0, 1.6, 11.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x223a66, 1.1));
  const key = new THREE.DirectionalLight(0x9fc5ff, 1.2);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x00e5ff, 0.55);
  rim.position.set(-6, 2, -4);
  scene.add(rim);
  const under = new THREE.DirectionalLight(0x123a5c, 0.5);
  under.position.set(0, -5, 3);
  scene.add(under);

  buildHub();
  buildRing();   // data-driven panels; hidden until open
  buildBubble();

  nav3dResize();
  window.addEventListener('resize', nav3dResize);
  document.addEventListener('visibilitychange', () => {
    renderPaused = document.hidden; // s.10 pause when hidden
  });

  bindPointerEvents();
  attachHubTap();
  bindKeyboard();
  nav3dLoop();
}

// ── Responsive framing (s.9): portrait vs landscape/desktop ─────────
function nav3dResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  const portrait = h >= w;
  // Deliberate portrait framing per spec; desktop gets a wider, closer view.
  NAV3D_CONFIG.ringRadius = portrait ? Math.min(w / 46 + 4.0, 5.6) : 6.4;
  camera.fov = portrait ? 55 : 42;
  camera.position.z = portrait ? 12.4 : 11.0;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (ringGroup) ringGroup.scale.setScalar(portrait ? 0.92 : 1.0);
}

// ═════════════════════════════════════════════════════════════════════
// CENTRAL HUB (concern 2)
// ═════════════════════════════════════════════════════════════════════
function buildHub() {
  hubGroup = new THREE.Group();
  scene.add(hubGroup);

  // Layered disc geometry: base disc + beveled ring + glow ring
  const discGeo = getGeometry('hub-disc', () => new THREE.CylinderGeometry(2.05, 2.15, 0.55, 48));
  const discMat = getMaterial('hub-disc', {
    color: 0x101c38, metalness: 0.75, roughness: 0.35,
    emissive: 0x0a1830, emissiveIntensity: 0.4,
  });
  hubMesh = new THREE.Mesh(discGeo, discMat);
  hubMesh.rotation.x = Math.PI / 2;
  hubGroup.add(hubMesh);

  // Illuminated ring (emblem placeholder — spec s.2)
  const ringGeo = getGeometry('hub-ring', () => new THREE.TorusGeometry(1.72, 0.075, 12, 64));
  const ringMat = getMaterial('hub-ring', {
    color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.4,
  });
  const halo = new THREE.Mesh(ringGeo, ringMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.3;
  hubGroup.add(halo);

  // CatNon wordmark as camera-facing sprite (label legibility rule, s.4)
  const mark = makeTextSprite('CATNON HELPER', 26, '#e8f4ff');
  mark.scale.set(2.6, 0.5, 1);
  mark.position.y = 0.34;
  hubGroup.add(mark);

  hubGroup.rotation.x = NAV3D_CONFIG.ringTiltX * 0.35;
  hubGroup.position.y = 0.2;
}

// Camera-facing canvas-texture label — reused for panels
function makeTextSprite(text, px, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = `800 ${px}px "DM Sans", system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,229,255,0.55)'; g.shadowBlur = 12;
  g.fillStyle = color;
  g.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Sprite(mat);
}

// ═════════════════════════════════════════════════════════════════════
// RADIAL RING — data-driven tapered panels (concerns 3, 4)
// ═════════════════════════════════════════════════════════════════════
function buildRing() {
  ringGroup = new THREE.Group();
  ringGroup.visible = false;
  ringGroup.rotation.x = NAV3D_CONFIG.ringTiltX;
  ringGroup.rotation.z = NAV3D_CONFIG.ringTiltZ;
  scene.add(ringGroup);

  const n = NAV3D_TOOLS.length;
  const seg = (Math.PI * 2) / n;

  const wedgeGeo = getGeometry('panel-wedge', () =>
    new THREE.CylinderGeometry(NAV3D_CONFIG.ringRadius - 1.15, NAV3D_CONFIG.ringRadius, 0.16, 4, 1, false, seg * 0.62)
  );

  NAV3D_TOOLS.forEach((tool, i) => {
    const panel = new THREE.Mesh(wedgeGeo, new THREE.MeshStandardMaterial({
      color: 0x16264a, metalness: 0.7, roughness: 0.42,
      emissive: 0x0a1a38, emissiveIntensity: 0.35,
      transparent: true, opacity: 0,
    }));
    panel.userData.toolIndex = i;

    // Angular placement — outward-facing, inner edge inclined to center (s.6)
    const angle = i * seg;
    panel.position.set(
      Math.cos(angle) * NAV3D_CONFIG.ringRadius * 0.82,
      0,
      Math.sin(angle) * NAV3D_CONFIG.ringRadius * 0.82
    );
    panel.rotation.y = -angle - seg * 0.31; // orient wedge outward
    panel.userData.homeAngle = angle;

    // Icon sprite (camera-facing, label legibility)
    const icon = makeTextSprite(tool.label.toUpperCase(), 20, '#00e5ff');
    icon.scale.set(1.9, 0.36, 1);
    icon.position.set(0, 0.42, 0);
    panel.add(icon);

    ringGroup.add(panel);
    panelMeshes.push(panel);
  });

  // Ring guide torus (visual continuity from hub halo)
  const guide = new THREE.Mesh(
    getGeometry('ring-guide', () => new THREE.TorusGeometry(NAV3D_CONFIG.ringRadius * 0.82, 0.045, 8, 96)),
    getMaterial('ring-guide', { color: 0x0a5cff, emissive: 0x0a5cff, emissiveIntensity: 0.55, transparent: true, opacity: 0.75 })
  );
  guide.rotation.x = Math.PI / 2;
  ringGroup.add(guide);
}

// ═════════════════════════════════════════════════════════════════════
// WATER-BUBBLE TRANSITION MESH (concern 7) — simple shader, no fluid sim
// ═════════════════════════════════════════════════════════════════════
function buildBubble() {
  const geo = new THREE.SphereGeometry(1, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uProgress: { value: 0 } },
    vertexShader: `
      uniform float uProgress;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y *= mix(0.05, 6.5, uProgress);
        p.x *= mix(0.6, 14.0, uProgress);
        p.z *= 3.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uProgress;
      varying vec2 vUv;
      void main() {
        float rim = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        vec3 col = mix(vec3(0.0, 0.55, 0.85), vec3(0.0, 0.9, 1.0), vUv.y);
        float alpha = mix(0.85, 0.98, vUv.y);
        gl_FragColor = vec4(col, alpha * mix(0.6, 1.0, rim));
      }`,
  });
  bubbleMesh = new THREE.Mesh(geo, mat);
  bubbleMesh.position.set(0, -7.5, 3);
  bubbleMesh.visible = false;
  scene.add(bubbleMesh);
}

// ═════════════════════════════════════════════════════════════════════
// OPEN / CLOSE TRANSFORMATION (concern 3) — reversible
// ═════════════════════════════════════════════════════════════════════
function openRing() {
  if (nav3dState !== NAV3D_STATE.IDLE) return;
  nav3dState = NAV3D_STATE.OPENING;
  ringGroup.visible = true;

  const t0 = performance.now();
  const dur = redMode ? 240 : NAV3D_CONFIG.openDuration;

  // Hub tap feedback: compression pulse (spec seq.1)
  hubMesh.scale.set(1.15, 0.7, 1.15);
  const pulseEnd = performance.now() + 160;

  function animStep() {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3); // cubic ease-out

    ringGroup.scale.setScalar(0.35 + 0.65 * e);        // expand outward
    ringGroup.rotation.y = (1 - e) * 1.2;               // unfold spin
    panelMeshes.forEach((p, i) => {
      const stagger = Math.max(0, t - (i * 0.12 / NAV3D_TOOLS.length)) / (1 - i * 0.12 / NAV3D_TOOLS.length);
      p.material.opacity = Math.min(1, stagger);
    });

    if (performance.now() < pulseEnd) {
      const s = 1 - (pulseEnd - performance.now()) / 160;
      hubMesh.scale.set(1.15 - 0.15 * s, 0.7 + 0.3 * s, 1.15 - 0.15 * s);
    } else {
      hubMesh.scale.set(1, 1, 1);
    }
    hubGroup.visible = t < 0.5; // hub dissolves as ring takes over (continuity)

    if (t < 1) requestAnimationFrame(animStep);
    else {
      hubGroup.visible = false;
      ringGroup.scale.setScalar(1);
      ringGroup.rotation.y = 0;
      nav3dState = NAV3D_STATE.RING; // RING_INTERACTIVE
      ringLights && (ringLights.visible = true);
    }
  }
  animStep();
}

function attachHubTap() {
  // Hub tap → open ring (pointerdown on canvas while IDLE)
  canvas.addEventListener('pointerdown', e => {
    if (nav3dState !== NAV3D_STATE.IDLE) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    if (rc.intersectObject(hubMesh, false).length) {
      const hint = document.getElementById('nav3d-hint');
      if (hint) hint.style.opacity = '0';
      openRing();
    }
  });
}

function closeRing() {
  if (nav3dState !== NAV3D_STATE.RING) return;
  nav3dState = NAV3D_STATE.IDLE; // intermediate; loop keeps rendering
  const t0 = performance.now();
  const dur = redMode ? 180 : NAV3D_CONFIG.closeDuration;
  const startScale = ringGroup.scale.x, startRotY = ringGroup.rotation.y;

  function animStep() {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    ringGroup.scale.setScalar(startScale * (1 - e) + 0.35 * e);
    ringGroup.rotation.y = startRotY * (1 - e) + 1.2 * e;
    ringGroup.visible = t < 1;
    hubGroup.visible = t > 0.5;
    if (t < 1) requestAnimationFrame(animStep);
    else {
      ringGroup.visible = false;
      hubGroup.visible = true;
      nav3dState = NAV3D_STATE.IDLE; // HUB_IDLE
    }
  }
  animStep();
}

// ═════════════════════════════════════════════════════════════════════
// GESTURE: circular drag + tap-vs-drag (concern 5)
// ═════════════════════════════════════════════════════════════════════
function pointerAngle(x, y) {
  // Screen center = ring center (camera looks at 0,0,0 — acceptable for
  // this camera framing; perspective offset is small at this distance).
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return Math.atan2(y - cy, x - cx);
}

function bindPointerEvents() {
  canvas.addEventListener('pointerdown', e => {
    pointerStart = { x: e.clientX, y: e.clientY };
    movedBeyondThreshold = false;

    if (nav3dState === NAV3D_STATE.RING) {
      isDragging = true;
      lastPointerAngle = pointerAngle(e.clientX, e.clientY);
      dragVel = 0;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!isDragging || nav3dState !== NAV3D_STATE.RING) return;
    const dist = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
    if (dist > 12) movedBeyondThreshold = true;

    const a = pointerAngle(e.clientX, e.clientY);
    let d = a - lastPointerAngle;
    // Angle wrapping across the ±π boundary (spec s.5)
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    dragVel = d;
    ringGroup.rotation.y += d;
    lastPointerAngle = a;
  });

  canvas.addEventListener('pointerup', e => {
    const wasDragging = isDragging;
    isDragging = false;
    if (nav3dState !== NAV3D_STATE.RING) return;

    if (wasDragging && !movedBeyondThreshold) {
      handleTap(e.clientX, e.clientY);      // tap → maybe select panel
    } else if (Math.abs(dragVel) > 0.06) {
      dragVel *= NAV3D_CONFIG.flickGain;    // restrained inertia (s.5)
    } else {
      dragVel = 0;
    }
  });
}

function handleTap(x, y) {
  // Raycast the pointer into the ring plane to find an intersected panel
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((x - r.left) / r.width) * 2 - 1,
    -((y - r.top) / r.height) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hits = rc.intersectObjects(panelMeshes, false);
  if (hits.length) selectPanel(hits[0].object.userData.toolIndex);
}

// ═════════════════════════════════════════════════════════════════════
// SELECTION + BUBBLE TRANSITION (concerns 6, 7)
// ═════════════════════════════════════════════════════════════════════
function selectPanel(idx) {
  if (nav3dState !== NAV3D_STATE.RING) return;
  const tool = NAV3D_TOOLS[idx];
  const panel = panelMeshes[idx];

  nav3dState = NAV3D_STATE.TO_TOOL;  // block further menu input (spec seq.2)
  activeToolId = tool.id;
  lastRingRotation = ringGroup.rotation.y;  // restore on back (s.8)

  // Selection confirm: highlight compress (spec seq.1)
  panel.scale.set(1.08, 0.85, 1.08);
  panel.material.emissiveIntensity = 1.4;

  const delay = redMode ? 120 : 280;
  setTimeout(() => startBubble(tool), delay);
}

function startBubble(tool) {
  bubbleMesh.visible = true;
  bubbleT = 0;
  const dur = redMode ? 260 : 620; // spec: 400–700

  const t0 = performance.now();
  function animStep() {
    const p = Math.min(1, (performance.now() - t0) / dur);
    bubbleMesh.material.uniforms.uProgress.value = p;
    if (p < 1) requestAnimationFrame(animStep);
    else {
      bubbleMesh.visible = false;
      showTool(tool);
    }
  }
  animStep();
}

function showTool(tool) {
  // Reveal the EXISTING utility screen — no redesign, no data changes (s.8)
  ringGroup.visible = false;
  bubbleMesh.visible = false;
  canvas.style.display = 'none';
  document.getElementById('nav3d-overlay').classList.remove('active');
  document.getElementById('nav3d-back').style.display = '';
  nav3dState = NAV3D_STATE.TOOL; // TOOL_ACTIVE
  if (window.showScreen) window.showScreen(tool.id);
}

function backToHub() {
  if (nav3dState !== NAV3D_STATE.TOOL) return;
  nav3dState = NAV3D_STATE.TO_HUB;

  document.getElementById('nav3d-overlay').classList.add('active');
  document.getElementById('nav3d-back').style.display = 'none';
  canvas.style.display = '';

  // Reverse bubble, then restore previous ring state (spec s.8)
  const dur = redMode ? 220 : 480;
  bubbleMesh.visible = true;
  const t0 = performance.now();
  function animStep() {
    const p = Math.min(1, (performance.now() - t0) / dur);
    bubbleMesh.material.uniforms.uProgress.value = 1 - p;
    if (p < 1) requestAnimationFrame(animStep);
    else {
      bubbleMesh.visible = false;
      canvas.style.display = '';
      ringGroup.rotation.y = lastRingRotation;          // restore rotation
      panelMeshes.forEach((pm, i) => {
        pm.scale.set(1, 1, 1);
        pm.material.emissiveIntensity = pm.userData.toolIndex === i ? 0.35 : 0.35;
      });
      nav3dState = NAV3D_STATE.RING;  // RING_INTERACTIVE, rotation preserved
    }
  }
  animStep();
}

// ═════════════════════════════════════════════════════════════════════
// ANIMATION LOOP (concerns: idle bobbing, inertia, snap, bubble)
// ═════════════════════════════════════════════════════════════════════
function nav3dLoop() {
  requestAnimationFrame(nav3dLoop);
  if (renderPaused || document.hidden) return;   // s.10 pause hidden
  const dt = Math.min(clock.getDelta(), 0.05);

  idleT += dt;
  if (nav3dState === NAV3D_STATE.IDLE) {
    // Gentle float + subtle X/Z tilt (spec s.1, s.2)
    if (!redMode) {
      hubGroup.position.y = 0.2 + Math.sin(idleT * 1.2) * 0.14;
      hubGroup.rotation.x = NAV3D_CONFIG.ringTiltX * 0.35 + Math.sin(idleT * 0.7) * 0.06;
      hubGroup.rotation.z = NAV3D_CONFIG.ringTiltZ + Math.cos(idleT * 0.55) * 0.05;
    }
  } else if (nav3dState === NAV3D_STATE.RING) {
    // Inertia friction + subtle snap (independently of idle bobbing; s.6)
    if (!redMode && !isDragging && Math.abs(dragVel) > 0.0015) {
      ringGroup.rotation.y += dragVel;
      dragVel *= NAV3D_CONFIG.inertia;
    }
    // Subtle snap to panel alignment after slowing (config-gated, s.5)
    if (!redMode && !isDragging && Math.abs(dragVel) <= 0.0015) {
      const seg = (Math.PI * 2) / NAV3D_TOOLS.length;
      const n = Math.round(ringGroup.rotation.y / seg);
      const target = n * seg;
      ringGroup.rotation.y += (target - ringGroup.rotation.y) * 0.08; // gentle
    }
    // Ring idle: gentle bob + tilt on top of user rotation, never overwrites it
    if (!redMode && !isDragging) {
      ringGroup.position.y = Math.sin(idleT * 1.1) * 0.1;
      ringGroup.rotation.x = NAV3D_CONFIG.ringTiltX + Math.sin(idleT * 0.6) * 0.035;
      ringGroup.rotation.z = NAV3D_CONFIG.ringTiltZ + Math.cos(idleT * 0.5) * 0.03;
    }
  }

  renderer.render(scene, camera);
}

// ═════════════════════════════════════════════════════════════════════
// KEYBOARD: accessible alternative (spec s.5 "alternatives")
// ═════════════════════════════════════════════════════════════════════
function bindKeyboard() {
  window.addEventListener('keydown', e => {
    if (nav3dState === NAV3D_STATE.IDLE && (e.key === 'Enter' || e.key === ' ')) {
      openRing(); e.preventDefault();
    } else if (nav3dState === NAV3D_STATE.RING) {
      const seg = (Math.PI * 2) / NAV3D_TOOLS.length;
      if (e.key === 'ArrowLeft') { ringGroup.rotation.y -= seg; dragVel = 0; }
      else if (e.key === 'ArrowRight') { ringGroup.rotation.y += seg; dragVel = 0; }
      else if (e.key === 'Escape') closeRing();
      e.preventDefault();
    } else if (nav3dState === NAV3D_STATE.TOOL && e.key === 'Escape') {
      backToHub();
    }
  });
}

// Public API used by index.html inline handlers
function nav3dOpenRing() { openRing(); }
function nav3dCloseRing() { closeRing(); }
function nav3dBackToHub() { backToHub(); }

// ═════════════════════════════════════════════════════════════════════
// NON-WEBGL FALLBACK (spec s.10)
// ═════════════════════════════════════════════════════════════════════
function nav3dFallback(reason) {
  console.warn('nav3d fallback:', reason);
  const fb = document.getElementById('nav3d-fallback');
  if (fb) {
    fb.style.display = 'flex';
    const msg = fb.querySelector('.nav3d-fallback-reason');
    if (msg) msg.textContent = reason;
  }
  if (canvas) canvas.style.display = 'none';
}

// Cleanup (spec s.10)
function nav3dDispose() {
  cancelAnimationFrame(nav3dLoop);
  window.removeEventListener('resize', nav3dResize);
  renderer && renderer.dispose();
  Object.values(geoCache).forEach(o => o.dispose && o.dispose());
  geoCache = {};
}

// Boot when app is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', nav3dInit);
} else {
  nav3dInit();
}

// Expose minimal global API
window.nav3d = {
  openRing: nav3dOpenRing,
  closeRing: nav3dCloseRing,
  backFromTool: backToHub,
  backToHubFn: backToHub,
  state: () => nav3dState,
  tools: NAV3D_TOOLS,
  resume() { renderPaused = false; },  // re-entering overlay from More screen
};
