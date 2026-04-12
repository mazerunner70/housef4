/**
 * Produces dist-lambda/index.js for AWS. Fails if anything in the bundle graph
 * loads the local HTTP adapter (localServer must never ship to Lambda).
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const forbidLocalServer = {
  name: 'forbid-local-server-in-lambda',
  setup(build) {
    build.onLoad({ filter: /localServer\.ts$/ }, () => ({
      errors: [
        {
          text:
            'localServer.ts must not be imported from the Lambda bundle graph. ' +
            'It is for local development only (see package.json start:local).',
        },
      ],
    }));
  },
};

await esbuild.build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(root, 'dist-lambda/index.js'),
  logLevel: 'warning',
  plugins: [forbidLocalServer],
});
