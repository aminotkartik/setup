/**
 * The Campus+ depth field — the Home environment.
 *
 * What it is: a vast, nearly black-blue surface seen from just above it, with a
 * few restrained cyan/blue light contours travelling slowly through it and the
 * distance dissolving into the page background. It is the *place* the Home
 * islands float over; it is not an object, not a particle system and not the
 * login ghost, and it deliberately has no centre of attention — the dashboard
 * has to stay the thing you look at.
 *
 * How it is kept cheap:
 *   - one mesh, one draw call: a single displaced plane with a custom
 *     `ShaderMaterial`. All motion is computed in the vertex/fragment shaders
 *     from a `uTime` uniform, so a frame costs no CPU allocations and no
 *     per-vertex JavaScript;
 *   - no textures, no post-processing, no lights, no render targets;
 *   - the resolution and the grid are chosen from the device (a phone gets
 *     ~1/4 of the vertices and a lower pixel ratio than a desktop);
 *   - the loop is stopped whenever the tab is hidden or the canvas leaves the
 *     viewport, and never started at all for `prefers-reduced-motion`, which
 *     gets one still frame instead;
 *   - `dispose()` releases the geometry, the material, the renderer and the
 *     context, and removes the canvas.
 *
 * Colour comes from the design tokens on the container element (`.depth-field`
 * in app/styles/islands.css), so light and dark themes are the same scene with
 * the tokens' own values — no second palette is invented in JavaScript. The
 * renderer writes colour through unchanged (`LinearSRGBColorSpace` output), so
 * the palette is fed to the shader in display values (`paintedColor` undoes
 * three's sRGB→linear conversion) and a token lands on screen exactly as the CSS
 * beside it does.
 */

import * as THREE from 'three';

/**
 * Keeps the field well below the islands' contrast budget.
 *
 * The daylight treatment is deliberately weaker than the night one: on paper the
 * contours are *darker* than the ground, so a line passing behind dark text eats
 * its contrast, where at night a cyan line behind light text adds some.
 *
 * These stay at the light theme's original values. A contrast audit of the Home
 * composer label — muted text sitting directly on the field — read 4.56:1, and
 * lowering the strength did not help it (4.43 at 0.17, 4.34 at 0.11), because
 * the lines were not the cause: the field was painting its whole palette ~15%
 * too dark (see `paintedColor` below). With that conversion fixed the original
 * 0.26 measures 5.72:1, so the cartographic reading is kept as designed.
 */
const LINE_STRENGTH = { dark: 0.62, light: 0.26 };

/** How fast the field dissolves into the page background, per treatment. */
const FOG_DENSITY = { dark: 0.0086, light: 0.0105 };

/** The two treatment constants, keyed by the palette the probes resolved. */
const treatment = (palette) => (palette.dark ? 'dark' : 'light');

/**
 * Device budget. A phone is not asked to shade a desktop's worth of geometry.
 */
export function fieldQuality() {
  if (typeof window === 'undefined') return { segments: 96, pixelRatio: 1.25 };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 720;
  const cores = navigator.hardwareConcurrency || 4;
  const constrained = coarse || narrow || cores <= 4;
  return constrained
    ? { segments: 48, pixelRatio: 1.1 }
    : { segments: 112, pixelRatio: 1.6 };
}

/**
 * The palette, read the way the browser actually resolved it.
 *
 * `getComputedStyle(el).getPropertyValue('--token')` hands back the custom
 * property's *token stream*: a `light-dark(...)` pair or a `var()` chain comes
 * back exactly as written, which is not a colour any renderer can use. A
 * painted property is always resolved to `rgb()`, so the scene keeps three
 * zero-size probes — one background, one colour, one border — whose only job is
 * to hold one resolved colour each. They are invisible, `aria-hidden`, and
 * removed with the scene.
 *
 * Nothing here invents a colour: every value comes from the `--depth-*` tokens
 * islands.css declares, and the neutral grey is a last resort that should never
 * be reached.
 */
const RESOLVED_COLOR = /^(?:rgb|rgba|hsl|hsla)\(|^#|^[a-z]+$/i;

function paintedColor(element, property) {
  if (!element) return null;
  const styles = getComputedStyle(element);
  const raw = (styles[property] || styles.getPropertyValue(property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)) || '').trim();
  if (!raw || !RESOLVED_COLOR.test(raw)) return null;
  const color = new THREE.Color();
  try {
    color.setStyle(raw);
  } catch {
    return null;
  }
  /* Undo the sRGB→linear conversion `setStyle` just did.
     Three's colour management converts a CSS colour into the linear working
     space, and nothing downstream converts it back — this renderer outputs
     `LinearSRGBColorSpace`, so the shader's numbers reach the framebuffer
     unchanged and the browser shows them as sRGB. A token that had been
     converted therefore paints *darker* than it declares, and the daylight
     `--cp-depth-base` did: measured on the real page it came out around 15% down
     (a pale paper blue arriving as a distinctly heavier blue-grey), which is
     what pushed the Home composer label to 4.34:1 — below AA. Converting back
     makes the uniform carry exactly the value the token names, so the canvas
     paints the colour the CSS beside it paints. */
  if (THREE.ColorManagement?.enabled) color.convertLinearToSRGB();
  return color;
}

/** Three invisible elements that hold the theme's resolved colours. */
function createPaletteProbes(container) {
  const make = (cssText) => {
    const probe = document.createElement('span');
    probe.className = 'depth-field__probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = cssText;
    container.appendChild(probe);
    return probe;
  };
  return {
    base: make('background-color: var(--depth-base)'),
    lineA: make('color: var(--depth-line-a)'),
    lineB: make('border-top: 6px solid var(--depth-line-b)'),
  };
}

/** The neutral last resort, in linear component form: no palette literal. */
function neutralColor() {
  return new THREE.Color(0.35, 0.42, 0.55);
}

function readPalette(probes) {
  const base = paintedColor(probes.base, 'backgroundColor') || new THREE.Color(0, 0, 0);
  const lineA = paintedColor(probes.lineA, 'color') || neutralColor();
  const lineB = paintedColor(probes.lineB, 'borderTopColor') || neutralColor();
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // Whether this is the night or the daylight treatment is derived from the
  // surface the tokens resolved to, so the scene never has to know how the
  // theme is stored.
  return { dark: hsl.l < 0.5, base, lineA, lineB };
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSpan;
  uniform float uAmplitude;
  uniform float uDrift;

  varying float vHeight;
  varying float vDistance;
  varying vec3 vWorld;

  // Four slow, incommensurate waves: organic without noise textures, and no
  // visible period the eye can lock onto.
  float surface(vec2 p, float t) {
    float h = 0.0;
    h += sin(p.x * 0.052 + t * 0.145) * 1.00;
    h += sin(p.y * 0.041 - t * 0.101) * 0.86;
    h += sin((p.x + p.y) * 0.027 + t * 0.063) * 0.68;
    h += sin((p.x - p.y) * 0.017 - t * 0.045) * 0.52;
    h += sin(length(p) * 0.020 - t * 0.031) * 0.34;
    return h;
  }

  void main() {
    // The plane is rotated into the ground plane by the mesh, so the local xy
    // pair is the ground and local z is the height.
    vec3 pos = position;
    vec2 ground = pos.xy;

    float falloff = 1.0 - smoothstep(0.45, 1.0, length(ground / uSpan));
    float height = surface(ground + vec2(uDrift, -uDrift * 0.6), uTime) * uAmplitude * falloff;

    pos.z += height;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vec4 mv = viewMatrix * world;

    vHeight = height;
    vDistance = -mv.z;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uLineA;
  uniform vec3 uLineB;
  uniform float uTime;
  uniform float uLineStrength;
  uniform float uFogDensity;
  uniform float uHorizon;
  uniform float uHorizonWidth;
  uniform float uSpan;

  varying float vHeight;
  varying float vDistance;
  varying vec3 vWorld;

  void main() {
    // Contours are level sets of the surface: they travel as the surface moves
    // and stay locked to it, which is what reads as depth rather than as an
    // overlay. Two families, a hair out of step with each other, keep the eye
    // from finding a single grid.
    float contourA = fract(vHeight * 2.6 - uTime * 0.014);
    float contourB = fract(vHeight * 0.85 - uTime * 0.006);
    float rings = fract(vDistance * 0.05 - uTime * 0.02);
    float edge = 0.013;
    float lineA = smoothstep(edge, 0.0, contourA) + smoothstep(1.0 - edge, 1.0, contourA);
    float lineB = smoothstep(0.038, 0.0, contourB) + smoothstep(0.962, 1.0, contourB);
    float lineC = smoothstep(0.012, 0.0, rings) + smoothstep(0.988, 1.0, rings);

    // Sparse light: a slow mask decides which contours are lit, so only a few
    // travel through the dark field at a time.
    float mask = sin(vWorld.x * 0.016 + vWorld.z * 0.013 + uTime * 0.024) * 0.5 + 0.5;
    mask = smoothstep(0.34, 0.96, mask);
    float crest = smoothstep(-0.35, 1.0, vHeight);

    vec3 haze = mix(uBase, uLineB, 0.14);
    vec3 color = uBase;
    color += uLineA * lineA * mask * uLineStrength * (0.26 + crest * 1.15);
    color += uLineB * lineB * (0.55 + mask * 0.45) * uLineStrength * 0.30;
    color += uLineA * lineC * mask * uLineStrength * 0.22;
    color += uLineB * 0.05 * crest;

    // Atmospheric falloff: the field melts into the page background with
    // distance, so there is never a hard edge to look at.
    float fog = 1.0 - exp(-pow(max(vDistance, 0.0) * uFogDensity, 2.0));

    // A low luminous band where the field meets the fog — the horizon of the
    // whole composition, and the reason the page reads as a place with depth
    // rather than as a dark rectangle with lines on it.
    float horizon = exp(-pow((vDistance - uHorizon) / uHorizonWidth, 2.0));
    color += uLineA * horizon * 0.10 * (1.0 - fog);
    color += uLineB * horizon * 0.05;

    color = mix(color, haze, clamp(fog, 0.0, 1.0));

    // The surface must not end: the last quarter of the mesh fades out, so
    // there is no far edge to read as a seam or as a fog bank across the page.
    float dissolve = 1.0 - smoothstep(uSpan * 0.58, uSpan * 0.94, vDistance);

    gl_FragColor = vec4(color, dissolve);
  }
`;

/**
 * @param {HTMLElement} container  element the canvas is appended to
 * @param {{ reducedMotion?: boolean, onContextLost?: () => void }} [options]
 * @returns {() => void} dispose
 */
export function createDepthField(container, { reducedMotion = false, onContextLost = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'depth-field__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const quality = fieldQuality();
  const probes = createPaletteProbes(container);
  let palette = readPalette(probes);

  const size = () => {
    const rect = container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width || window.innerWidth)),
      height: Math.max(1, Math.round(rect.height || window.innerHeight)),
    };
  };

  const { width, height } = size();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.segments > 64,
    alpha: true,
    powerPreference: 'low-power',
  });
  // No colour conversion: what the shader writes is the CSS value the tokens
  // name, which is what the surrounding interface is painted with.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // The surface does not reach the top of every frame — what is above it must
  // show the token background, not a black band, so the clear colour stays
  // fully transparent and the container's own background does the work.
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, width / height, 0.5, 420);
  camera.position.set(0, 6.6, 27);
  camera.lookAt(0, -0.6, -22);

  const span = 420;
  const geometry = new THREE.PlaneGeometry(span, span * 0.9, quality.segments, quality.segments);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    uniforms: {
      uTime: { value: reducedMotion ? 18 : 0 },
      uSpan: { value: span / 2 },
      uAmplitude: { value: 4.1 },
      uDrift: { value: 0 },
      uBase: { value: palette.base },
      uLineA: { value: palette.lineA },
      uLineB: { value: palette.lineB },
      uLineStrength: { value: LINE_STRENGTH[treatment(palette)] },
      uFogDensity: { value: FOG_DENSITY[treatment(palette)] },
      uHorizon: { value: 128 },
      uHorizonWidth: { value: 62 },
    },
  });

  const field = new THREE.Mesh(geometry, material);
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, -4.4, -52);
  scene.add(field);

  /**
   * Did the driver actually accept the shaders?
   *
   * A GLSL error compiles into a program that draws nothing, which would leave
   * the page showing an empty dark rectangle instead of the atmosphere — and
   * would only ever be visible in a browser console. Three keeps the compiler's
   * output on the program, so the scene checks it once and hands the problem to
   * the caller, which swaps in the CSS composition.
   */
  function shaderFailed() {
    const programs = renderer.info?.programs || [];
    return programs.some((program) => {
      const diagnostics = program?.diagnostics;
      if (!diagnostics) return false;
      // `runnable: false` is the authoritative "this program cannot draw"
      // signal; the log scan catches drivers that report an error while still
      // claiming the program linked. Warnings alone are ignored on purpose —
      // some drivers are chatty and a warning is not a reason to lose the scene.
      if (diagnostics.runnable === false) return true;
      const logs = [diagnostics.programLog, diagnostics.vertexShader?.log, diagnostics.fragmentShader?.log];
      return logs.some((log) => typeof log === 'string' && /\bERROR\b/.test(log));
    });
  }

  const render = () => renderer.render(scene, camera);

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  let frameId = 0;
  let running = false;
  let visible = true;
  let elapsed = reducedMotion ? 18 : 0;
  let lastFrame = 0;

  function step(now) {
    if (!lastFrame) lastFrame = now;
    const delta = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    elapsed += delta;
    material.uniforms.uTime.value = elapsed;
    // A very slow lateral drift of the whole field: the sense of a living
    // surface, without the camera moving under the reader.
    material.uniforms.uDrift.value = Math.sin(elapsed * 0.021) * 26;
    render();
  }

  function loop(now) {
    if (!running) return;
    step(now);
    frameId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reducedMotion || document.hidden || !visible) return;
    running = true;
    lastFrame = 0;
    frameId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  // The canvas is decorative and normally fills the viewport, so this mostly
  // documents intent — but it is what keeps the loop off when the stage is
  // scrolled away on a short page or a future layout.
  const observer =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            if (visible) start();
            else stop();
          },
          { rootMargin: '120px' },
        )
      : null;
  observer?.observe(container);

  const handleContextLost = (event) => {
    event.preventDefault();
    stop();
    if (onContextLost) onContextLost();
  };
  canvas.addEventListener('webglcontextlost', handleContextLost, false);

  const resize = () => {
    const next = size();
    camera.aspect = next.width / next.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    renderer.setSize(next.width, next.height, false);
    if (reducedMotion) render();
  };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(container);
  else window.addEventListener('resize', resize);

  /** Re-read the resolved palette tokens into the shader (kept for the wrapper's disposal handle). */
  function refreshPalette() {
    palette = readPalette(probes);
    material.uniforms.uBase.value.copy(next.base);
    material.uniforms.uLineA.value.copy(next.lineA);
    material.uniforms.uLineB.value.copy(next.lineB);
    material.uniforms.uLineStrength.value = LINE_STRENGTH[treatment(palette)];
    material.uniforms.uFogDensity.value = FOG_DENSITY[treatment(palette)];
    if (reducedMotion) render();
  }

  if (reducedMotion) {
    // One still frame: the atmosphere stays, the movement does not.
    render();
  } else {
    start();
  }

  // The first draw is also the first chance to notice that the shader did not
  // compile. Checked after the scene is on screen, so a slow first frame never
  // delays the page.
  if (onContextLost && shaderFailed()) {
    stop();
    onContextLost('The depth field shader did not compile.');
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    for (const probe of Object.values(probes)) probe.remove();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
  }

  // `refreshPalette` rides along on `dispose` so the wrapper can re-read the
  // (permanent dark) palette without tearing the scene down and rebuilding it.
  dispose.refreshPalette = refreshPalette;
  return dispose;
}
