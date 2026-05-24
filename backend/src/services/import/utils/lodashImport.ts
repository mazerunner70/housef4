/**
 * Curated lodash-es surface for the import pipeline.
 *
 * Import lodash only from this module — add new APIs here when a migration phase
 * needs them (see docs/03_detailed_design/import_fp_migration.md §3.3).
 *
 * Named re-exports keep esbuild Lambda bundles tree-shakeable.
 */
export {
  compact,
  constant,
  countBy,
  defaults,
  difference,
  every,
  filter,
  find,
  flatMap,
  flow,
  flowRight,
  fromPairs,
  groupBy,
  identity,
  isEqual,
  keyBy,
  mapValues,
  maxBy,
  omit,
  partition,
  pick,
  reject,
  some,
  sortBy,
  toPairs,
  uniq,
  zipWith,
} from 'lodash-es';

import { zipWith } from 'lodash-es';

/** Pair arrays of equal length; throws when lengths differ (lodash `zip` pads with undefined). */
export function zipStrict<T, U>(left: readonly T[], right: readonly U[]): [T, U][] {
  if (left.length !== right.length) {
    throw new Error(`zipStrict: length mismatch (${left.length} vs ${right.length})`);
  }
  return zipWith(left, right, (a, b) => [a, b] as [T, U]);
}
