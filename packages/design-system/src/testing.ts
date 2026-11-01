import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Fails when axe finds accessibility violations in the rendered container.
 * Colour contrast is off: jsdom has no layout, and the contrast of the
 * themes is covered by themes.test.ts. The page-level `region` rule is off
 * too: a component is rendered without the landmarks of a whole page.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
  expect(summary).toEqual([]);
}
