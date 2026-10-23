import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace code is bundled; npm dependencies stay external and are installed in the image.
  noExternal: ['@tresor/shared'],
  external: ['@electric-sql/pglite'],
  define: { __APP_VERSION__: JSON.stringify(version) },
});
