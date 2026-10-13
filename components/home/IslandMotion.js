'use client';

/**
 * The ambient half of the island motion: a restrained, depth-based response to
 * where the pointer is.
 *
 * Design constraints that shaped this:
 *   - the interface must stay stable while you read, type, click and scroll, so
 *     the amplitude is a couple of pixels and it is applied with a transform —
 *     never layout;
 *   - React must not re-render, let alone re-render per frame: the value is
 *     written straight to CSS custom properties on one wrapper element and read
 *     by each island as `--pointer-x` / `--pointer-y`;
 *   - it is off for touch, for `prefers-reduced-motion`, and on narrow screens;
 *   - the animation frame loop stops itself the moment the pointer value has
 *     settled, so an idle page is not burning frames on a decoration.
 *
 * Islands opt into the depth themselves through `--island-depth` (see
 * app/styles/islands.css), so a small rail island moves less than the primary
 * one without any arithmetic here.
 */

import { useEffect, useRef } from 'react';

export function IslandMotion({ children }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)') ?? null;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    const wideEnough = () => window.innerWidth >= 1024;
    const enabled = () => Boolean(finePointer?.matches) && !reducedMotion?.matches && wideEnough();

    const current = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let frame = 0;

    const write = () => {
      host.style.setProperty('--pointer-x', current.x.toFixed(3));
      host.style.setProperty('--pointer-y', current.y.toFixed(3));
    };

    const tick = () => {
      current.x += (target.x - current.x) * 0.07;
      current.y += (target.y - current.y) * 0.07;
      write();
      if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.0015) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Settled: park on the exact value and stop asking for frames.
      current.x = target.x;
      current.y = target.y;
      write();
      frame = 0;
    };

    const start = () => {
      if (frame) return;
      frame = requestAnimationFrame(tick);
    };

    const onPointerMove = (event) => {
      if (!enabled()) return;
      // Normalised against the viewport, not the element: no layout read runs
      // inside a pointer handler, which is what keeps this free on scroll.
      target.x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
      target.y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
      start();
    };

    const onPointerLeave = () => {
      target.x = 0;
      target.y = 0;
      start();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', onPointerLeave);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
      if (frame) cancelAnimationFrame(frame);
      host.style.removeProperty('--pointer-x');
      host.style.removeProperty('--pointer-y');
    };
  }, []);

  return (
    <div ref={hostRef} className="island-motion">
      {children}
    </div>
  );
}
