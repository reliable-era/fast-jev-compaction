import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

describe('pi package wiring for reliable-era fork', () => {
  const pkg = readJson(join(root, 'package.json'));

  it('declares a loadable pi extension entry that is shipped with the package', () => {
    expect(pkg.keywords).toContain('pi-package');
    expect(pkg.keywords).toContain('pi-extension');
    expect(pkg.pi?.extensions).toEqual(['./pi/index.ts']);
    expect(pkg.files).toContain('pi');
    expect(pkg.files).toContain('src');
    expect(existsSync(join(root, 'pi', 'index.ts'))).toBe(true);
    expect(existsSync(join(root, 'pi', 'core.ts'))).toBe(true);
  });

  it('uses pi host packages as optional peers rather than bundling a duplicate pi runtime', () => {
    expect(pkg.peerDependencies?.['@earendil-works/pi-coding-agent']).toBe('*');
    expect(pkg.peerDependenciesMeta?.['@earendil-works/pi-coding-agent']?.optional).toBe(true);
    expect(pkg.dependencies?.['@earendil-works/pi-coding-agent']).toBeUndefined();
  });

  it('points repository metadata and pi install docs at the reliable-era fork', () => {
    expect(pkg.repository?.url).toBe('git+https://github.com/reliable-era/fast-jev-compaction.git');
    expect(pkg.homepage).toBe('https://github.com/reliable-era/fast-jev-compaction#readme');
    expect(pkg.bugs?.url).toBe('https://github.com/reliable-era/fast-jev-compaction/issues');

    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const piReadme = readFileSync(join(root, 'pi', 'README.md'), 'utf8');
    expect(readme).toContain('pi install git:github.com/reliable-era/fast-jev-compaction');
    expect(piReadme).toContain('pi install git:github.com/reliable-era/fast-jev-compaction');
    expect(piReadme).not.toContain('pi install git:github.com/tamaratran/fast-jev-compaction');
  });
});
