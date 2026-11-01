import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks two DOM APIs that Radix calls (Select, Toast): minimal no-op
// stubs, only what the component tests need.
const elementProto = Element.prototype as unknown as Record<string, unknown>;
elementProto.hasPointerCapture ??= () => false;
elementProto.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
});
