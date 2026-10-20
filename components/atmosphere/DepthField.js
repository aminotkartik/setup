'use client';

/**
 * The Home depth field, as a React layer.
 *
 * One canvas for the whole homepage, mounted once, behind everything the
 * student reads. It is decorative in the strictest sense: `aria-hidden`,
 * `pointer-events: none` and never focusable, so it can neither announce itself
 * to a screen reader nor take a click, a keypress or a scroll.
 *
 * Failure handling is the same shape as the login ghost's, because the same
 * things can go wrong:
 *   - the scene module is loaded on demand, so `three` is not in the first
 *     chunk of a page that may never need it;
 *   - no WebGL, a failed import, a thrown scene, or a lost context all switch
 *     `mode` to `fallback`, which is a finished CSS composition — never an
 *     empty band where the atmosphere should be;
 *   - `prefers-reduced-motion` builds the scene but renders a single still
 *     frame, and the loop is never started.
 *
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { webglAvailable } from '@/components/atmosphere/webgl';

/**
 * The static composition: three soft ridges and a horizon glow, all CSS. It is
 * what a no-WebGL browser sees, and it keeps the same palette, the same depth
 * language and the same restraint — just without movement.
 */
function DepthFieldFallback() {
  return (
    <div className="depth-field__fallback" aria-hidden="true">
      <span className="depth-field__ridge depth-field__ridge--far" />
      <span className="depth-field__ridge depth-field__ridge--mid" />
      <span className="depth-field__ridge depth-field__ridge--near" />
      <span className="depth-field__horizon" />
    </div>
  );
}

export function DepthField({ className = '' }) {
  const containerRef = useRef(null);
  const [mode, setMode] = useState('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    let dispose = null;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    import('./depth/createDepthField')
      .then(({ createDepthField }) => {
        if (cancelled) return;
        if (!webglAvailable()) {
          setMode('fallback');
          return;
        }
        try {
          dispose = createDepthField(container, {
            reducedMotion,
            onContextLost: (reason) => {
              // The GPU took the canvas away, or the shader never compiled:
              // show the CSS composition instead of leaving a dead layer behind
              // the interface.
              if (reason) console.warn(`[Campus+] Depth field unavailable: ${reason}`);
              container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
              setMode('fallback');
            },
          });
          setMode('webgl');
        } catch (error) {
          container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
          console.warn('[Campus+] Depth field unavailable; showing the static atmosphere.', error);
          setMode('fallback');
        }
      })
      .catch((error) => {
        console.warn('[Campus+] Depth field failed to load; showing the static atmosphere.', error);
        if (!cancelled) setMode('fallback');
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div ref={containerRef} className={cn('depth-field', className)} data-state={mode} aria-hidden="true">
      {mode === 'fallback' ? <DepthFieldFallback /> : null}
      {/* Separates the environment from the interface: a wash at the top so the
          sticky glass header keeps a compatible backdrop, and a vignette at the
          bottom so the field never competes with the feed. */}
      <span className="depth-field__scrim" />
    </div>
  );
}
