import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { ImportBlobRef } from '@housef4/db';

import { buildImportBlobObjectKey } from './importBlobKey';
import type {
  ImportBlobStore,
  PutImportBlobInput,
  PutImportBlobResult,
} from './importBlobTypes';

export class S3ImportBlobStore implements ImportBlobStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    awsRegion: string,
  ) {
    this.client = new S3Client({ region: awsRegion });
  }

  async put(input: PutImportBlobInput): Promise<PutImportBlobResult> {
    const key = buildImportBlobObjectKey(
      input.userId,
      input.importFileId,
      input.originalName,
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentLength: input.body.length,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
        ServerSideEncryption: 'AES256',
      }),
    );

    const ref: ImportBlobRef = {
      kind: 's3',
      key,
      bucket: this.bucket,
      content_sha256: input.contentSha256,
      stored_bytes: input.body.length,
    };
    return { ref };
  }

  async delete(ref: ImportBlobRef): Promise<void> {
    if (ref.kind !== 's3') return;
    const bucket = ref.bucket ?? this.bucket;
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: ref.key,
      }),
    );
  }
}
