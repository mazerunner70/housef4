/**
 * Optional integration test: Cognito login + CloudFront/API JWT smoke.
 * Not run by default (needs AWS creds, Terraform outputs, test user).
 *
 *   export RUN_COGNITO_SMOKE=1
 *   export AWS_REGION=eu-west-2
 *   export COGNITO_TEST_EMAIL=...
 *   export COGNITO_TEST_PASSWORD=...
 *   pnpm --filter @housef4/backend run test:integration-cognito
 *
 * Or pass --from-terraform via argv (script forwards to bash).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const skip = process.env.RUN_COGNITO_SMOKE !== '1';

test(
  'cognito-login-and-smoke.sh (static + /api/health + /api/me with IdToken)',
  { skip },
  () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const script = path.join(repoRoot, 'scripts', 'cognito-login-and-smoke.sh');
    const args = [script, '--from-terraform'];
    const r = spawnSync('bash', args, {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: repoRoot,
    });
    assert.equal(
      r.status,
      0,
      'cognito-login-and-smoke.sh failed (bootstrap user? IAM? terraform apply?)',
    );
  },
);
