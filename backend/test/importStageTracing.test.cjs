const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createImportStageTracer,
  IMPORT_STAGE_IDS,
} = require('../dist/services/import/importStageTracing');

function captureLogger() {
  const lines = [];
  return {
    lines,
    log: {
      debug: (msg, fields) => lines.push({ level: 'debug', msg, ...fields }),
      info: (msg, fields) => lines.push({ level: 'info', msg, ...fields }),
      warn: (msg, fields) => lines.push({ level: 'warn', msg, ...fields }),
      error: (msg, fields) => lines.push({ level: 'error', msg, ...fields }),
    },
  };
}

test('createImportStageTracer — records stage durations and emits summary', async () => {
  const { log, lines } = captureLogger();
  const tracer = createImportStageTracer({ userId: 'u1' }, log);

  const value = await tracer.run('3', async () => {
    await new Promise((r) => setTimeout(r, 5));
    return 42;
  });
  assert.equal(value, 42);

  tracer.setContext({ importFileId: 'file-1', rowCount: 0 });
  tracer.markSkipped('6', 'zero_rows');
  tracer.emitSummary('ok');

  const summary = lines.find((l) => l.msg === 'import.stages.summary');
  assert.ok(summary);
  assert.equal(summary.outcome, 'ok');
  assert.equal(summary.userId, 'u1');
  assert.equal(summary.importFileId, 'file-1');
  assert.equal(summary.rowCount, 0);
  assert.ok(summary.stages['3'].durationMs >= 0);
  assert.equal(summary.stages['3'].outcome, 'ok');
  assert.equal(summary.stages['6'].outcome, 'skipped');
  assert.equal(summary.stages['6'].skipReason, 'zero_rows');

  const stageDebug = lines.filter((l) => l.msg === 'import.stage');
  assert.equal(stageDebug.length, 1);
  assert.equal(stageDebug[0].stage, '3');
  assert.equal(stageDebug[0].outcome, 'ok');
});

test('createImportStageTracer — failed stage sets failedStage and warns', async () => {
  const { log, lines } = captureLogger();
  const tracer = createImportStageTracer({ userId: 'u2' }, log);

  await assert.rejects(
    () =>
      tracer.run('2b', async () => {
        throw new Error('duplicate');
      }),
    /duplicate/,
  );

  assert.equal(tracer.failedStage, '2b');
  tracer.emitSummary('error');

  const summary = lines.find((l) => l.msg === 'import.stages.summary');
  assert.equal(summary.outcome, 'error');
  assert.equal(summary.failedStage, '2b');
  assert.equal(summary.stages['2b'].outcome, 'error');

  const warn = lines.find((l) => l.msg === 'import.stage' && l.level === 'warn');
  assert.equal(warn.stage, '2b');
  assert.equal(warn.errorName, 'Error');
});

test('traceStage — invokes fn directly when tracer is absent', async () => {
  const { traceStage } = require('../dist/services/import/utils/traceStage');
  const value = await traceStage(undefined, '9', () => 99);
  assert.equal(value, 99);
});

test('traceStage — delegates to tracer.run when present', async () => {
  const { traceStage } = require('../dist/services/import/utils/traceStage');
  const { log, lines } = captureLogger();
  const tracer = createImportStageTracer({ userId: 'u-trace' }, log);

  const value = await traceStage(tracer, '8', async () => 'pipeline');
  assert.equal(value, 'pipeline');
  assert.ok(lines.some((l) => l.msg === 'import.stage' && l.stage === '8'));
});

test('IMPORT_STAGE_IDS — covers §4.2 numbered stages including 2b', () => {
  for (const id of ['1', '2', '2b', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']) {
    assert.ok(IMPORT_STAGE_IDS.includes(id), `missing stage ${id}`);
  }
});

test('createImportStageTracer — sums repeated stage id durations (stage 2 validate + resolve)', async () => {
  const { log, lines } = captureLogger();
  const tracer = createImportStageTracer({ userId: 'u3' }, log);

  await tracer.run('2', async () => {
    await new Promise((r) => setTimeout(r, 2));
  });
  await tracer.run('2', async () => {
    await new Promise((r) => setTimeout(r, 3));
  });
  tracer.emitSummary('ok');

  const summary = lines.find((l) => l.msg === 'import.stages.summary');
  assert.ok(summary.stages['2'].durationMs >= 5);
  assert.equal(summary.stages['2'].outcome, 'ok');
});
