import { loadImportBlobConfig } from './importBlobConfig';
import { FilesystemImportBlobStore } from './filesystemImportBlobStore';
import { S3ImportBlobStore } from './s3ImportBlobStore';
import type { ImportBlobStore } from './importBlobTypes';

let cachedStore: ImportBlobStore | null | undefined;

/** Factory for configured blob backend; `null` when storage is off. */
export function getImportBlobStore(): ImportBlobStore | null {
  if (cachedStore !== undefined) return cachedStore;
  const config = loadImportBlobConfig();
  if (config.backend === 'off') {
    cachedStore = null;
    return cachedStore;
  }
  if (config.backend === 'filesystem') {
    cachedStore = new FilesystemImportBlobStore(config.localRoot);
    return cachedStore;
  }
  cachedStore = new S3ImportBlobStore(config.s3Bucket, config.awsRegion);
  return cachedStore;
}

/** Test hook — reset lazy singleton between cases. */
export function resetImportBlobStoreForTests(): void {
  cachedStore = undefined;
}
