import type { ImportBlobRef } from '@housef4/db';

export type PutImportBlobInput = Readonly<{
  userId: string;
  importFileId: string;
  accountId: string;
  /** Original client filename (Content-Disposition metadata only). */
  originalName: string;
  contentType?: string;
  contentSha256: string;
  body: Buffer;
}>;

export type PutImportBlobResult = Readonly<{
  ref: ImportBlobRef;
}>;

export interface ImportBlobStore {
  put(input: PutImportBlobInput): Promise<PutImportBlobResult>;
  delete(ref: ImportBlobRef): Promise<void>;
}
