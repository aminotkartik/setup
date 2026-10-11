/**
 * The shared atmospheric environment — "the digital campus after dark".
 *
 * This is the calm, always-present sky behind the whole application shell.
 * It is a Server Component on purpose: every movement in it is a CSS
 * animation on `transform`/`opacity`, so there is no hydration, no JavaScript
 * on the client, no `requestAnimationFrame` loop and no re-render to trigger.
 * The compositor owns the motion, and the browser pauses it on a hidden tab
 * for free.
 *
 * It is deliberately not a particle field. The interactive canvas lives in
 * `./ParticleField` and stays on the two cinematic stages that already use it
 * (the sign-in screen and the Home hero); this layer is the environment for
 * every other screen, and stacking the two would double the cost for no gain.
 *
 * The tree is `pointer-events: none` and sits below the shell's stacking
 * context, so it can never intercept a click, a text selection or a scroll.
 * Reduced-motion users get the same composition as a still image — see
 * app/styles/night.css.
 */
export function NightSky() {
  return (
    <div className="night-sky" aria-hidden="true">
      <div className="night-sky__bloom night-sky__bloom--a" />
      <div className="night-sky__bloom night-sky__bloom--b" />
    </div>
  );
}
