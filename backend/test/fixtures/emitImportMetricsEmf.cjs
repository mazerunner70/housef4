/**
 * Runs in a subprocess so aws-embedded-metrics resolves Lambda → ConsoleSink.
 */
const {
  emitImportCloudWatchMetrics,
} = require('../../dist/observability/importMetrics');

emitImportCloudWatchMetrics({
  outcome: 'ok',
  totalDurationMs: 120,
  rowCount: 3,
  staging: false,
  stages: {
    '3': { durationMs: 5, outcome: 'ok' },
    '8': { durationMs: 80, outcome: 'ok' },
    '6': { durationMs: 0, outcome: 'skipped' },
  },
})
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
