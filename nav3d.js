// ═════════════════════════════════════════════════════════════════════
// CatNon Helper — Three.js Radial Navigation (Q-20261012-radial-nav)
// States: HUB_IDLE → OPENING_RING → RING_INTERACTIVE →
//         TRANSITIONING_TO_TOOL → TOOL_ACTIVE → TRANSITIONING_TO_HUB
// ═════════════════════════════════════════════════════════════════════

const NAV3D_TOOLS = [
  { id: 'schedule',    label: 'Schedule',    sub: 'Tasks & plans',  color: 0xf5ee38 },
  { id: 'notes',       label: 'Notes',       sub: 'Rich-text docs', color: 0x00e5ff },
  { id: 'pictures',    label: 'Gallery',     sub: 'Albums & media', color: 0xff2a70 },
  { id: 'filedrop',    label: 'FileDrop',    sub: 'P2P transfer',   color: 0x2bf784 },
  { id: 'netinfo',     label: 'Network',     sub: 'Diagnostics',    color: 0x2979ff },
  { id: 'backtracker', label: 'Backtracker', sub: 'GPS tracing',    color: 0xffa726 },
  { id: 'imgpdf',      label: 'Image→PDF',   sub: 'Converter',      color: 0xb388ff },
  { id: 'qr',          label: 'QR Code',     sub: 'Exports PNG',    color: 0x00e5ff },
];

const NAV3D_STATE = {
  IDLE: 0, OPENING: 1, RING: 2, TO_TOOL: 3, TOOL: 4, TO_HUB: 5,
};
let nav3dState = NAV3D_STATE.IDLE; // HUB_IDLE

const NAV3D_CONFIG = {
  ringRadius: 5.0,
  ringTiltX: 0.42,
  ringTiltZ: 0.08,
  camFOV: 48,
  openDuration: 580,   // ms — spec: hub→ring 350–650
  closeDuration: 380,
  inertia: 0.92,       // rotational friction per frame
  flickGain: 0.35,     // release velocity → residual angular velocity
  snapAngle: Math.PI / NAV3D_TOOLS.length / 2, // subtle snap target
  debounceMs: 220,     // tap-vs-drag threshold
};

// ── Globals ─────────────────────────────────────────────────────────
let renderer, scene, camera, canvas;
let hubGroup, ringGroup, panelMeshes = [], hubMesh, hubHalo;
let ringGuide;
let activeToolId = null;
let lastRingRotation = 0;      // restored on back
let bubbleMesh, bubbleT = -1;
let geoCache = {};
let matCache = {};
let isDragging = false;
let dragAngle = 0, lastPointerAngle = 0, dragVel = 0;
let pointerStart = { x: 0, y: 0 };
let movedBeyondThreshold = false;
let idleT = 0;
let clock = null;
let renderPaused = false;
let hoveredPanelIdx = -1;

const redMode = (() => { // reduced motion
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
})();

// ── Geometry/material caches ────────────────────────────────────────
function getGeometry(key, builder) {
  if (!geoCache[key]) geoCache[key] = builder();
  return geoCache[key];
}
function getMaterial(key, props) {
  if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial(props);
  return matCache[key];
}

// ═════════════════════════════════════════════════════════════════════
// SCENE / CAMERA SETUP (concern 1)
// ═════════════════════════════════════════════════════════════════════
function nav3dInit() {
  if (renderer) return; // already initialized
  if (!window.THREE) {
    nav3dFallback('three.js not loaded');
    return;
  }
  canvas = document.getElementById('nav3d-canvas');
  if (!canvas) {
    nav3dFallback('canvas missing');
    return;
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    nav3dFallback('WebGL unavailable: ' + err.message);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x050811, 1);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050811, 0.045);
  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(NAV3D_CONFIG.camFOV, 1, 0.1, 100);
  camera.position.set(0, 3.5, 10.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x223a66, 1.2));
  const key = new THREE.DirectionalLight(0x9fc5ff, 1.3);
  key.position.set(4, 7, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x00e5ff, 0.65);
  rim.position.set(-6, 3, -4);
  scene.add(rim);
  const under = new THREE.DirectionalLight(0x123a5c, 0.55);
  under.position.set(0, -5, 3);
  scene.add(under);

  buildHub();
  buildRing();
  buildBubble();

  nav3dResize();
  window.addEventListener('resize', nav3dResize);
  document.addEventListener('visibilitychange', () => {
    renderPaused = document.hidden;
  });

  bindPointerEvents();
  attachHubTap();
  bindKeyboard();
  nav3dLoop();
}

// ── Responsive framing: portrait vs landscape/desktop ───────────────
function nav3dResize() {
  if (!camera || !renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  const portrait = h >= w;
  NAV3D_CONFIG.ringRadius = portrait ? Math.min(w / 48 + 3.8, 5.0) : 5.8;
  camera.fov = portrait ? 54 : 42;
  camera.position.z = portrait ? 12.2 : 10.8;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (ringGroup) ringGroup.scale.setScalar(portrait ? 0.94 : 1.0);
}

// ═════════════════════════════════════════════════════════════════════
// CENTRAL HUB (concern 2)
// ═════════════════════════════════════════════════════════════════════
function buildHub() {
  hubGroup = new THREE.Group();
  scene.add(hubGroup);

  // Disc sits in XZ plane with slight tilt toward camera
  const discGeo = getGeometry('hub-disc', () => new THREE.CylinderGeometry(2.05, 2.15, 0.35, 48));
  const discMat = getMaterial('hub-disc', {
    color: 0x101e3b, metalness: 0.8, roughness: 0.28,
    emissive: 0x00e5ff, emissiveIntensity: 0.75,
  });
  hubMesh = new THREE.Mesh(discGeo, discMat);
  hubGroup.add(hubMesh);

  // Concentric glowing halo torus in XZ plane
  const ringGeo = getGeometry('hub-ring', () => new THREE.TorusGeometry(2.32, 0.065, 14, 64));
  const ringMat = getMaterial('hub-ring', {
    color: 0x2979ff, emissive: 0x00e5ff, emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.2,
  });
  hubHalo = new THREE.Mesh(ringGeo, ringMat);
  hubHalo.rotation.x = Math.PI / 2; // Torus rotated into XZ plane
  hubGroup.add(hubHalo);

  // Inner accent ring
  const innerGeo = getGeometry('hub-inner-ring', () => new THREE.TorusGeometry(1.6, 0.032, 10, 48));
  const innerHalo = new THREE.Mesh(innerGeo, ringMat);
  innerHalo.rotation.x = Math.PI / 2;
  innerHalo.position.y = 0.18;
  hubGroup.add(innerHalo);

  // CatNon wordmark as camera-facing sprite
  const mark = makeTextSprite('CATNON HELPER', 'Tap hub to enter', '#00e5ff');
  mark.scale.set(3.0, 0.75, 1);
  mark.position.y = 0.44;
  hubGroup.add(mark);

  hubGroup.rotation.x = NAV3D_CONFIG.ringTiltX * 0.45;
  hubGroup.position.y = 0.15;
}

// Camera-facing canvas-texture label — crisp text rendering
function makeTextSprite(title, sub, colorHex) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Title with glow
  g.font = '800 36px "DM Sans", -apple-system, sans-serif';
  g.fillStyle = '#ffffff';
  g.shadowColor = colorHex || '#00e5ff';
  g.shadowBlur = 14;
  g.fillText(title, 256, 46);

  // Subtitle
  if (sub) {
    g.font = '700 20px "DM Sans", -apple-system, sans-serif';
    g.fillStyle = colorHex || 'rgba(0,229,255,0.85)';
    g.shadowBlur = 6;
    g.fillText(sub, 256, 92);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Sprite(mat);
}

// ═════════════════════════════════════════════════════════════════════
// RADIAL RING — Tapered panels (concerns 3, 4)
// ═════════════════════════════════════════════════════════════════════
function createTaperedPanelGeometry() {
  const shape = new THREE.Shape();
  const innerW = 0.95; // narrower inner edge toward ring center
  const outerW = 1.30; // wider outer edge
  const halfD = 0.72;  // radial depth
  shape.moveTo(-innerW, -halfD);
  shape.lineTo(innerW, -halfD);
  shape.lineTo(outerW, halfD);
  shape.lineTo(-outerW, halfD);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.035,
    bevelThickness: 0.03,
  });
  geo.center(); // Center local pivot at (0, 0, 0)
  geo.rotateX(Math.PI / 2); // Lay flat in XZ with height along Y
  return geo;
}

function buildRing() {
  ringGroup = new THREE.Group();
  ringGroup.visible = false;
  ringGroup.rotation.x = NAV3D_CONFIG.ringTiltX;
  ringGroup.rotation.z = NAV3D_CONFIG.ringTiltZ;
  scene.add(ringGroup);

  const n = NAV3D_TOOLS.length;
  const seg = (Math.PI * 2) / n;
  const panelGeo = getGeometry('panel-wedge', createTaperedPanelGeometry);

  NAV3D_TOOLS.forEach((tool, i) => {
    const hexStr = '#' + tool.color.toString(16).padStart(6, '0');
    const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({
      color: 0x122244,
      metalness: 0.75,
      roughness: 0.35,
      emissive: tool.color,
      emissiveIntensity: 0.28,
      transparent: true,
      opacity: 0,
    }));
    panel.userData.toolIndex = i;

    // Outer edge glowing accent strip
    const accentGeo = getGeometry('panel-accent', () => new THREE.BoxGeometry(1.6, 0.04, 0.08));
    const accentMat = getMaterial(`panel-accent-${tool.id}`, {
      color: tool.color,
      emissive: tool.color,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    const accentMesh = new THREE.Mesh(accentGeo, accentMat);
    accentMesh.position.set(0, 0.11, 0.62);
    panel.add(accentMesh);

    // Angular placement around ring
    const angle = i * seg;
    const r = NAV3D_CONFIG.ringRadius;
    panel.position.set(
      Math.cos(angle) * r,
      0,
      Math.sin(angle) * r
    );
    // Align narrower edge inward, wider edge outward
    panel.rotation.y = -angle + Math.PI / 2;
    panel.userData.homeAngle = angle;

    // Crisp title + subtitle sprite floating just above panel
    const label = makeTextSprite(tool.label.toUpperCase(), tool.sub, hexStr);
    label.scale.set(2.2, 0.55, 1);
    label.position.set(0, 0.32, 0);
    panel.add(label);

    ringGroup.add(panel);
    panelMeshes.push(panel);
  });

  // Ring guide torus (visual continuity)
  ringGuide = new THREE.Mesh(
    getGeometry('ring-guide', () => new THREE.TorusGeometry(NAV3D_CONFIG.ringRadius, 0.038, 8, 96)),
    getMaterial('ring-guide', { color: 0x2979ff, emissive: 0x00e5ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 })
  );
  ringGuide.rotation.x = Math.PI / 2;
  ringGroup.add(ringGuide);
}

// ═════════════════════════════════════════════════════════════════════
// WATER-BUBBLE TRANSITION MESH (concern 7)
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
        p.y *= mix(0.05, 20.0, uProgress);
        p.x *= mix(0.6, 32.0, uProgress);
        p.z *= mix(0.6, 32.0, uProgress);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uProgress;
      varying vec2 vUv;
      void main() {
        float rim = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        vec3 col = mix(vec3(0.0, 0.65, 0.95), vec3(0.0, 0.95, 1.0), vUv.y);
        float alpha = mix(0.85, 0.98, vUv.y) * smoothstep(0.0, 0.08, uProgress);
        gl_FragColor = vec4(col, alpha * mix(0.7, 1.0, rim));
      }`,
  });
  bubbleMesh = new THREE.Mesh(geo, mat);
  bubbleMesh.position.set(0, -6.5, 4);
  bubbleMesh.visible = false;
  scene.add(bubbleMesh);
}

// ═════════════════════════════════════════════════════════════════════
// OPEN / CLOSE TRANSFORMATION (concern 3)
// ═════════════════════════════════════════════════════════════════════
function openRing() {
  if (nav3dState !== NAV3D_STATE.IDLE) return;
  nav3dState = NAV3D_STATE.OPENING;
  ringGroup.visible = true;

  const t0 = performance.now();
  const dur = redMode ? 220 : NAV3D_CONFIG.openDuration;

  // Hub tap pulse feedback
  hubMesh.scale.set(1.15, 0.7, 1.15);
  const pulseEnd = performance.now() + 160;

  const hint = document.getElementById('nav3d-hint');
  if (hint) {
    hint.textContent = 'Drag to rotate ring · Tap panel to open · Esc to close';
    hint.style.opacity = '1';
  }

  function animStep() {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3); // cubic ease-out

    ringGroup.scale.setScalar(0.35 + 0.65 * e);
    ringGroup.rotation.y = (1 - e) * 1.2;
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
    hubGroup.visible = t < 0.5;

    if (t < 1) requestAnimationFrame(animStep);
    else {
      hubGroup.visible = false;
      ringGroup.scale.setScalar(1);
      ringGroup.rotation.y = 0;
      nav3dState = NAV3D_STATE.RING; // RING_INTERACTIVE
    }
  }
  animStep();
}

function attachHubTap() {
  canvas.addEventListener('pointerdown', e => {
    if (nav3dState !== NAV3D_STATE.IDLE) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    if (rc.intersectObjects([hubMesh, hubHalo], true).length) {
      openRing();
    }
  });
}

function closeRing() {
  if (nav3dState !== NAV3D_STATE.RING) return;
  nav3dState = NAV3D_STATE.IDLE;
  const t0 = performance.now();
  const dur = redMode ? 180 : NAV3D_CONFIG.closeDuration;
  const startScale = ringGroup.scale.x, startRotY = ringGroup.rotation.y;

  const hint = document.getElementById('nav3d-hint');
  if (hint) {
    hint.textContent = 'Tap the hub to enter · Drag around to rotate';
    hint.style.opacity = '1';
  }

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
      nav3dState = NAV3D_STATE.IDLE;
    }
  }
  animStep();
}

// ═════════════════════════════════════════════════════════════════════
// GESTURE: circular drag + tap-vs-drag (concern 5)
// ═════════════════════════════════════════════════════════════════════
function pointerAngle(x, y) {
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
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('pointermove', e => {
    // Hover cursor feedback
    if (!isDragging) {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);

      if (nav3dState === NAV3D_STATE.IDLE) {
        const hits = rc.intersectObjects([hubMesh, hubHalo], true);
        canvas.style.cursor = hits.length ? 'pointer' : 'default';
      } else if (nav3dState === NAV3D_STATE.RING) {
        const hits = rc.intersectObjects(panelMeshes, true);
        canvas.style.cursor = hits.length ? 'pointer' : 'grab';
      }
    }

    if (!isDragging || nav3dState !== NAV3D_STATE.RING) return;
    const dist = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
    if (dist > 10) movedBeyondThreshold = true;

    const a = pointerAngle(e.clientX, e.clientY);
    let d = a - lastPointerAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    dragVel = d;
    ringGroup.rotation.y += d;
    lastPointerAngle = a;
  });

  canvas.addEventListener('pointerup', e => {
    const wasDragging = isDragging;
    isDragging = false;
    canvas.style.cursor = nav3dState === NAV3D_STATE.RING ? 'grab' : 'default';
    if (nav3dState !== NAV3D_STATE.RING) return;

    if (wasDragging && !movedBeyondThreshold) {
      handleTap(e.clientX, e.clientY);
    } else if (Math.abs(dragVel) > 0.05) {
      dragVel *= NAV3D_CONFIG.flickGain;
    } else {
      dragVel = 0;
    }
  });
}

function handleTap(x, y) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((x - r.left) / r.width) * 2 - 1,
    -((y - r.top) / r.height) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hits = rc.intersectObjects(panelMeshes, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && obj.userData.toolIndex === undefined && obj !== ringGroup) {
      obj = obj.parent;
    }
    if (obj && obj.userData.toolIndex !== undefined) {
      selectPanel(obj.userData.toolIndex);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
// SELECTION + BUBBLE TRANSITION (concerns 6, 7)
// ═════════════════════════════════════════════════════════════════════
function selectPanel(idx) {
  if (nav3dState !== NAV3D_STATE.RING) return;
  const tool = NAV3D_TOOLS[idx];
  const panel = panelMeshes[idx];

  nav3dState = NAV3D_STATE.TO_TOOL;
  activeToolId = tool.id;
  lastRingRotation = ringGroup.rotation.y;

  // Tactile selection feedback
  panel.scale.set(1.1, 0.85, 1.1);
  panel.material.emissiveIntensity = 1.4;

  const delay = redMode ? 100 : 260;
  setTimeout(() => startBubble(tool), delay);
}

function startBubble(tool) {
  bubbleMesh.visible = true;
  bubbleT = 0;
  const dur = redMode ? 240 : 560;

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
  ringGroup.visible = false;
  bubbleMesh.visible = false;
  canvas.style.display = 'none';
  const ov = document.getElementById('nav3d-overlay');
  if (ov) ov.classList.remove('active');
  const backBtn = document.getElementById('nav3d-back');
  if (backBtn) backBtn.style.display = 'inline-flex';
  nav3dState = NAV3D_STATE.TOOL;
  if (window.showScreen) window.showScreen(tool.id);
}

function backToHub() {
  if (nav3dState !== NAV3D_STATE.TOOL) return;
  nav3dState = NAV3D_STATE.TO_HUB;

  const ov = document.getElementById('nav3d-overlay');
  if (ov) ov.classList.add('active');
  const backBtn = document.getElementById('nav3d-back');
  if (backBtn) backBtn.style.display = 'none';
  canvas.style.display = '';

  const dur = redMode ? 220 : 460;
  bubbleMesh.visible = true;
  const t0 = performance.now();
  function animStep() {
    const p = Math.min(1, (performance.now() - t0) / dur);
    bubbleMesh.material.uniforms.uProgress.value = 1 - p;
    if (p < 1) requestAnimationFrame(animStep);
    else {
      bubbleMesh.visible = false;
      ringGroup.visible = true;
      ringGroup.rotation.y = lastRingRotation; // Exact rotational restoration
      panelMeshes.forEach(pm => {
        pm.scale.set(1, 1, 1);
        pm.material.emissiveIntensity = 0.28;
      });
      nav3dState = NAV3D_STATE.RING; // Restored interactive ring state
    }
  }
  animStep();
}

// ═════════════════════════════════════════════════════════════════════
// ANIMATION LOOP (concerns: idle bobbing, inertia, snap)
// ═════════════════════════════════════════════════════════════════════
function nav3dLoop() {
  requestAnimationFrame(nav3dLoop);
  if (renderPaused || document.hidden || !renderer || !scene || !camera) return;
  const dt = Math.min(clock.getDelta(), 0.05);

  idleT += dt;
  if (nav3dState === NAV3D_STATE.IDLE) {
    // Gentle float + tilt
    if (!redMode) {
      hubGroup.position.y = 0.15 + Math.sin(idleT * 1.3) * 0.12;
      hubGroup.rotation.x = NAV3D_CONFIG.ringTiltX * 0.45 + Math.sin(idleT * 0.75) * 0.05;
      hubGroup.rotation.z = Math.cos(idleT * 0.6) * 0.04;
    }
  } else if (nav3dState === NAV3D_STATE.RING) {
    // Inertia friction
    if (!redMode && !isDragging && Math.abs(dragVel) > 0.0015) {
      ringGroup.rotation.y += dragVel;
      dragVel *= NAV3D_CONFIG.inertia;
    }
    // Subtle snap
    if (!redMode && !isDragging && Math.abs(dragVel) <= 0.0015) {
      const seg = (Math.PI * 2) / NAV3D_TOOLS.length;
      const n = Math.round(ringGroup.rotation.y / seg);
      const target = n * seg;
      ringGroup.rotation.y += (target - ringGroup.rotation.y) * 0.08;
    }
    // Gentle ring bobbing
    if (!redMode && !isDragging) {
      ringGroup.position.y = Math.sin(idleT * 1.1) * 0.08;
      ringGroup.rotation.x = NAV3D_CONFIG.ringTiltX + Math.sin(idleT * 0.6) * 0.03;
      ringGroup.rotation.z = NAV3D_CONFIG.ringTiltZ + Math.cos(idleT * 0.5) * 0.025;
    }
  }

  renderer.render(scene, camera);
}

// ═════════════════════════════════════════════════════════════════════
// KEYBOARD ACCESSIBILITY
// ═════════════════════════════════════════════════════════════════════
function bindKeyboard() {
  window.addEventListener('keydown', e => {
    if (nav3dState === NAV3D_STATE.IDLE && (e.key === 'Enter' || e.key === ' ')) {
      openRing();
      e.preventDefault();
    } else if (nav3dState === NAV3D_STATE.RING) {
      const seg = (Math.PI * 2) / NAV3D_TOOLS.length;
      if (e.key === 'ArrowLeft') {
        ringGroup.rotation.y -= seg;
        dragVel = 0;
      } else if (e.key === 'ArrowRight') {
        ringGroup.rotation.y += seg;
        dragVel = 0;
      } else if (e.key === 'Escape') {
        closeRing();
      }
      e.preventDefault();
    } else if (nav3dState === NAV3D_STATE.TOOL && e.key === 'Escape') {
      backToHub();
    }
  });
}

// ═════════════════════════════════════════════════════════════════════
// NON-WEBGL FALLBACK & DISPOSE
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

function nav3dDispose() {
  cancelAnimationFrame(nav3dLoop);
  window.removeEventListener('resize', nav3dResize);
  renderer && renderer.dispose();
  Object.values(geoCache).forEach(o => o.dispose && o.dispose());
  Object.values(matCache).forEach(o => o.dispose && o.dispose());
  geoCache = {};
  matCache = {};
}

// Robust auto-boot
function tryInitNav3D() {
  if (window.THREE) {
    nav3dInit();
  } else {
    window.addEventListener('app:ready', e => {
      if (e.detail && e.detail.three) nav3dInit();
      else nav3dFallback('three.js failed to load');
    }, { once: true });
    // Safety fallback
    setTimeout(() => {
      if (!window.THREE && !renderer) {
        nav3dFallback('three.js load timeout');
      }
    }, 3000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryInitNav3D);
} else {
  tryInitNav3D();
}

// Expose public API
window.nav3d = {
  openRing,
  closeRing,
  backFromTool: backToHub,
  backToHubFn: backToHub,
  state: () => nav3dState,
  tools: NAV3D_TOOLS,
  resume() {
    renderPaused = false;
    if (!renderer && window.THREE) nav3dInit();
  },
  debug() {
    return { hub: hubGroup, ring: ringGroup, scene, camera, renderer };
  },
};
