'use client';

/**
 * Campus+ atmospheric particle field — the supplied interstellar canvas,
 * adapted to the warm vibrant blue identity.
 *
 * What carries over from the source: the drifting deep-blue sky gradient,
 * interactive particles with mouse repulsion and grid-spaced connections,
 * wispy dust, expanding ripples (ambient on movement, a firework burst on
 * click), fading frame trails, device-pixel-ratio scaling, and pausing when
 * the tab hides. What changes: the palette is strictly blue — cyan-blue to
 * soft white-blue, never rainbow — the density is the source's 1.5× table,
 * and the whole loop honours `prefers-reduced-motion` (one static frame) and
 * tears down every listener and frame on unmount.
 *
 * Colours are computed HSL strings (no hex anywhere), drawn only from the
 * blue band of the spectrum.
 */

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------- helpers */

const rand = (min, max) => Math.random() * (max - min) + min;
const blueHue = () => rand(195, 235); // cyan-blue -> blue, never purple

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** The source's particle-count tables, kept at its 1.5× density. */
function particleCountFor(width) {
  const table = [
    { w: 0, c: 16 * 1.5 },
    { w: 480, c: 22 * 1.5 },
    { w: 768, c: 28 * 1.5 },
    { w: 1024, c: 38 * 1.5 },
    { w: 1280, c: 48 * 1.5 },
    { w: 1600, c: 58 * 1.5 },
    { w: 1920, c: 72 * 1.5 },
    { w: 2240, c: 86 * 1.5 },
  ];
  let count = 0;
  for (const row of table) if (width >= row.w) count = Math.round(row.c);
  return count;
}

function dustCountFor(width) {
  const table = [
    { w: 0, c: 30 },
    { w: 768, c: 45 },
    { w: 1024, c: 60 },
    { w: 1280, c: 75 },
    { w: 1600, c: 90 },
  ];
  let count = 0;
  for (const row of table) if (width >= row.w) count = row.c;
  return count;
}

/* ----------------------------------------------------------- particles */

class Particle {
  constructor(width, height) {
    this.reset(width, height, true);
    this.hue = blueHue();
  }

  reset(width, height, initial = false) {
    this.x = rand(0, width);
    this.y = rand(0, height);
    this.baseSize = rand(1, 2.8);
    this.size = this.baseSize;
    this.speed = rand(0.08, 0.32);
    this.angle = rand(0, Math.PI * 2);
    this.drift = rand(0.002, 0.012);
    this.vx = 0;
    this.vy = 0;
    this.life = 1;
    this.fading = false;
    this.fadeSpeed = rand(0.002, 0.006);
    this.phase = rand(0, Math.PI * 2);
    this.twinkle = rand(0.005, 0.02);
    this.initial = initial;
    this.hue = blueHue();
  }

  update(time, mouse, width, height) {
    this.phase += this.twinkle;
    this.size = this.baseSize + Math.sin(this.phase) * 0.5;

    if (!this.fading) {
      this.angle += Math.sin(time * 0.001 + this.phase) * this.drift;
      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed;

      if (mouse.x !== null && mouse.active) {
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const distanceSq = dx * dx + dy * dy;
        const radius = Math.sqrt(22500);
        if (distanceSq < radius * radius && distanceSq > 0.01) {
          const distance = Math.sqrt(distanceSq);
          const force = (radius - distance) / radius;
          const dirX = dx / distance;
          const dirY = dy / distance;
          this.vx += dirX * force * 0.03;
          this.vy += dirY * force * 0.03;
        }
      }

      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.98;
      this.vy *= 0.98;

      const margin = 30;
      if (this.x < -margin) this.x = width + margin;
      if (this.x > width + margin) this.x = -margin;
      if (this.y < -margin) this.y = height + margin;
      if (this.y > height + margin) this.y = -margin;
    } else {
      this.life -= this.fadeSpeed;
    }
    return this.life > 0;
  }

  draw(ctx) {
    const alpha = this.life * (0.55 + Math.sin(this.phase) * 0.2);
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0.4, this.size), 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${this.hue}, 78%, 62%, ${Math.max(0, Math.min(1, alpha))})`;
    ctx.fill();
  }
}

class DustParticle {
  constructor(width, height) {
    this.x = rand(0, width);
    this.y = rand(0, height);
    this.size = rand(0.5, 1.1);
    this.speed = rand(0.15, 0.4);
    this.angle = rand(0, Math.PI * 2);
    this.opacity = rand(0.15, 0.35);
  }

  update(width, height) {
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;
    if (this.x < 0) this.x = width;
    if (this.x > width) this.x = 0;
    if (this.y < 0) this.y = height;
    if (this.y > height) this.y = 0;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(210, 80%, 70%, ${this.opacity})`;
    ctx.fill();
  }
}

class Ripple {
  constructor(x, y, maxRadius = 22) {
    this.x = x;
    this.y = y;
    this.radius = 2;
    this.maxRadius = maxRadius;
    this.opacity = 0.6;
  }

  update() {
    this.radius += 0.85;
    this.opacity -= 0.012;
    return this.opacity > 0;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(212, 85%, 68%, ${Math.max(0, this.opacity)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

/* -------------------------------------------------------------- engine */

class AtmosphereEngine {
  constructor(canvas, { interactive, densityScale }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.interactive = interactive;
    this.densityScale = densityScale;
    this.particles = [];
    this.dust = [];
    this.ripples = [];
    this.trails = [];
    this.mouse = { x: null, y: null, active: false };
    this.frame = 0;
    this.running = false;
    this.rafId = 0;
    this.skyShift = 0;
    this.onFrame = this.onFrame.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onMediaMotion = this.onMediaMotion.bind(this);
    this.motionQuery = window.matchMedia(REDUCED_QUERY);
    this.reduced = this.motionQuery.matches;
    this.time = 0;
    this.onResize(true);
    window.addEventListener('resize', this.onResize);
    if (interactive) {
      window.addEventListener('mousemove', this.onMove);
      window.addEventListener('click', this.onClick);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motionQuery.addEventListener('change', this.onMediaMotion);
    if (!this.reduced) this.start();
    else this.renderStatic();
  }

  onMediaMotion(event) {
    this.reduced = event.matches;
    if (this.reduced) {
      this.stop();
      this.renderStatic();
    } else {
      this.start();
    }
  }

  onVisibility() {
    if (document.hidden) this.stop();
    else if (!this.reduced) this.start();
  }

  onResize(initial) {
    const isInitial = initial === true;
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    const width = Math.max(320, parent?.clientWidth || window.innerWidth);
    const height = Math.max(320, parent?.clientHeight || window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;

    const count = Math.round(particleCountFor(width) * this.densityScale);
    const dustCount = Math.round(dustCountFor(width) * this.densityScale);

    if (isInitial || this.particles.length === 0) {
      this.particles = Array.from({ length: count }, () => new Particle(width, height));
      this.dust = Array.from({ length: dustCount }, () => new DustParticle(width, height));
    } else {
      this.resizeCollection(this.particles, count, width, height);
      this.resizeCollection(this.dust, dustCount, width, height);
    }
    if (this.reduced) this.renderStatic();
  }

  resizeCollection(list, count, width, height) {
    while (list.length > count) list.pop();
    while (list.length < count) {
      if (list === this.particles) list.push(new Particle(width, height));
      else list.push(new DustParticle(width, height));
    }
  }

  onMove(event) {
    this.mouse.x = event.clientX;
    this.mouse.y = event.clientY;
    this.mouse.active = true;
    if (this.reduced || this.frame % 6 !== 0) return;
    if (this.ripples.length < 4) this.ripples.push(new Ripple(this.mouse.x, this.mouse.y, 22));
  }

  onClick(event) {
    if (this.reduced) return;
    const { clientX: x, clientY: y } = event;
    this.ripples.push(new Ripple(x, y, 70));
    const burst = 15;
    for (let i = 0; i < burst; i += 1) {
      const angle = (Math.PI * 2 * i) / burst;
      const p = new Particle(this.width, this.height);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * rand(1.4, 2.6);
      p.vy = Math.sin(angle) * rand(1.4, 2.6);
      p.life = 1;
      p.fading = true;
      p.fadeSpeed = rand(0.008, 0.016);
      this.particles.push(p);
    }
    // Cap the ambient population after bursts so the field settles back.
    const ambient = Math.round(particleCountFor(this.width) * this.densityScale);
    if (this.particles.filter((p) => !p.fading).length > ambient) {
      const ambientParticles = this.particles.filter((p) => !p.fading);
      ambientParticles.sort(() => Math.random() - 0.5);
      for (let i = 0; i < 6; i += 1) {
        if (ambientParticles[i]) ambientParticles[i].fading = true;
      }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    if (this.interactive) {
      window.removeEventListener('mousemove', this.onMove);
      window.removeEventListener('click', this.onClick);
    }
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motionQuery.removeEventListener('change', this.onMediaMotion);
  }

  drawBackground() {
    const { ctx, width, height } = this;
    this.skyShift += 0.015;
    // The sky drifts slowly between deep blue and a slightly lighter blue.
    const hue = 210 + Math.sin(this.skyShift * 0.02) * 11;
    const gradient = ctx.createRadialGradient(
      width * (0.5 + Math.sin(this.skyShift * 0.01) * 0.08),
      height * (0.4 + Math.cos(this.skyShift * 0.013) * 0.08),
      50,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.9,
    );
    gradient.addColorStop(0, `hsl(${hue + 6}, 55%, 16%)`);
    gradient.addColorStop(0.55, `hsl(${hue}, 50%, 12%)`);
    gradient.addColorStop(1, `hsl(${hue - 8}, 46%, 8%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  connectParticles() {
    const { ctx, particles } = this;
    const cell = 120;
    const gridSize = cell * cell;
    const cols = Math.ceil(this.width / cell) + 1;
    const rows = Math.ceil(this.height / cell) + 1;
    const grid = Array.from({ length: cols * rows }, () => []);

    for (const p of particles) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / cell)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / cell)));
      grid[gy * cols + gx].push(p);
    }

    for (const p of particles) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / cell)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / cell)));

      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = gx + ox;
          const ny = gy + oy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          for (const neighbor of grid[ny * cols + nx]) {
            if (neighbor === p) continue;
            const dx = p.x - neighbor.x;
            const dy = p.y - neighbor.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < gridSize) {
              const distance = Math.sqrt(distanceSq);
              const alpha = (1 - distance / cell) * 0.22 * p.life * neighbor.life;
              if (alpha <= 0.01) continue;
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(neighbor.x, neighbor.y);
              ctx.strokeStyle = `hsla(214, 80%, 66%, ${alpha.toFixed(3)})`;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }
      }
    }
  }

  onFrame() {
    if (!this.running) return;
    this.renderFrame();
    this.frame += 1;
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  renderFrame() {
    const { ctx, width, height } = this;

    this.trails.push({ hue: this.skyShift, shift: this.skyShift });
    if (this.trails.length > 10) this.trails.shift();

    if (this.trails.length > 1 && this.frame % 2 === 0) {
      const prev = this.trails[this.trails.length - 2];
      const gradient = ctx.createRadialGradient(
        width * (0.5 + Math.sin(prev.shift * 0.01) * 0.08),
        height * (0.4 + Math.cos(prev.shift * 0.013) * 0.08),
        50,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.9,
      );
      const hue = 210 + Math.sin(prev.shift * 0.02) * 11;
      gradient.addColorStop(0, `hsla(${hue + 6}, 55%, 16%, 0.1)`);
      gradient.addColorStop(0.55, `hsla(${hue}, 50%, 12%, 0.1)`);
      gradient.addColorStop(1, `hsla(${hue - 8}, 46%, 8%, 0.1)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } else {
      this.drawBackground();
    }

    for (const d of this.dust) {
      d.update(width, height);
      d.draw(ctx);
    }

    this.connectParticles();

    const time = (this.time += 16);
    for (const p of this.particles) {
      if (!p.update(time, this.mouse, width, height)) p.reset(width, height);
      p.draw(ctx);
    }

    this.ripples = this.ripples.filter((r) => {
      r.draw(ctx);
      return r.update();
    });

    // Soft mote sparkle (the source's two random twinkle draws per frame).
    for (let i = 0; i < 2; i += 1) {
      const x = rand(0, width);
      const y = rand(0, height);
      const size = rand(0.5, 1.5);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${blueHue()}, 80%, 72%, ${rand(0.1, 0.4)})`;
      ctx.fill();
    }
  }

  renderStatic() {
    // A single, calm still frame for reduced motion — the atmosphere reads
    // without moving.
    const { ctx } = this;
    this.drawBackground();
    for (const d of this.dust) d.draw(ctx);
    for (const p of this.particles) p.draw(ctx);
  }
}

/* ---------------------------------------------------------- component */

/**
 * `<ParticleField />` — the blue atmospheric canvas behind Login and Home.
 * `density` scales the source's 1.5× table (Home runs calmer than Login);
 * `interactive` enables the mouse repulsion and ripples.
 */
export function ParticleField({ density = 1, interactive = true, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = new AtmosphereEngine(canvas, {
      interactive,
      densityScale: density,
    });
    return () => engine.destroy();
  }, [density, interactive]);

  return (
    <div className={cn('atmosphere', className)} aria-hidden="true">
      <canvas ref={canvasRef} className="atmosphere__canvas" />
    </div>
  );
}
