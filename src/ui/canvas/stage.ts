import { type Viewport, createViewport, fitBounds, panBy, screenToWorld, scaleDenominator, zoomAt } from "./viewport";

/** Zeichnungsreihenfolge laut DESIGN.md §6 (aufsteigend = weiter oben). */
export const LAYER_ORDER = [
  "unterlage", "einzugsflaechen", "daemmplan", "kontur", "pfeile", "symbole", "koten", "auswahl", "fang",
] as const;
export type LayerId = (typeof LAYER_ORDER)[number];

/** Zeichnet in Welt-Koordinaten (m, y nach oben); Strichstärken in px = px / vp.scale. */
export type LayerDraw = (ctx: CanvasRenderingContext2D, vp: Viewport) => void;

export interface PointerHandlers {
  move?(w: [number, number]): void;
  click?(w: [number, number]): void;
  dblclick?(w: [number, number]): void;
  leave?(): void;
}

export interface Stage {
  setLayer(id: LayerId, draw: LayerDraw | null): void;
  invalidate(): void;
  fit(minX: number, minY: number, maxX: number, maxY: number): void;
  /** Verschiebt die Ansicht, sodass der Weltpunkt in der Mitte liegt (Maßstab bleibt). */
  centerOn(x: number, y: number): void;
  readonly viewport: Viewport;
  onChange(cb: (vp: Viewport, cursor: [number, number] | null) => void): void;
  /** Zeigerereignisse in Weltkoordinaten (m). Klicks mit Space/Mitteltaste (Pan) werden nicht gemeldet. */
  onPointer(h: PointerHandlers): void;
  setCursor(css: string): void;
  destroy(): void;
}

export function mountStage(host: HTMLElement): Stage {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none";
  host.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D nicht verfügbar");

  let vp = createViewport(host.clientWidth || 1, host.clientHeight || 1);
  const layers = new Map<LayerId, LayerDraw>();
  let queued = false;
  let cb: (vp: Viewport, cursor: [number, number] | null) => void = () => {};
  let cursor: [number, number] | null = null;

  const bg = () => getComputedStyle(host).getPropertyValue("--bg") || "#fff";

  function render() {
    queued = false;
    const dpr = window.devicePixelRatio || 1;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.fillStyle = bg();
    ctx!.fillRect(0, 0, vp.w, vp.h);
    for (const id of LAYER_ORDER) {
      const draw = layers.get(id);
      if (!draw) continue;
      ctx!.save();
      // Welt -> Bildschirm: x' = w/2 + (x-cx)*s ; y' = h/2 - (y-cy)*s
      ctx!.transform(vp.scale, 0, 0, -vp.scale, vp.w / 2 - vp.cx * vp.scale, vp.h / 2 + vp.cy * vp.scale);
      draw(ctx!, vp);
      ctx!.restore();
    }
  }
  function invalidate() {
    if (!queued) { queued = true; requestAnimationFrame(render); }
  }
  function changed() { cb(vp, cursor); invalidate(); }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth, h = host.clientHeight;
    if (w < 1 || h < 1) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    vp = { ...vp, w, h };
    changed();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const pos = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [sx, sy] = pos(e);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    vp = zoomAt(vp, factor, sx, sy);
    cursor = screenToWorld(vp, sx, sy);
    changed();
  }, { passive: false });

  let ph: PointerHandlers = {};
  let idleCursor = "";
  let drag: { x: number; y: number } | null = null;
  let space = false;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1 || (e.button === 0 && space)) {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      e.preventDefault();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const [sx, sy] = pos(e);
    if (drag) {
      vp = panBy(vp, e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    }
    cursor = screenToWorld(vp, sx, sy);
    changed();
    if (!drag) ph.move?.(cursor);
  });
  canvas.addEventListener("click", (e) => {
    if (space || e.button !== 0) return;
    const [sx, sy] = pos(e);
    ph.click?.(screenToWorld(vp, sx, sy));
  });
  canvas.addEventListener("dblclick", (e) => {
    if (space || e.button !== 0) return;
    const [sx, sy] = pos(e);
    ph.dblclick?.(screenToWorld(vp, sx, sy));
  });
  const end = (e: PointerEvent) => {
    if (drag) { drag = null; canvas.releasePointerCapture(e.pointerId); canvas.style.cursor = space ? "grab" : idleCursor; }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { cursor = null; cb(vp, null); ph.leave?.(); });
  const key = (down: boolean) => (e: KeyboardEvent) => {
    if (e.code !== "Space" || (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    space = down;
    if (!drag) canvas.style.cursor = down ? "grab" : idleCursor;
    if (down) e.preventDefault();
  };
  const kd = key(true), ku = key(false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  return {
    setLayer(id, draw) { if (draw) layers.set(id, draw); else layers.delete(id); invalidate(); },
    invalidate,
    fit(a, b, c, d) { vp = fitBounds(vp, a, b, c, d); changed(); },
    centerOn(x, y) { vp = { ...vp, cx: x, cy: y }; changed(); },
    get viewport() { return vp; },
    onChange(f) { cb = f; },
    onPointer(h) { ph = h; },
    setCursor(c) { idleCursor = c; if (!drag && !space) canvas.style.cursor = c; },
    destroy() { ro.disconnect(); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); canvas.remove(); },
  };
}

export { scaleDenominator };
