import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const retired = [
  'src/lib/savedJobRecord.js',
  'src/lib/useSavedJobMutation.js',
  'src/lib/searchJobs.js',
  'src/components/JobSearchMapView.jsx',
];
const withoutExtension = file => file.replace(/\.(?:m?js|jsx)$/, '');
const source = file => readFileSync(path.join(root, file), 'utf8');
function modules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? modules(file) : /\.(?:m?js|jsx)$/.test(file) ? [file] : [];
  });
}

test('retired forwarding modules stay absent and source/test imports target their owners', () => {
  const oldPaths = new Set(retired.map(file => withoutExtension(path.join(root, file))));
  for (const file of retired) assert.equal(existsSync(path.join(root, file)), false, file);
  for (const file of [...modules(path.join(root, 'src')), ...modules(path.join(root, 'scripts'))]) {
    const text = readFileSync(file, 'utf8');
    for (const [, specifier] of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)) {
      if (!specifier.startsWith('.')) continue;
      // This browser harness writes its embedded JSX at the repository root.
      const directory = file === path.join(root, 'scripts/search-photo-swipe.browser.mjs') && specifier.startsWith('./src/')
        ? root : path.dirname(file);
      const resolved = withoutExtension(path.resolve(directory, specifier));
      assert.equal(oldPaths.has(resolved), false, `${path.relative(root, file)} imports ${specifier}`);
    }
  }
});

test('search route keeps lazy loading and preview uses the same named feature export', () => {
  assert.match(source('src/app/routes.jsx'), /export const JobSearchMapView = lazyChunk\(\(\) => import\("\.\.\/features\/jobs\/search\/JobSearchMapView"\)\.then\(m => \(\{ default: m\.JobSearchMapView \}\)\)\);/);
  assert.match(source('src/features/jobs/create/LandingFlow.jsx'), /import \{ JobSearchMapView \} from "\.\.\/search\/JobSearchMapView";/);
});

test('ProfileHub retains its required forwarding entry without a second implementation', () => {
  assert.match(source('src/components/ProfileHub.jsx'), /import \{ LikedJobs \} from "\.\/LikedJobs";/);
  const entry = source('src/components/LikedJobs.jsx').replace(/^\/\/.*\n/gm, '').trim();
  assert.equal(entry, "export { LikedJobs } from '../features/jobs/favorites/LikedJobs.jsx';");
});
