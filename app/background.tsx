'use client';

// The page's background: Lightfall, in this app's colours.
//
// Three things about how it is wired, all of them load-bearing:
//
//   1. **Screen, over `--color-page`.** Lightfall's dark mode draws light on
//      black, so `screen` is the blend that matches what it produces: black
//      leaves the page colour exactly as it is and only the streaks lighten it.
//      Plain alpha compositing would lay the shader's black over the page
//      everywhere the light is not, dimming the whole floor by the layer's
//      opacity — a vignette nobody asked for.
//
//   2. **The colours are a module constant.** `colors` is in the effect's
//      dependency list inside Lightfall, so a fresh array literal on each
//      render would tear down and rebuild the WebGL context every time React
//      re-rendered — which, during a crawl, is on every streamed log line.
//
//   3. **No mouse.** The layer is `pointer-events-none` so the report can be
//      used through it, which means the pointermove listener would never fire
//      and `iMouse` would sit at [0, 0] — a glow permanently stuck in the
//      bottom-left corner. Off, rather than broken.

import { useEffect, useState } from 'react';

import Lightfall from '@/components/Lightfall';

// The brand orange, the chart scale's amber, and one step between them.
//
// All three are low-blue on purpose, and that is the whole story of this
// palette. The shader subtracts (0.04, 0.08, 0.02) from every streak before
// tone-mapping, so whatever blue one starts with outlives its green and the
// tail lands on violet. Measured on the light version of this background:
// `--color-line` greys put 31% of the lit pixels in the 200-330deg range, which
// is the AI-gradient background this report is not. Take the blue out at the
// source and the drift has nothing to drift to.
const COLORS = ['#ff642d', '#fab219', '#ff8a1f'];

export default function Background() {
  // Decorative, and it never stops moving, so reduced motion gets the flat page
  // colour instead of a paused frame. `paused` is in Lightfall's dependency
  // list, so toggling it would rebuild the context rather than freeze it — not
  // rendering at all is both the cheaper and the honest answer.
  const [still, setStill] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setStill(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 isolate bg-page"
    >
      {!still && (
        <Lightfall
          mixBlendMode="screen"
          mouseInteraction={false}
          colors={COLORS}
          // How bright the light gets, and the only dial here with a hard
          // ceiling on it rather than a taste argument. Page-level text sits
          // directly on this, so a streak passing behind a 12px line is that
          // line's real contrast: at 0.26 the brightest backdrop pixel measured
          // rgb(82,82,72) and took the lead paragraph to 4.03:1, under AA.
          opacity={0.17}
          speed={0.28}
          // Few, wide and long. The defaults draw a dense fan of hairlines,
          // which at this size reads as scratches on the page rather than as
          // light; widening the streak softens its edge, and dropping the
          // angular density thins the fan out to something you notice once.
          streakCount={3}
          streakWidth={16}
          streakLength={2.8}
          density={0.22}
          glow={0.8}
          twinkle={0.3}
          zoom={3.4}
          // Off. This term is `colour * 90 * glow / (1e3 * d^2 + 6)`, so it is
          // a spotlight long before it is a wash — at 0.18 it put a crimson
          // blob across the top of the page. The streaks are the effect; the
          // floor stays the flat page colour.
          backgroundGlow={0}
          // Half resolution, stretched back up by the canvas's own CSS size.
          //
          // This shader is fragment-bound and not cheaply so: `sceneC` runs a
          // 39-step loop and is called three times per pixel for the screen-
          // space derivative, so cost is roughly 120 iterations per pixel
          // before the streak loop. Quartering the pixels is the one lever that
          // matters, and it costs nothing here because everything on screen is
          // a soft shaft of light many pixels wide — there is no detail at the
          // pixel level for the upscale to lose.
          dpr={0.5}
        />
      )}
    </div>
  );
}
