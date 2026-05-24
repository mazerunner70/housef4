const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function withEnv(t, env, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(env)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return fn();
}

function loadImportMetricsModule() {
  const modPath = path.join(__dirname, '../dist/observability/importMetrics.js');
  delete require.cache[modPath];
  return require(modPath);
}

test('shouldEmitImportCloudWatchMetrics — false for local APP_ENV', (t) => {
  withEnv(t, { APP_ENV: 'local', AWS_LAMBDA_FUNCTION_NAME: 'fn' }, () => {
    const { shouldEmitImportCloudWatchMetrics } = loadImportMetricsModule();
    assert.equal(shouldEmitImportCloudWatchMetrics(), false);
  });
});

test('shouldEmitImportCloudWatchMetrics — false without Lambda runtime', (t) => {
  withEnv(
    t,
    { APP_ENV: 'production', AWS_LAMBDA_FUNCTION_NAME: undefined },
    () => {
      const { shouldEmitImportCloudWatchMetrics } = loadImportMetricsModule();
      assert.equal(shouldEmitImportCloudWatchMetrics(), false);
    },
  );
});

test('shouldEmitImportCloudWatchMetrics — true on Lambda when not local', (t) => {
  withEnv(
    t,
    { APP_ENV: 'production', AWS_LAMBDA_FUNCTION_NAME: 'housef4-api' },
    () => {
      const { shouldEmitImportCloudWatchMetrics } = loadImportMetricsModule();
      assert.equal(shouldEmitImportCloudWatchMetrics(), true);
    },
  );
});

test('emitImportCloudWatchMetrics — EMF stdout in fresh Lambda subprocess', () => {
  const fixture = path.join(__dirname, 'fixtures', 'emitImportMetricsEmf.cjs');
  const result = spawnSync(process.execPath, [fixture], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_ENV: 'production',
      AWS_LAMBDA_FUNCTION_NAME: 'housef4-api-test',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const emfLines = result.stdout
    .split('\n')
    .filter((l) => l.includes('"_aws"'));
  assert.ok(emfLines.length >= 2, `expected EMF lines, got: ${result.stdout}`);
  const parsed = JSON.parse(emfLines[0]);
  assert.equal(parsed._aws.CloudWatchMetrics[0].Namespace, 'Housef4/Import');
  assert.ok(emfLines.some((l) => l.includes('ImportTotalDurationMs')));
  assert.ok(emfLines.some((l) => l.includes('ImportStageDurationMs')));
});
