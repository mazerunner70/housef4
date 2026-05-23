/**
 * Internal transfer pairing (see `docs/03_detailed_design/transfer_matching.md`).
 * Import is one entry point; add other pairing flows here over time.
 */

export {
  INGEST_TRANSFER_PAIR_EPSILON,
  INGEST_TRANSFER_PAIR_WINDOW_DAYS,
  computeIngestTransferPairings,
  existingTxnTouchesImportDateWindow,
} from './ingest';
