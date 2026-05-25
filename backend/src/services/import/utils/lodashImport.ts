/**
 * Curated lodash surface for the import pipeline.
 *
 * Import lodash only from this module — add new APIs here when a migration phase
 * needs them (see docs/03_detailed_design/import_fp_migration.md §3.3).
 *
 * Per-method `lodash/*` imports are CJS-safe for `tsc` output (`dist/**` tests) and
 * tree-shakeable when esbuild bundles the Lambda entry.
 */
export { default as compact } from 'lodash/compact';
export { default as constant } from 'lodash/constant';
export { default as countBy } from 'lodash/countBy';
export { default as defaults } from 'lodash/defaults';
export { default as difference } from 'lodash/difference';
export { default as every } from 'lodash/every';
export { default as filter } from 'lodash/filter';
export { default as find } from 'lodash/find';
export { default as flatMap } from 'lodash/flatMap';
export { default as flow } from 'lodash/flow';
export { default as flowRight } from 'lodash/flowRight';
export { default as fromPairs } from 'lodash/fromPairs';
export { default as groupBy } from 'lodash/groupBy';
export { default as identity } from 'lodash/identity';
export { default as isEqual } from 'lodash/isEqual';
export { default as keyBy } from 'lodash/keyBy';
export { default as map } from 'lodash/map';
export { default as mapValues } from 'lodash/mapValues';
export { default as maxBy } from 'lodash/maxBy';
export { default as omit } from 'lodash/omit';
export { default as partition } from 'lodash/partition';
export { default as pick } from 'lodash/pick';
export { default as reject } from 'lodash/reject';
export { default as some } from 'lodash/some';
export { default as sortBy } from 'lodash/sortBy';
export { default as toPairs } from 'lodash/toPairs';
export { default as uniq } from 'lodash/uniq';
export { default as zipWith } from 'lodash/zipWith';

import zipWith from 'lodash/zipWith';

/** Pair arrays of equal length; throws when lengths differ (lodash `zip` pads with undefined). */
export function zipStrict<T, U>(left: readonly T[], right: readonly U[]): [T, U][] {
  if (left.length !== right.length) {
    throw new Error(`zipStrict: length mismatch (${left.length} vs ${right.length})`);
  }
  return zipWith(left, right, (a, b) => [a, b] as [T, U]);
}
