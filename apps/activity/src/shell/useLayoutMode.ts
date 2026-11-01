import { useLayoutEffect, useState, type RefObject } from 'react';

export type LayoutMode = 'compact' | 'narrow' | 'medium' | 'wide' | 'ultrawide';

/**
 * `layout_mode` values of Discord's ACTIVITY_LAYOUT_MODE_UPDATE: UNHANDLED -1, FOCUSED 0, PIP 1, GRID 2.
 * SDK 2.5.0 has no getter for the current layout mode, only the update event. An
 * Activity that starts in PIP therefore becomes compact on the first event, or
 * through the narrow width of its window, whichever comes first.
 */
const DISCORD_PIP = 1;

/** Spec 4.4. Discord's picture-in-picture window wins; every other mode follows the width. */
export function layoutModeFor(width: number, discordMode: number | null | undefined): LayoutMode {
  if (discordMode === DISCORD_PIP || width < 320) return 'compact';
  if (width < 720) return 'narrow';
  if (width < 1280) return 'medium';
  if (width < 1920) return 'wide';
  return 'ultrawide';
}

/**
 * Measures the width of `target` (the shell itself, not the window), so the
 * mode stays right when Discord resizes the Activity panel. Only decides what
 * to render; the layout is CSS container queries.
 */
export function useLayoutMode(
  discordMode: number | null | undefined,
  target: RefObject<HTMLElement | null>,
): LayoutMode {
  const [width, setWidth] = useState(() => window.innerWidth);

  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    // jsdom and hidden elements report 0; the window is the best guess then.
    setWidth(element.getBoundingClientRect().width || window.innerWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // The border box is what the layout uses; older engines only report the content box.
      setWidth(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);

  return layoutModeFor(width, discordMode);
}
