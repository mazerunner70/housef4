import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { buildImportBlobObjectKey } from './importBlobKey';
import type {
  ImportBlobStore,
  PutImportBlobInput,
  PutImportBlobResult,
} from './importBlobTypes';
import type { ImportBlobRef } from '@housef4/db';

export class FilesystemImportBlobStore implements ImportBlobStore {
  private rootReady = false;

  constructor(private readonly root: string) {}

  private async ensureRoot(): Promise<void> {
    if (this.rootReady) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.rootReady = true;
  }

  private resolvePath(key: string): string {
    const full = resolve(this.root, key);
    const rootResolved = resolve(this.root);
    if (!full.startsWith(rootResolved + '/') && full !== rootResolved) {
      throw new Error('import blob key escapes storage root');
    }
    return full;
  }

  async put(input: PutImportBlobInput): Promise<PutImportBlobResult> {
    await this.ensureRoot();
    const key = buildImportBlobObjectKey(
      input.userId,
      input.importFileId,
      input.originalName,
    );
    const fullPath = this.resolvePath(key);
    await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
    await writeFile(fullPath, input.body, { mode: 0o600 });

    const written = await stat(fullPath);
    if (written.size !== input.body.length) {
      await unlink(fullPath).catch(() => undefined);
      throw new Error('import blob write size mismatch');
    }

    const ref: ImportBlobRef = {
      kind: 'filesystem',
      key,
      content_sha256: input.contentSha256,
      stored_bytes: input.body.length,
    };
    return { ref };
  }

  async delete(ref: ImportBlobRef): Promise<void> {
    if (ref.kind !== 'filesystem') return;
    const fullPath = this.resolvePath(ref.key);
    await unlink(fullPath).catch(() => undefined);
  }
}
