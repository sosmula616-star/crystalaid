// Fails when a stylesheet outside the token and theme files contains a hex color.
// Usage: node scripts/check-css-colors.mjs [rootDir]
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ALLOWED = new Set(['tokens.css', 'themes.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

function* cssFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* cssFiles(join(dir, entry.name));
    } else if (entry.name.endsWith('.css') && !ALLOWED.has(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

const root = resolve(process.argv[2] ?? process.cwd());
const problems = [];
for (const file of cssFiles(root)) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const match of line.matchAll(HEX)) {
        problems.push(`${relative(root, file)}:${index + 1}: hex color ${match[0]} is not allowed, use a token`);
      }
    });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
