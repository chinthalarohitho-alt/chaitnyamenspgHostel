/* ===================================================================
   Lottie helper
   -------------------------------------------------------------------
   lottie_light is ~168 KB minified, so it is imported dynamically: Vite
   splits it into its own chunk that is fetched only the first time an
   animation is actually mounted. A visitor who never opens the manager
   portal and never sees a "house full" badge never downloads it.

   Animation JSON lives in assets/lottie/ and is imported (not fetched
   by path) so Vite bundles and hashes it — a bare path string in JS is
   not rewritten and 404s in a production build.
   =================================================================== */

let playerPromise = null;

/** Load the player once, on first use. */
function getPlayer() {
  if (!playerPromise) {
    // lottie_light: SVG renderer only. Excludes the expressions engine,
    // which drops ~130 KB and removes lottie-web's eval() call (a CSP risk
    // and a rolldown build warning). Our animations use no expressions.
    playerPromise = import('lottie-web/build/player/lottie_light')
      .then(m => m.default || m)
      .catch(err => {
        console.warn('[lottie] player failed to load:', err);
        playerPromise = null;
        return null;
      });
  }
  return playerPromise;
}

const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mount an animation into `el`.
 * Returns the instance, or null when skipped (reduced motion / load failure).
 * Callers must treat null as "fine, just no animation".
 */
export async function mountLottie(el, animationData, { loop = true, autoplay = true } = {}) {
  if (!el || !animationData) return null;
  if (reduceMotion()) {
    el.classList.add('lottie-static');   // CSS paints a still glyph instead
    return null;
  }
  const lottie = await getPlayer();
  if (!lottie) return null;

  el.innerHTML = '';
  try {
    return lottie.loadAnimation({
      container: el,
      renderer: 'svg',
      loop,
      autoplay,
      animationData,
      rendererSettings: { progressiveLoad: true, hideOnTransparent: true }
    });
  } catch (err) {
    console.warn('[lottie] mount failed:', err);
    return null;
  }
}

/** Stop and free an instance created by mountLottie. */
export function destroyLottie(anim) {
  if (anim && typeof anim.destroy === 'function') {
    try { anim.destroy(); } catch { /* already gone */ }
  }
}
