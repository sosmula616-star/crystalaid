import { act } from '@testing-library/react';

interface FakeEntry {
  contentRect: { width: number };
  borderBoxSize?: { inlineSize: number }[];
}

type Callback = (entries: FakeEntry[]) => void;

/** Test double: jsdom has no layout, so tests push widths by hand. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private readonly callback: Callback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    FakeResizeObserver.instances = FakeResizeObserver.instances.filter((i) => i !== this);
  }
  emit(entry: FakeEntry) {
    this.callback([entry]);
  }
}

export function installFakeResizeObserver() {
  FakeResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
}

export function removeFakeResizeObserver() {
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  FakeResizeObserver.instances = [];
}

/** Reports `width` as the content box only, like an engine without `borderBoxSize`. */
export function resizeTo(width: number) {
  act(() => FakeResizeObserver.instances.forEach((i) => i.emit({ contentRect: { width } })));
}

/** Reports a border box that differs from the content box (padding or border). */
export function resizeBorderBox(contentWidth: number, borderBoxWidth: number) {
  act(() =>
    FakeResizeObserver.instances.forEach((i) =>
      i.emit({ contentRect: { width: contentWidth }, borderBoxSize: [{ inlineSize: borderBoxWidth }] }),
    ),
  );
}
