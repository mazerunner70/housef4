/**
 * Internal transfer pairing per `docs/03_detailed_design/transfer_matching.md` §3–4
 * and `transfer_matching_centre_window_algorithm.md` (epoch-ms window + sliding indices).
 * Pure logic: callers supply legs (with account_id); no Dynamo or HTTP.
 */

import { pairingIsExact, pairingResidualAbs, type Money } from '@housef4/money';

/** Milliseconds per nominal “day” for pairing windows (`|t₁ − t₂| ≤ windowDays × this`). */
export const TRANSFER_PAIRING_DAY_MS = 86_400_000;

export type PairingConfidence = 'exact' | 'within_epsilon';

/** Minimum fields required to run pairing; maps cleanly from persisted transactions + account lookup. */
export interface TransferPairingLeg {
  id: string;
  account_id: string;
  /** Epoch ms; candidates satisfy §3.|date(A) − date(B)| ≤ W × {@link TRANSFER_PAIRING_DAY_MS}. */
  date: number;
  /** Signed canonical amount. */
  canonicalAmount: Money;
  /**
   * When both legs specify currency, they must match. If either omits it, pairing ignores currency
   * (single-currency assumption); FX pairing is out of scope.
   */
  currency?: string;
}

export interface TransferPairingOptions {
  /** Nominal day count **W**: candidates satisfy |date(A) − date(B)| ≤ **W × {@link TRANSFER_PAIRING_DAY_MS}**. */
  windowDays: number;
  /** ISO 4217 code for all amount arithmetic in this run. */
  amountCurrency: string;
  /** Maximum allowed |amount(A) + amount(B)| for a candidate pair. Use `money(0)` for exact integer match. */
  epsilonAmount: Money;
  /** Injected for tests; defaults to `crypto.randomUUID` when available. */
  createPairingId?: () => string;
  /**
   * When set, only legs whose ids are in this set may act as pairing root **A** (§4).
   * Ingest passes new transaction ids so existing↔existing auto pairs are not formed.
   */
  proposalRootIds?: ReadonlySet<string>;
}

export interface TransferPairingAssignment {
  pairing_id: string;
  pairing_source: 'auto';
  pairing_confidence: PairingConfidence;
}

export interface TransferPairingResult {
  /** Leg ids that received an auto pairing in this run. */
  byLegId: Record<string, TransferPairingAssignment>;
}

/** UTC calendar-day distance: whole days between the two instants (historical helper; pairing uses §3 epoch-ms window). */
export function utcCalendarDaysApart(aMs: number, bMs: number): number {
  const da = new Date(aMs);
  const db = new Date(bMs);
  const dayA = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate());
  const dayB = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
  return Math.abs(Math.round((dayA - dayB) / 86_400_000));
}

/** Ordinal UTC calendar day (utility; not used by the pairing window). */
export function utcDayOrdinal(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor(midnight / 86_400_000);
}

function endpointKey(leg: TransferPairingLeg): string {
  return `${leg.account_id}\0${leg.id}`;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function currenciesCompatible(a: TransferPairingLeg, b: TransferPairingLeg): boolean {
  const ca = a.currency;
  const cb = b.currency;
  if (ca && cb && ca !== cb) return false;
  return true;
}

function residualConfidence(
  amountA: Money,
  amountB: Money,
  amountCurrency: string,
): PairingConfidence {
  return pairingIsExact(amountA, amountB, amountCurrency) ? 'exact' : 'within_epsilon';
}

function defaultCreatePairingId(): string {
  const c = globalThis.crypto?.randomUUID;
  if (typeof c === 'function') return c.call(globalThis.crypto);
  throw new Error(
    'transferPairing: provide TransferPairingOptions.createPairingId when crypto.randomUUID is unavailable',
  );
}

/** §3 minus time: distinct id/account, currency guard when both set. */
function isStructuralEligibleExceptWindow(a: TransferPairingLeg, b: TransferPairingLeg): boolean {
  if (b.id === a.id) return false;
  if (b.account_id === a.account_id) return false;
  return currenciesCompatible(a, b);
}

function passesEpsilon(
  a: TransferPairingLeg,
  b: TransferPairingLeg,
  epsilonAmount: Money,
  amountCurrency: string,
): boolean {
  return (
    pairingResidualAbs(a.canonicalAmount, b.canonicalAmount, amountCurrency) <=
    epsilonAmount.units
  );
}

/**
 * §4 / §7: among candidates already ε-feasible, prefer smallest |Δt|, then lexicographic (account_id, id) on B.
 * Residual magnitude is eligibility only — not used to rank feasible partners.
 */
function betterEligiblePartner(
  current: TransferPairingLeg | undefined,
  cand: TransferPairingLeg,
  legA: TransferPairingLeg,
  epsilonAmount: Money,
  amountCurrency: string,
): TransferPairingLeg | undefined {
  if (!passesEpsilon(legA, cand, epsilonAmount, amountCurrency)) return current;
  if (!current) return cand;
  const distCand = Math.abs(legA.date - cand.date);
  const distCur = Math.abs(legA.date - current.date);
  if (distCand !== distCur) return distCand < distCur ? cand : current;
  const c = compareStrings(endpointKey(cand), endpointKey(current));
  return c < 0 ? cand : current;
}

function compareLegDateAsc(x: TransferPairingLeg, y: TransferPairingLeg): number {
  if (x.date !== y.date) return x.date < y.date ? -1 : 1;
  return compareStrings(endpointKey(x), endpointKey(y));
}

function sortLegsByDateAsc(legs: readonly TransferPairingLeg[]): TransferPairingLeg[] {
  return [...legs].sort(compareLegDateAsc);
}

/** Both inputs sorted ascending by {@link compareLegDateAsc}; output merged with the same order. */
function mergeSortedLegPools(
  counterpartLegs: readonly TransferPairingLeg[],
  proposalLegs: readonly TransferPairingLeg[],
): TransferPairingLeg[] {
  const out: TransferPairingLeg[] = [];
  let i = 0;
  let j = 0;
  while (i < counterpartLegs.length && j < proposalLegs.length) {
    const ca = counterpartLegs[i];
    const pb = proposalLegs[j];
    if (ca === undefined || pb === undefined) break;
    if (compareLegDateAsc(ca, pb) <= 0) {
      out.push(ca);
      i++;
    } else {
      out.push(pb);
      j++;
    }
  }
  while (i < counterpartLegs.length) {
    const ca = counterpartLegs[i];
    if (ca === undefined) break;
    out.push(ca);
    i++;
  }
  while (j < proposalLegs.length) {
    const pb = proposalLegs[j];
    if (pb === undefined) break;
    out.push(pb);
    j++;
  }
  return out;
}

interface WindowHints {
  leftHint: number;
  rightHint: number;
}

/** §4 companion: half-open `[left, right)` with `merged[right].date > maxT` or `right === length`. */
function windowHalfOpen(
  merged: readonly TransferPairingLeg[],
  centre: number,
  deltaMs: number,
  hints: WindowHints,
): { left: number; right: number } {
  const centreLeg = merged[centre];
  if (centreLeg === undefined) {
    return { left: hints.leftHint, right: Math.max(hints.leftHint, hints.rightHint) };
  }
  const t = centreLeg.date;
  const minT = t - deltaMs;
  const maxT = t + deltaMs;

  let left = hints.leftHint;
  while (left < merged.length) {
    const row = merged[left];
    if (row !== undefined && row.date >= minT) break;
    left++;
  }

  let r = Math.max(left, hints.rightHint);
  while (r < merged.length) {
    const row = merged[r];
    if (row === undefined || row.date > maxT) break;
    r++;
  }

  hints.leftHint = left;
  hints.rightHint = r;
  return { left, right: r };
}

function bestPartnerInWindow(
  legA: TransferPairingLeg,
  merged: readonly TransferPairingLeg[],
  centre: number,
  left: number,
  right: number,
  epsilonAmount: Money,
  amountCurrency: string,
  paired: ReadonlySet<string>,
): TransferPairingLeg | undefined {
  let best: TransferPairingLeg | undefined;
  for (let i = left; i < right; i++) {
    if (i === centre) continue;
    const cand = merged[i];
    if (cand === undefined) continue;
    if (paired.has(cand.id)) continue;
    if (!isStructuralEligibleExceptWindow(legA, cand)) continue;
    best = betterEligiblePartner(best, cand, legA, epsilonAmount, amountCurrency);
  }
  return best;
}

/**
 * §4 ordered pass: traverse merged chronological order (date, then endpoint key).
 * Roots may be restricted via `proposalRootIds`; each root claims the best remaining available B in its ms window.
 */
function assignPairingsOrderedSweep(
  merged: readonly TransferPairingLeg[],
  options: TransferPairingOptions,
): TransferPairingResult {
  const deltaMs = options.windowDays * TRANSFER_PAIRING_DAY_MS;
  const proposalRootIds = options.proposalRootIds;
  const epsilonAmount = options.epsilonAmount;
  const amountCurrency = options.amountCurrency;
  const nextId = options.createPairingId ?? defaultCreatePairingId;
  const paired = new Set<string>();
  const byLegId: Record<string, TransferPairingAssignment> = {};
  const hints: WindowHints = { leftHint: 0, rightHint: 0 };

  for (let centre = 0; centre < merged.length; centre++) {
    const a = merged[centre];
    if (a === undefined) continue;
    if (proposalRootIds !== undefined && !proposalRootIds.has(a.id)) continue;
    if (paired.has(a.id)) continue;

    const { left, right } = windowHalfOpen(merged, centre, deltaMs, hints);
    const best = bestPartnerInWindow(
      a,
      merged,
      centre,
      left,
      right,
      epsilonAmount,
      amountCurrency,
      paired,
    );
    if (!best) continue;

    const pairing_id = nextId();
    const pairing_confidence = residualConfidence(
      a.canonicalAmount,
      best.canonicalAmount,
      amountCurrency,
    );
    const assignment: TransferPairingAssignment = {
      pairing_id,
      pairing_source: 'auto',
      pairing_confidence,
    };
    byLegId[a.id] = assignment;
    byLegId[best.id] = assignment;
    paired.add(a.id);
    paired.add(best.id);
  }

  return { byLegId };
}

/**
 * Ingest-style fast path: merge counterpart + proposal pools (both date-sorted), then the same §4 sweep
 * using a sliding window on timestamps (`transfer_matching_centre_window_algorithm.md` §§3–5).
 *
 * Complexity: **O(P log P + C log C + |merged|)** for the amortised pointer sweep plus merges.
 */
export function computeAutoTransferPairingsSortedPools(
  counterpartLegs: readonly TransferPairingLeg[],
  proposalLegs: readonly TransferPairingLeg[],
  options: TransferPairingOptions,
): TransferPairingResult {
  const sortedCounterparts = sortLegsByDateAsc(counterpartLegs);
  const sortedProposals = sortLegsByDateAsc(proposalLegs);
  const mergedTimeline = mergeSortedLegPools(sortedCounterparts, sortedProposals);
  const proposalRootIds = options.proposalRootIds ?? new Set(sortedProposals.map((l) => l.id));
  return assignPairingsOrderedSweep(mergedTimeline, { ...options, proposalRootIds });
}

/** Full union pool: sort all legs, then §4 sweep (roots = all ids unless {@link TransferPairingOptions.proposalRootIds} is set). */
export function computeAutoTransferPairings(
  legs: readonly TransferPairingLeg[],
  options: TransferPairingOptions,
): TransferPairingResult {
  const merged = sortLegsByDateAsc(legs);
  return assignPairingsOrderedSweep(merged, options);
}
