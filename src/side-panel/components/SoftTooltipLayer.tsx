import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 260;
const HIDE_DELAY_MS = 80;
const VIEWPORT_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 240;

interface SoftTooltipState {
  text: string;
  left: number;
  top: number;
  placement: "above" | "below";
}

/**
 * Document-level soft tooltip for `[data-soft-tooltip]`.
 * Prefer this over native `title` so copy stays on-brand and isn't clipped by overflow parents.
 */
export function SoftTooltipLayer() {
  const [tip, setTip] = useState<SoftTooltipState | null>(null);

  useEffect(() => {
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    let activeTarget: HTMLElement | null = null;

    const clearTimers = () => {
      if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
        showTimer = undefined;
      }
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
      }
    };

    const hide = () => {
      activeTarget = null;
      setTip(null);
    };

    const showFor = (target: HTMLElement) => {
      const text = target.getAttribute("data-soft-tooltip")?.trim();
      if (!text) {
        hide();
        return;
      }

      const rect = target.getBoundingClientRect();
      const estimatedHeight = Math.min(120, 18 + Math.ceil(text.length / 18) * 16);
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      const placement: "above" | "below" =
        spaceAbove >= estimatedHeight + 8 || spaceAbove >= window.innerHeight - rect.bottom
          ? "above"
          : "below";

      const centerX = rect.left + rect.width / 2;
      const left = Math.max(
        VIEWPORT_MARGIN + TOOLTIP_MAX_WIDTH / 2,
        Math.min(centerX, window.innerWidth - VIEWPORT_MARGIN - TOOLTIP_MAX_WIDTH / 2),
      );
      const top =
        placement === "above"
          ? Math.max(VIEWPORT_MARGIN, rect.top - 8)
          : Math.min(window.innerHeight - VIEWPORT_MARGIN, rect.bottom + 8);

      setTip({ text, left, top, placement });
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const host = target.closest<HTMLElement>("[data-soft-tooltip]");
      if (!host) {
        return;
      }
      if (host === activeTarget) {
        return;
      }

      clearTimers();
      activeTarget = host;
      showTimer = window.setTimeout(() => {
        if (activeTarget === host) {
          showFor(host);
        }
      }, SHOW_DELAY_MS);
    };

    const onPointerOut = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const host = target.closest<HTMLElement>("[data-soft-tooltip]");
      if (!host || host !== activeTarget) {
        return;
      }
      const related = event.relatedTarget;
      if (related instanceof Node && host.contains(related)) {
        return;
      }

      clearTimers();
      hideTimer = window.setTimeout(hide, HIDE_DELAY_MS);
    };

    const onScrollOrResize = () => {
      clearTimers();
      hide();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimers();
        hide();
      }
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      clearTimers();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!tip || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={`soft-tooltip soft-tooltip-${tip.placement}`}
      role="tooltip"
      style={{ left: tip.left, top: tip.top }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
