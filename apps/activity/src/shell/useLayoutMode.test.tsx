import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeResizeObserver, installFakeResizeObserver, removeFakeResizeObserver, resizeBorderBox, resizeTo } from '../testing/fakeResizeObserver.js';
import { layoutModeFor, useLayoutMode } from './useLayoutMode.js';

function Probe({ discordMode }: { discordMode: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useLayoutMode(discordMode, ref);
  return (
    <div ref={ref} data-testid="probe">
      {mode}
    </div>
  );
}

describe('layoutModeFor', () => {
  it('uses the boundaries 320, 720, 1280 and 1920', () => {
    const at = (w: number) => layoutModeFor(w, null);
    expect([at(319), at(320)]).toEqual(['compact', 'narrow']);
    expect([at(719), at(720)]).toEqual(['narrow', 'medium']);
    expect([at(1279), at(1280)]).toEqual(['medium', 'wide']);
    expect([at(1919), at(1920)]).toEqual(['wide', 'ultrawide']);
  });

  it('is compact in the Discord PIP mode at any width, while grid, focused and unhandled follow the width', () => {
    expect(layoutModeFor(2400, 1)).toBe('compact');
    expect(layoutModeFor(900, 2)).toBe('medium');
    expect(layoutModeFor(900, 0)).toBe('medium');
    expect(layoutModeFor(900, -1)).toBe('medium');
  });
});

describe('useLayoutMode', () => {
  beforeEach(installFakeResizeObserver);
  afterEach(removeFakeResizeObserver);

  it('follows the width of the element, not of the window', () => {
    render(<Probe discordMode={null} />);
    resizeTo(500);
    expect(screen.getByTestId('probe').textContent).toBe('narrow');
    resizeTo(1500);
    expect(screen.getByTestId('probe').textContent).toBe('wide');
    resizeTo(1920);
    expect(screen.getByTestId('probe').textContent).toBe('ultrawide');
  });

  it('lets the Discord PIP mode win over the width and restores the width afterwards', () => {
    const { rerender } = render(<Probe discordMode={null} />);
    resizeTo(1500);
    rerender(<Probe discordMode={1} />);
    expect(screen.getByTestId('probe').textContent).toBe('compact');
    rerender(<Probe discordMode={2} />);
    expect(screen.getByTestId('probe').textContent).toBe('wide');
  });

  it('stops observing on unmount', () => {
    const { unmount } = render(<Probe discordMode={null} />);
    expect(FakeResizeObserver.instances).toHaveLength(1);
    unmount();
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });
});

describe('useLayoutMode box size', () => {
  beforeEach(installFakeResizeObserver);
  afterEach(removeFakeResizeObserver);

  it('prefers the border box and falls back to the content rect', () => {
    render(<Probe discordMode={null} />);
    resizeBorderBox(700, 740); // content box says narrow, border box says medium
    expect(screen.getByTestId('probe').textContent).toBe('medium');
    resizeTo(700);
    expect(screen.getByTestId('probe').textContent).toBe('narrow');
  });
});
