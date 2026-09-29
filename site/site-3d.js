/* AdLedger website: the 3D product story (progressive enhancement, ES module, no build step).
   A floating device shows the Overview screen. Scrolling orbits the camera and takes the dashboard
   apart into layered panels cut from the real screenshots; each chapter lifts one panel out, lights it
   in the brand colour and ties it to its HTML note with a connector line. The last chapter puts the
   device back together.
   It runs only when <head> set .want-3d (768px+, no reduced motion, WebGL2). Three.js comes from a
   pinned CDN build (see the import map) and loads only when the story nears the viewport. The canvas
   is decoration: every note is ordinary HTML in reading order, so the page reads the same without it. */

const root = document.documentElement;
const story = document.querySelector("[data-story]");
const QUALIFY = "(min-width: 768px) and (min-height: 500px) and (prefers-reduced-motion: no-preference)";

// The screenshots are 1600×1000 CSS pixels captured at 2x (docs/screenshots).
const IMG_W = 3200;
const IMG_H = 2000;
const SCREEN_W = 16;
const SCREEN_H = 10;
const FOV = 30;

/* Panels cut from the screenshots. crop = [x, y, w, h] in screenshot pixels, width in world units,
   at = where the panel floats when the dashboard is taken apart. "screen" panels sit exactly over the
   device screen when assembled; the rest tuck inside the device. */
const PANELS = [
  { key: "kpis", src: "overview", crop: [544, 276, 2592, 248], width: 10.4, at: [-1.4, 6.9, 2.4], screen: true },
  { key: "chart", src: "overview", crop: [544, 660, 2592, 760], width: 9.2, at: [-4.4, 1.3, 4.3], screen: true },
  { key: "attribution", src: "performance", crop: [544, 224, 2592, 1120], width: 8.6, at: [6.0, -1.5, 3.0] },
  { key: "live", src: "live", crop: [544, 806, 1498, 1120], width: 5.0, at: [-11.0, -2.8, 1.5] },
  { key: "pipeline", src: "pipeline", crop: [480, 104, 2720, 1880], width: 6.0, at: [11.2, 3.9, 0.7] },
  { key: "reports", src: "reports", crop: [544, 496, 842, 930], width: 3.4, at: [-10.4, 4.6, 0.4] },
  { key: "ai", src: "insights-ask", crop: [544, 304, 1792, 806], width: 6.6, at: [-1.6, -7.1, 3.3] },
  { key: "security", width: 17.2, height: 10.75, at: [0, 0, -3.8], back: true },
];

/* One key per scroll stop: the hero, "take it apart", eight chapters, and the reassembly.
   az/el orbit the camera (degrees) around the focus; the card side comes from the chapter's data-side. */
const KEYS = [
  { focus: "device", az: 0, el: 6, explode: 0, below: "hero", fit: 0.7, overflow: 1.6 },
  { focus: "all", az: -16, el: 11, explode: 1, below: "note", fit: 0.96 },
  { focus: "kpis", az: -12, el: 12, explode: 1 },
  { focus: "chart", az: 15, el: 4, explode: 1 },
  { focus: "attribution", az: -20, el: -3, explode: 1 },
  { focus: "live", az: 24, el: 7, explode: 1 },
  { focus: "pipeline", az: -26, el: 12, explode: 1 },
  { focus: "reports", az: 22, el: 14, explode: 1 },
  { focus: "ai", az: -12, el: -10, explode: 1 },
  { focus: "security", az: 152, el: 16, explode: 1, fit: 0.92 },
  { focus: "device", az: 360, el: 5, explode: 0, below: "note", fit: 0.62 },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const damp = (dt, lambda) => 1 - Math.exp(-lambda * dt);

/* rounded rectangle path for both canvas 2D contexts and THREE.Shape */
function rr(p, x, y, w, h, r) {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
}

/* CSS colour tokens (oklch) to sRGB through a 1×1 canvas */
const probe = document.createElement("canvas");
probe.width = probe.height = 1;
const probeCtx = probe.getContext("2d", { willReadFrequently: true });
function token(name, fallback) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = fallback;
  if (v) probeCtx.fillStyle = v;
  probeCtx.fillRect(0, 0, 1, 1);
  const d = probeCtx.getImageData(0, 0, 1, 1).data;
  return { rgb: [d[0], d[1], d[2]], css: `rgb(${d[0]},${d[1]},${d[2]})`, a: d[3] / 255 };
}
const rgba = (t, a) => `rgba(${t.rgb[0]},${t.rgb[1]},${t.rgb[2]},${a})`;

if (story) boot();

function boot() {
  const mq = matchMedia(QUALIFY);
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  let app = null;
  let starting = false;
  let near = false;

  const fail = (err) => {
    if (err) console.warn("AdLedger 3D story disabled:", err);
    if (app) app.destroy();
    app = null;
    root.classList.remove("want-3d", "has-3d");
    root.classList.add("no-3d");
  };

  const start = async () => {
    if (app || starting || !near || !mq.matches || root.classList.contains("no-3d")) return;
    starting = true;
    try {
      const [THREE, env] = await Promise.all([
        import("three"),
        import("three/addons/environments/RoomEnvironment.js"),
      ]);
      if (!mq.matches) return;
      app = createStory(THREE, env.RoomEnvironment, darkMq, fail);
    } catch (err) {
      fail(err);
    } finally {
      starting = false;
    }
  };

  if (!root.classList.contains("want-3d")) {
    // The head script decided against 3D (phone, reduced motion or no WebGL2); still follow resizes.
    if (!window.WebGL2RenderingContext) return;
  }

  new IntersectionObserver((entries) => {
    near = entries.some((e) => e.isIntersecting);
    if (near) start();
  }, { rootMargin: "400px 0px" }).observe(story);

  const onQualify = () => {
    if (mq.matches && !root.classList.contains("no-3d")) {
      root.classList.add("want-3d");
      start();
    } else {
      if (app) app.destroy();
      app = null;
      root.classList.remove("want-3d", "has-3d");
    }
  };
  mq.addEventListener("change", onQualify);
}

function createStory(THREE, RoomEnvironment, darkMq, fail) {
  const stage = story.querySelector(".stage");
  const canvas = stage.querySelector(".stage-canvas");
  const wire = stage.querySelector(".wire");
  const wirePath = wire.querySelector(".wire-path");
  const wireRing = wire.querySelector(".wire-ring");
  const wireDot = wire.querySelector(".wire-dot");
  const wireEnd = wire.querySelector(".wire-end");
  const storyNav = stage.querySelector(".story-nav");
  const heroCopy = story.querySelector(".hero-copy");
  const chapters = Array.from(story.querySelectorAll(".chapter"));
  const notes = chapters.map((c) => c.querySelector(".note"));
  if (chapters.length !== KEYS.length - 1) throw new Error("chapter count does not match the 3D keys");

  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  /* ---------- renderer, camera, environment ---------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    fail(err);
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let quality = 1;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2) * quality;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = keep(pmrem.fromScene(room, 0.04));
  scene.environment = envRT.texture;
  room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 1, 400);
  const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  /* ---------- colours ---------- */
  let pal;
  const readPalette = () => {
    pal = {
      dark: darkMq.matches,
      brand: token("--brand", "#2f9e6e"),
      brand2: token("--brand-2", "#2a9aa3"),
      fg: token("--fg", "#1d2321"),
      muted: token("--fg-muted", "#5f6865"),
      surface: token("--surface", "#ffffff"),
      border: token("--border-strong", "#d3d8d6"),
    };
  };
  readPalette();

  /* ---------- textures ---------- */
  // Screenshots load as images once; the device screen uses the whole image and each panel gets its
  // own texture cropped at full resolution, so no GPU memory is spent on parts nobody sees.
  const images = new Map();
  const loadImg = (name) => {
    if (!images.has(name)) {
      const img = new Image();
      img.decoding = "async";
      img.src = `screenshots/${name}.png`;
      images.set(name, img.decode().then(() => img));
    }
    return images.get(name);
  };
  const imageTex = (source) => {
    const tex = keep(new THREE.Texture(source));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  const cropTex = (img, crop) => {
    const scale = Math.min(1, 2048 / Math.max(crop[2], crop[3]));
    const c = document.createElement("canvas");
    c.width = Math.round(crop[2] * scale);
    c.height = Math.round(crop[3] * scale);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, c.width, c.height);
    return imageTex(c);
  };
  // Sample text-heavy textures a little sharper than the default mip level (UI text stays crisp at an angle).
  const sharpen = (mat) => {
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
#ifdef USE_MAP
  diffuseColor *= texture2D( map, vMapUv, -0.65 );
#endif`);
    };
    mat.customProgramCacheKey = () => "sharp";
    return mat;
  };
  const canvasTex = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const tex = keep(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  };
  const roundedGeo = (w, h, r) => {
    const s = new THREE.Shape();
    rr(s, -w / 2, -h / 2, w, h, r);
    const g = keep(new THREE.ShapeGeometry(s, 10));
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + w / 2) / w;
      const v = (pos.getY(i) + h / 2) / h;
      uv.setXY(i, u, v);
    }
    return g;
  };
  const basic = (opts) => keep(new THREE.MeshBasicMaterial({ toneMapped: false, ...opts }));

  /* ---------- the device ---------- */
  const rig = new THREE.Group();
  scene.add(rig);

  const BODY_W = 16.9;
  const BODY_H = 10.9;
  const BODY_D = 0.3;
  const BEVEL = 0.08;
  const bodyShape = new THREE.Shape();
  rr(bodyShape, -BODY_W / 2, -BODY_H / 2, BODY_W, BODY_H, 0.7);
  const bodyGeo = keep(new THREE.ExtrudeGeometry(bodyShape, { depth: BODY_D, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 12 }));
  bodyGeo.translate(0, 0, -BODY_D / 2);
  const FRONT = BODY_D / 2 + BEVEL;
  const bodyMat = keep(new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.3 }));
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  rig.add(body);

  const glassMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x0a0c0b, metalness: 0, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const glass = new THREE.Mesh(roundedGeo(16.56, 10.56, 0.5), glassMat);
  glass.position.z = FRONT + 0.004;
  rig.add(glass);

  const screenMat = sharpen(basic({ color: 0xffffff }));
  const screen = new THREE.Mesh(roundedGeo(SCREEN_W, SCREEN_H, 0.14), screenMat);
  screen.position.z = FRONT + 0.008;
  rig.add(screen);

  const sheenTex = canvasTex(512, 4, (ctx, w) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.42, "rgba(255,255,255,0.05)");
    g.addColorStop(0.5, "rgba(255,255,255,0.9)");
    g.addColorStop(0.58, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 4);
  });
  sheenTex.repeat.set(0.55, 1);
  const sheenMat = basic({ map: sheenTex, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
  const sheen = new THREE.Mesh(roundedGeo(SCREEN_W, SCREEN_H, 0.14), sheenMat);
  sheen.position.z = FRONT + 0.012;
  sheen.renderOrder = 1;
  rig.add(sheen);

  let logoTex = null;
  const logoMat = basic({ transparent: true, depthWrite: false });
  const logo = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.2, 2.2)), logoMat);
  logo.position.z = -FRONT - 0.004;
  logo.rotation.y = Math.PI;
  rig.add(logo);

  const shadowTex = canvasTex(256, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.45, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.setTransform(1, 0, 0, 0.5, 0, h / 4);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 2);
  });
  const floorMat = basic({ map: shadowTex, transparent: true, depthWrite: false });
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 6)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -SCREEN_H / 2 - 2.1;
  scene.add(floor);

  /* ---------- panels ---------- */
  const panelByKey = {};
  const panels = PANELS.map((def, i) => {
    const w = def.width;
    const h = def.height || (w * def.crop[3]) / def.crop[2];
    const r = Math.min(0.22, h * 0.08);
    const group = new THREE.Group();
    const M = 1.1;
    const haloTex = canvasTex(256, Math.max(48, Math.round((256 * (h + 2 * M)) / (w + 2 * M))), (ctx, cw) => {
      const k = cw / (w + 2 * M);
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = M * k * 0.75;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      rr(ctx, M * k, M * k, w * k, h * k, r * k);
      ctx.fill();
      // keep only the glow outside the panel, so see-through panels are not tinted
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      rr(ctx, M * k + 2, M * k + 2, w * k - 4, h * k - 4, r * k);
      ctx.fill();
    });
    const halo = new THREE.Mesh(keep(new THREE.PlaneGeometry(w + 2 * M, h + 2 * M)), basic({ map: haloTex, transparent: true, depthWrite: false }));
    halo.position.z = -0.06;
    const plate = new THREE.Mesh(roundedGeo(w + 0.07, h + 0.07, r + 0.035), basic({ transparent: true, depthWrite: false }));
    plate.position.z = -0.012;
    const face = new THREE.Mesh(roundedGeo(w, h, r), sharpen(basic({ transparent: true, depthWrite: false })));
    group.add(halo, plate, face);
    if (def.key === "security") plate.visible = false;
    rig.add(group);

    const scr = def.screen
      ? {
        x: ((def.crop[0] + def.crop[2] / 2) / IMG_W - 0.5) * SCREEN_W,
        y: (0.5 - (def.crop[1] + def.crop[3] / 2) / IMG_H) * SCREEN_H,
        s: ((def.crop[2] / IMG_W) * SCREEN_W) / w,
      }
      : null;
    const home = scr
      ? new THREE.Vector3(scr.x, scr.y, FRONT + 0.016 + i * 0.002)
      : new THREE.Vector3(0, 0, def.back ? -0.02 : -0.05);
    const p = {
      def, i, w, h, group, halo, plate, face,
      home,
      homeScale: scr ? scr.s : def.back ? 0.92 : 0.35,
      at: new THREE.Vector3(...def.at),
      rotY: def.back ? Math.PI : clamp(-def.at[0] * 0.022, -0.3, 0.3),
      rotX: def.back ? 0 : clamp(def.at[1] * 0.02, -0.18, 0.18),
      focus: 0,
      delay: i * 0.05,
    };
    panelByKey[def.key] = p;
    return p;
  });

  /* ---------- the security layer: a glass sheet drawn on a canvas ---------- */
  const secCanvas = document.createElement("canvas");
  secCanvas.width = 1600;
  secCanvas.height = 1000;
  const secTex = keep(new THREE.CanvasTexture(secCanvas));
  secTex.colorSpace = THREE.SRGBColorSpace;
  secTex.anisotropy = maxAniso;
  const drawSecurity = () => {
    const ctx = secCanvas.getContext("2d");
    const W = secCanvas.width;
    const H = secCanvas.height;
    const { brand, brand2, fg, muted, surface } = pal;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    rr(ctx, 6, 6, W - 12, H - 12, 60);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, rgba(brand, pal.dark ? 0.2 : 0.16));
    g.addColorStop(1, rgba(brand2, pal.dark ? 0.08 : 0.07));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = rgba(brand, 0.1);
    ctx.lineWidth = 2;
    for (let x = 80; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 80; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
    ctx.beginPath();
    rr(ctx, 6, 6, W - 12, H - 12, 60);
    ctx.strokeStyle = rgba(brand, 0.85);
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = brand.css;
    ctx.font = '500 30px "Geist Mono", ui-monospace, monospace';
    ctx.textBaseline = "middle";
    ctx.fillText("SECURITY LAYER", 70, 86);
    ctx.textAlign = "right";
    ctx.fillStyle = muted.css;
    ctx.fillText("ON BY DEFAULT", W - 70, 86);
    ctx.textAlign = "left";

    // shield with a lock
    const cx = W / 2;
    const y0 = 150;
    const s = 380;
    ctx.beginPath();
    ctx.moveTo(cx, y0);
    ctx.bezierCurveTo(cx + s * 0.25, y0 + s * 0.1, cx + s * 0.4, y0 + s * 0.1, cx + s * 0.5, y0 + s * 0.12);
    ctx.bezierCurveTo(cx + s * 0.5, y0 + s * 0.6, cx + s * 0.32, y0 + s * 0.92, cx, y0 + s * 1.08);
    ctx.bezierCurveTo(cx - s * 0.32, y0 + s * 0.92, cx - s * 0.5, y0 + s * 0.6, cx - s * 0.5, y0 + s * 0.12);
    ctx.bezierCurveTo(cx - s * 0.4, y0 + s * 0.1, cx - s * 0.25, y0 + s * 0.1, cx, y0);
    ctx.closePath();
    ctx.fillStyle = rgba(brand, 0.16);
    ctx.fill();
    ctx.shadowColor = rgba(brand, 0.8);
    ctx.shadowBlur = 40;
    ctx.strokeStyle = brand.css;
    ctx.lineWidth = 12;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, y0 + s * 0.46, s * 0.11, Math.PI, 0);
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.beginPath();
    rr(ctx, cx - s * 0.18, y0 + s * 0.46, s * 0.36, s * 0.27, 18);
    ctx.fillStyle = brand.css;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, y0 + s * 0.57, 13, 0, Math.PI * 2);
    ctx.fillStyle = pal.dark ? "#10201a" : "#ffffff";
    ctx.fill();

    // three controls
    const chips = ["Two-factor sign-in", "Hash-chained audit log", "AES-256-GCM secrets"];
    ctx.font = '600 34px "Geist", system-ui, sans-serif';
    const pad = 34;
    const gap = 26;
    const widths = chips.map((t) => ctx.measureText(t).width + pad * 2 + 44);
    let x = (W - (widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1))) / 2;
    const cy = 660;
    chips.forEach((t, i) => {
      ctx.beginPath();
      rr(ctx, x, cy - 38, widths[i], 76, 38);
      ctx.fillStyle = rgba(surface, pal.dark ? 0.55 : 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(brand, 0.55);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + pad + 12, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = brand.css;
      ctx.fill();
      ctx.fillStyle = fg.css;
      ctx.fillText(t, x + pad + 40, cy + 2);
      x += widths[i] + gap;
    });

    // the audit chain
    const blocks = ["#5 3e1a", "#6 7f3a", "#7 91c2", "#8 7598"];
    const bw = 250;
    const bh = 76;
    const bg = 70;
    let bx = (W - (bw * blocks.length + bg * (blocks.length - 1))) / 2;
    const by = 820;
    ctx.font = '500 30px "Geist Mono", ui-monospace, monospace';
    blocks.forEach((t, i) => {
      const last = i === blocks.length - 1;
      ctx.beginPath();
      rr(ctx, bx, by - bh / 2, bw, bh, 16);
      ctx.fillStyle = last ? brand.css : rgba(surface, pal.dark ? 0.4 : 0.75);
      ctx.fill();
      ctx.strokeStyle = rgba(brand, last ? 1 : 0.5);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = last ? (pal.dark ? "#0d1a15" : "#ffffff") : fg.css;
      ctx.textAlign = "center";
      ctx.fillText(t, bx + bw / 2, by + 2);
      ctx.textAlign = "left";
      if (!last) {
        ctx.beginPath();
        ctx.moveTo(bx + bw + 10, by);
        ctx.lineTo(bx + bw + bg - 10, by);
        ctx.strokeStyle = rgba(brand, 0.8);
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      bx += bw + bg;
    });
    ctx.fillStyle = muted.css;
    ctx.font = '500 26px "Geist", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Every entry hashes the one before it. Verify shows any edit.", W / 2, 918);
    ctx.textAlign = "left";
    secTex.needsUpdate = true;
  };
  const sec = panelByKey.security;
  sec.face.material.map = secTex;
  sec.face.material.needsUpdate = true;

  const drawLogo = () => {
    if (logoTex) logoTex.dispose();
    logoTex = canvasTex(256, 256, (ctx) => {
      ctx.scale(8, 8);
      ctx.beginPath();
      rr(ctx, 0, 0, 32, 32, 8);
      ctx.fillStyle = pal.dark ? "rgba(255,255,255,0.14)" : "rgba(20,28,25,0.16)";
      ctx.fill();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = pal.dark ? "rgba(255,255,255,0.75)" : "rgba(20,28,25,0.7)";
      ctx.stroke(new Path2D("M8 22.5 13.5 15l4 4L24 9.5"));
      ctx.beginPath();
      ctx.arc(24, 9.5, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = pal.brand.css;
      ctx.fill();
    });
    logoMat.map = logoTex;
    logoMat.needsUpdate = true;
  };

  /* ---------- theme: device finish, panel frames and which Overview screenshot to show ---------- */
  const shadowColor = new THREE.Color();
  const brandColor = new THREE.Color();
  const borderColor = new THREE.Color();
  const surfaceColor = new THREE.Color();
  const applyTheme = () => {
    readPalette();
    bodyMat.color.set(pal.dark ? 0x3a403e : 0xcdd3d1);
    bodyMat.roughness = pal.dark ? 0.36 : 0.28;
    brandColor.set(pal.brand.css);
    borderColor.set(pal.border.css);
    surfaceColor.set(pal.surface.css);
    shadowColor.set(pal.dark ? 0x000000 : 0x0b1a14);
    sheenMat.opacity = pal.dark ? 0.035 : 0.06;
    drawLogo();
    drawSecurity();
  };
  const onTheme = () => { applyTheme(); };
  on(darkMq, "change", onTheme);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) drawSecurity(); });

  /* ---------- layout: where each chapter sits on the page and how each key frames its focus ---------- */
  const size = { w: 1, h: 1, top: 0, navH: 0 };
  let mids = [];
  const keyState = KEYS.map(() => ({ target: new THREE.Vector3(), dist: 40, dx: 0, dy: 0, side: 0 }));
  const allBox = new THREE.Box3();
  PANELS.forEach((def, i) => {
    if (def.back) return;
    const p = panels[i];
    allBox.expandByPoint(new THREE.Vector3(def.at[0] - p.w / 2, def.at[1] - p.h / 2, def.at[2]));
    allBox.expandByPoint(new THREE.Vector3(def.at[0] + p.w / 2, def.at[1] + p.h / 2, def.at[2]));
  });
  const allCenter = allBox.getCenter(new THREE.Vector3());
  const allSize = allBox.getSize(new THREE.Vector3());

  const focusInfo = (focus) => {
    if (focus === "device") return { c: new THREE.Vector3(0, 0, 0), w: BODY_W, h: BODY_H };
    if (focus === "all") return { c: allCenter.clone(), w: allSize.x, h: allSize.y };
    const p = panelByKey[focus];
    return { c: p.at.clone(), w: p.w, h: p.h };
  };

  const measure = () => {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (!W || !H) return;
    size.w = W;
    size.h = H;
    size.navH = parseFloat(getComputedStyle(stage).top) || 0;
    renderer.setPixelRatio(dpr());
    renderer.setSize(W, H, false);
    camera.aspect = W / H;

    const sy = window.scrollY;
    const storyRect = story.getBoundingClientRect();
    const stageCenter = size.navH + H / 2;
    mids = [Math.max(0, storyRect.top + sy - size.navH)];
    chapters.forEach((li) => {
      const r = li.getBoundingClientRect();
      mids.push(Math.max(mids[mids.length - 1] + 1, r.top + sy + r.height / 2 - stageCenter));
    });

    KEYS.forEach((key, j) => {
      const st = keyState[j];
      const info = focusInfo(key.focus);
      st.target.copy(info.c);
      let hp;
      if (key.below) {
        let below;
        if (key.below === "hero") {
          below = heroCopy.getBoundingClientRect().bottom - storyRect.top;
        } else {
          const note = notes[j - 1];
          below = (parseFloat(getComputedStyle(note).top) || 0) - size.navH + note.offsetHeight;
        }
        const top = below + 36;
        const avail = Math.max(H * 0.3, (H - top - 28) * (key.overflow || 1));
        hp = Math.min(avail, (key.fit * W * info.h) / info.w);
        st.dx = 0;
        st.dy = top + hp / 2 - H / 2;
        st.side = 0;
      } else {
        const li = chapters[j - 1];
        const side = li.dataset.side === "left" ? -1 : li.dataset.side === "right" ? 1 : 0;
        const nr = notes[j - 1].getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        // free space beside the note card
        let free = W;
        let center = W / 2;
        if (side === 1) { free = nr.left - sr.left - 40; center = free / 2 + 8; }
        if (side === -1) { const l = nr.right - sr.left + 40; free = W - l; center = l + free / 2 - 8; }
        hp = Math.min(((key.fit || 0.72) * free * info.h) / info.w, H * 0.56);
        st.dx = center - W / 2;
        st.dy = key.focus === "security" ? -H * 0.02 : 0;
        st.side = side;
      }
      st.dist = (info.h * H) / (2 * tanV * Math.max(40, hp));
    });
    computeStops();
    onScroll();
  };

  /* ---------- scroll + pointer input ---------- */
  let pTarget = 0;
  let p = -1;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onScroll = () => {
    const y = window.scrollY;
    if (!mids.length || y <= mids[0]) { pTarget = 0; return; }
    const n = mids.length - 1;
    if (y >= mids[n]) { pTarget = n; return; }
    let i = 0;
    while (i < n - 1 && y >= mids[i + 1]) i++;
    pTarget = i + (y - mids[i]) / (mids[i + 1] - mids[i]);
    wake();
  };
  on(window, "scroll", onScroll, { passive: true });
  on(window, "pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // links to a chapter land where its key is fully settled (the chapter's centre, not its top)
  const chapterIndex = (hash) => {
    if (!hash || hash.length < 2) return -1;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return -1;
    if (el.id === "product") return 1;
    const li = el.closest(".chapter");
    return li && story.contains(li) ? chapters.indexOf(li) + 1 : -1;
  };
  on(document, "click", (e) => {
    const a = e.target.closest && e.target.closest("a[href^='#']");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const j = chapterIndex(a.getAttribute("href"));
    if (j < 0) return;
    e.preventDefault();
    animateTo(mids[j]);
    history.replaceState(null, "", a.getAttribute("href"));
  });

  /* ---------- one gesture, one step ----------
     Every stop on the page (each chapter, then each section) is a scroll-snap point in CSS. Here a
     wheel, key or swipe moves exactly one stop with an eased glide, and the rest of that gesture
     (trackpad momentum) is ignored, so the story never rests between two chapters. A section taller
     than the screen scrolls normally inside, then steps on at its edge. */
  let stops = [];
  const computeStops = () => {
    const sy = window.scrollY;
    const avail = window.innerHeight - size.navH;
    const list = mids.map((y) => ({ y, end: y }));
    const storyEnd = story.getBoundingClientRect().bottom + sy;
    document.querySelectorAll("[data-snap]").forEach((el) => {
      if (story.contains(el)) return;
      const r = el.getBoundingClientRect();
      const y = r.top + sy - size.navH;
      if (y < storyEnd - avail) return;
      // only a section clearly taller than the screen scrolls inside; a few pixels over still steps
      const extra = r.height - avail;
      list.push({ y, end: y + (extra > 48 ? extra : 0) });
    });
    const max = document.documentElement.scrollHeight - window.innerHeight;
    list.push({ y: max, end: max });
    stops = list.map((s) => ({ y: Math.min(max, Math.round(s.y)), end: Math.min(max, Math.round(s.end)) })).sort((a, b) => a.y - b.y);
  };
  let glide = 0;
  let gliding = false;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function animateTo(to) {
    cancelAnimationFrame(glide);
    const from = window.scrollY;
    if (Math.abs(to - from) < 2) return;
    const dur = Math.min(1250, 700 + Math.abs(to - from) * 0.18);
    const t0 = performance.now();
    gliding = true;
    root.style.scrollSnapType = "none";
    root.style.scrollBehavior = "auto";
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, from + (to - from) * easeInOut(t));
      if (t < 1) { glide = requestAnimationFrame(tick); return; }
      gliding = false;
      root.style.scrollSnapType = "";
      root.style.scrollBehavior = "";
    };
    glide = requestAnimationFrame(tick);
  }
  cleanups.push(() => { cancelAnimationFrame(glide); root.style.scrollSnapType = ""; root.style.scrollBehavior = ""; });
  // where one step in `dir` goes, or null to let the page scroll natively (inside a tall section)
  const nextStop = (dir) => {
    if (!stops.length) return null;
    const y = window.scrollY;
    let c = 0;
    for (let i = 0; i < stops.length; i++) if (stops[i].y <= y + 4) c = i;
    const cur = stops[c];
    if (dir > 0) {
      if (y < cur.end - 4) return null;
      const n = stops[c + 1];
      return n ? n.y : null;
    }
    if (y > cur.y + 4) return cur.end > cur.y ? null : cur.y;
    const prev = stops[c - 1];
    return prev ? prev.end : null;
  };
  let lastInput = 0;
  let quietUntil = 0;
  const tryStep = (dir, e) => {
    const to = nextStop(dir);
    if (to === null) return false;
    if (e) e.preventDefault();
    const now = performance.now();
    const gap = now - lastInput;
    lastInput = now;
    // one gesture = one step: ignore input while gliding and until the gesture goes quiet
    if (gliding || now < quietUntil || gap < 140) return true;
    quietUntil = now + 450;
    animateTo(to);
    return true;
  };
  on(window, "wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX) || !e.deltaY) return;
    tryStep(Math.sign(e.deltaY), e);
  }, { passive: false });
  on(window, "keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, button, summary, [contenteditable], [role=tab], [role=tablist]")) return;
    const down = e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey);
    const up = e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey);
    if (!down && !up) return;
    lastInput = 0;
    tryStep(down ? 1 : -1, e);
  });
  let touchY = null;
  on(window, "touchstart", (e) => { touchY = e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
  on(window, "touchmove", (e) => {
    if (touchY === null) return;
    const dy = touchY - e.touches[0].clientY;
    if (Math.abs(dy) > 6 && nextStop(Math.sign(dy)) !== null) e.preventDefault();
  }, { passive: false });
  on(window, "touchend", (e) => {
    if (touchY === null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    touchY = null;
    if (Math.abs(dy) < 30) return;
    lastInput = 0;
    tryStep(Math.sign(dy), null);
  }, { passive: true });

  /* ---------- the chapter progress bar ---------- */
  const navLinks = [];
  const segs = storyNav.querySelector(".segs");
  const navNum = storyNav.querySelector(".num");
  const navLbl = storyNav.querySelector(".lbl");
  const FIRST = 2;
  const LAST = KEYS.length - 2;
  for (let j = FIRST; j <= LAST; j++) {
    const li = chapters[j - 1];
    const a = document.createElement("a");
    a.href = "#" + li.id;
    a.setAttribute("aria-label", `${String(j - 1).padStart(2, "0")} ${li.dataset.label}`);
    segs.appendChild(a);
    navLinks.push(a);
  }
  storyNav.hidden = false;
  cleanups.push(() => { segs.textContent = ""; storyNav.hidden = true; storyNav.classList.remove("on"); });
  let navCurrent = -1;
  let navVis = -1;

  /* ---------- per-frame update ---------- */
  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const noteVis = notes.map(() => -1);
  let wireAlpha = -1;
  let time = 0;

  const update = (dt) => {
    p = p < 0 ? pTarget : p + (pTarget - p) * damp(dt, 5.5);
    if (Math.abs(pTarget - p) < 0.0004) p = pTarget;
    time += dt;
    pointer.x += (pointer.tx - pointer.x) * damp(dt, 3);
    pointer.y += (pointer.ty - pointer.y) * damp(dt, 3);

    const k = Math.min(KEYS.length - 2, Math.floor(p));
    const f = clamp(p - k, 0, 1);
    const t = smooth(clamp((f - 0.16) / 0.68, 0, 1));
    const A = KEYS[k];
    const B = KEYS[k + 1];
    const SA = keyState[k];
    const SB = keyState[k + 1];

    const explode = lerp(A.explode, B.explode, t);
    const az = THREE.MathUtils.degToRad(lerp(A.az, B.az, t));
    const el = THREE.MathUtils.degToRad(lerp(A.el, B.el, t));
    const dist = lerp(SA.dist, SB.dist, t);
    tgt.lerpVectors(SA.target, SB.target, t);
    const dx = lerp(SA.dx, SB.dx, t);
    const dy = lerp(SA.dy, SB.dy, t);
    const deviceFocus = lerp(A.focus === "device" ? 1 : 0, B.focus === "device" ? 1 : 0, t);

    // the rig floats; the pointer tilts it (mostly while it is assembled)
    const calm = 1 - explode * 0.65;
    rig.position.y = Math.sin(time * 0.9) * 0.14 * (0.4 + 0.6 * deviceFocus);
    rig.rotation.x = -0.05 + pointer.y * 0.06 * calm;
    rig.rotation.y = pointer.x * 0.09 * calm;
    rig.rotation.z = Math.sin(time * 0.55) * 0.006;
    rig.updateMatrixWorld();

    // camera orbit around the focus, shifted on screen so the note has room
    camera.position.set(
      tgt.x + dist * Math.cos(el) * Math.sin(az),
      tgt.y + dist * Math.sin(el),
      tgt.z + dist * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(tgt);
    camera.setViewOffset(size.w, size.h, -dx, -dy, size.w, size.h);
    camera.updateProjectionMatrix();

    // panels
    let anyFocus = 0;
    let top = null;
    panels.forEach((pn) => {
      const key = pn.def.key;
      pn.focus = lerp(A.focus === key ? 1 : 0, B.focus === key ? 1 : 0, t);
      anyFocus += pn.focus;
      if (!top || pn.focus > top.focus) top = pn;
    });
    screenMat.color.setScalar(1 - 0.42 * explode);
    panels.forEach((pn) => {
      const e = smooth(clamp(explode * 1.4 - pn.delay, 0, 1));
      const fo = pn.focus;
      const dim = clamp(anyFocus - fo, 0, 1);
      const g = pn.group;
      g.position.lerpVectors(pn.home, pn.at, e);
      g.position.z += Math.sin(e * Math.PI) * 1.6 * (pn.def.back ? -1 : 1);
      g.position.y += Math.sin(time * 0.8 + pn.i * 1.7) * 0.1 * e;
      g.rotation.set(pn.rotX * e, pn.rotY === Math.PI ? Math.PI : pn.rotY * e, 0);
      g.scale.setScalar(lerp(pn.homeScale, 1, e) * (1 + 0.05 * fo));
      // lift toward the viewer along the panel's own normal
      v3.set(0, 0, 1.3 * fo).applyEuler(g.rotation);
      g.position.add(v3);

      let alpha = pn.def.screen ? 1 : smooth(clamp(e * 2.5, 0, 1));
      if (pn.def.back) alpha *= 0.55 + 0.45 * fo;
      // dim the others: darker in dark mode, lighter in light mode
      alpha *= 1 - (pal.dark ? 0.25 : 0.55) * dim;
      g.visible = alpha > 0.003;
      pn.face.material.opacity = alpha;
      if (pn.face.material.map) pn.face.material.color.setScalar(pal.dark ? 1 - 0.58 * dim : 1);
      pn.plate.material.opacity = alpha;
      pn.plate.material.color.copy(borderColor).lerp(brandColor, fo);
      if (!pn.face.material.map) pn.face.material.color.copy(surfaceColor);
      const haloBase = (pal.dark ? 0.55 : 0.2) * e * (1 - 0.7 * dim);
      pn.halo.material.color.copy(shadowColor).lerp(brandColor, fo);
      pn.halo.material.opacity = lerp(haloBase, pal.dark ? 0.75 : 0.62, fo) * (pn.def.screen ? smooth(clamp(e * 3, 0, 1)) : alpha);
      pn.halo.position.y = lerp(-0.28, 0, fo);
      const order = fo > 0.5 ? 100 : 10 + pn.i * 3;
      pn.halo.renderOrder = order;
      pn.plate.renderOrder = order + 1;
      pn.face.renderOrder = order + 2;
    });

    // screen sheen follows the orbit and the pointer
    sheenTex.offset.x = -0.45 + ((az / (Math.PI * 2)) % 1) * 0.6 + pointer.x * 0.12 + 0.35;
    floorMat.opacity = (pal.dark ? 1 : 0.8) * (1 - 0.75 * explode) * (1 - rig.position.y * 0.6);

    // notes fade in and out around their key
    notes.forEach((note, i) => {
      const vis = smooth(clamp(1 - Math.abs(p - (i + 1)) * 2.3, 0, 1));
      if (Math.abs(vis - noteVis[i]) > 0.002 || (vis === 0) !== (noteVis[i] === 0)) {
        noteVis[i] = vis;
        note.style.setProperty("--vis", vis.toFixed(3));
      }
    });

    // connector from the lifted panel to its note
    const j = Math.round(p);
    let alpha = 0;
    if (top && top.focus > 0.02 && j >= FIRST && j <= LAST && KEYS[j].focus === top.def.key) {
      const note = notes[j - 1];
      alpha = Math.min(top.focus, noteVis[j - 1]);
      if (alpha > 0.01) {
        const sr = stage.getBoundingClientRect();
        const nr = note.getBoundingClientRect();
        const cardLeft = nr.left - sr.left;
        const cardRight = nr.right - sr.left;
        const cy = clamp(nr.top - sr.top + 44, 0, size.h);
        // the panel edge nearest the card
        const proj = (lx) => {
          v3b.set(lx, 0, 0);
          top.face.localToWorld(v3b);
          v3b.project(camera);
          return { x: (v3b.x + 1) * 0.5 * size.w, y: (1 - v3b.y) * 0.5 * size.h, z: v3b.z };
        };
        const a1 = proj(-top.w / 2);
        const a2 = proj(top.w / 2);
        const cardOnRight = keyState[j].side === 1;
        const anchor = cardOnRight ? (a1.x > a2.x ? a1 : a2) : (a1.x < a2.x ? a1 : a2);
        const cx = cardOnRight ? cardLeft : cardRight;
        if (anchor.z < 1 && Math.abs(cx - anchor.x) > 24) {
          const mx = (cx - anchor.x) * 0.5;
          const d = `M${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)}C${(anchor.x + mx).toFixed(1)} ${anchor.y.toFixed(1)} ${(cx - mx).toFixed(1)} ${cy.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
          wirePath.setAttribute("d", d);
          const len = Math.hypot(cx - anchor.x, cy - anchor.y) * 1.2 + 10;
          wirePath.style.strokeDasharray = `${len.toFixed(0)}`;
          wirePath.style.strokeDashoffset = `${(len * (1 - smooth(alpha))).toFixed(1)}`;
          for (const c of [wireRing, wireDot]) { c.setAttribute("cx", anchor.x.toFixed(1)); c.setAttribute("cy", anchor.y.toFixed(1)); }
          wireEnd.setAttribute("cx", cx.toFixed(1));
          wireEnd.setAttribute("cy", cy.toFixed(1));
        } else {
          alpha = 0;
        }
      }
    }
    if (Math.abs(alpha - wireAlpha) > 0.002) {
      wireAlpha = alpha;
      wire.style.opacity = alpha.toFixed(3);
    }

    // progress bar
    const nv = clamp((p - 1.35) * 3, 0, 1) * clamp((LAST + 0.65 - p) * 3, 0, 1);
    if (Math.abs(nv - navVis) > 0.002) {
      navVis = nv;
      storyNav.style.setProperty("--nav-vis", nv.toFixed(3));
      storyNav.classList.toggle("on", nv > 0.01);
    }
    const cur = clamp(Math.round(p), FIRST, LAST) - FIRST;
    if (cur !== navCurrent) {
      navCurrent = cur;
      navLinks.forEach((a, i) => {
        if (i === cur) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
        a.classList.toggle("done", i < cur);
      });
      navNum.textContent = `${String(cur + 1).padStart(2, "0")} / ${String(navLinks.length).padStart(2, "0")}`;
      navLbl.textContent = chapters[cur + FIRST - 1].dataset.label;
    }
  };

  /* ---------- render loop: runs only while the story is on screen and the tab is visible ---------- */
  let raf = 0;
  let running = false;
  let visible = false;
  let destroyed = false;
  let last = 0;
  let slow = 0;
  let frames = 0;
  const frame = (now) => {
    if (destroyed || !visible || document.hidden) { running = false; return; }
    raf = requestAnimationFrame(frame);
    const ms = now - last;
    const dt = Math.min(0.05, ms / 1000);
    last = now;
    update(dt);
    renderer.render(scene, camera);
    // adaptive quality: lower the pixel ratio if frames stay slow
    if (++frames > 30) {
      slow = ms > 26 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 45 && quality > 0.6) {
        quality -= 0.2;
        slow = 0;
        renderer.setPixelRatio(dpr());
        renderer.setSize(size.w, size.h, false);
      }
    }
  };
  function wake() {
    if (running || destroyed || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  const vio = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) wake();
  });
  vio.observe(story);
  cleanups.push(() => vio.disconnect());
  on(document, "visibilitychange", wake);

  const ro = new ResizeObserver(() => { measure(); wake(); });
  ro.observe(stage);
  ro.observe(document.body);
  cleanups.push(() => ro.disconnect());

  on(canvas, "webglcontextlost", (e) => { e.preventDefault(); fail(new Error("WebGL context lost")); });

  /* ---------- start: the device screen first, the other screenshots when the browser is idle ---------- */
  applyTheme();
  measure();
  const usePanels = (name, img) => {
    panels.forEach((pn) => {
      if (pn.def.src !== name) return;
      pn.face.material.map = cropTex(img, pn.def.crop);
      pn.face.material.color.set(0xffffff);
      pn.face.material.needsUpdate = true;
    });
  };
  loadImg("overview").then((img) => {
    if (destroyed) return;
    screenMat.map = imageTex(img);
    screenMat.needsUpdate = true;
    usePanels("overview", img);
    root.classList.add("has-3d");
    wake();
    const rest = [...new Set(PANELS.filter((d) => d.src && d.src !== "overview").map((d) => d.src))];
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    const next = () => {
      if (destroyed || !rest.length) return;
      const name = rest.shift();
      loadImg(name).then((img) => {
        if (destroyed) return;
        usePanels(name, img);
        idle(next);
      }).catch(() => idle(next));
    };
    idle(next);
  }).catch((err) => fail(err));


  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    cleanups.forEach((fn) => fn());
    notes.forEach((n) => n.style.removeProperty("--vis"));
    wire.style.opacity = "";
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    disposables.forEach((d) => d.dispose && d.dispose());
    if (logoTex) logoTex.dispose();
    images.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    root.classList.remove("has-3d");
  }

  return { destroy };
}
