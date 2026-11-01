import { act } from '@testing-library/react';

type Callback = (entries: { contentRect: { width: number } }[]) => void;

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
  emit(width: number) {
    this.callback([{ contentRect: { width } }]);
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

export function resizeTo(width: number) {
  act(() => FakeResizeObserver.instances.forEach((i) => i.emit(width)));
}
