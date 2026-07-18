export type StoredObject = {
  body: Uint8Array;
  contentType: string | undefined;
  etag: string | undefined;
};

export function s3ClientConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): S3ClientConfig {
  const region = environment["S3_REGION"];
  if (region === undefined || region.length === 0) throw new Error("S3_REGION is required.");
  const accessKeyId = environment["S3_ACCESS_KEY_ID"];
  const secretAccessKey = environment["S3_SECRET_ACCESS_KEY"];
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
    throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together.");
  }
  const endpoint = environment["S3_ENDPOINT"];
  return {
    region,
    ...(accessKeyId === undefined || secretAccessKey === undefined
      ? {}
      : { credentials: { accessKeyId, secretAccessKey } }),
    ...(endpoint === undefined ? {} : { endpoint, forcePathStyle: true }),
  };
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<{ etag?: string }>;
  get(key: string): Promise<StoredObject | undefined>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  removePrefix(prefix: string): Promise<number>;
}

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, StoredObject>();

  public async put(
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<{ etag?: string }> {
    this.#objects.set(key, { body: Uint8Array.from(body), contentType, etag: undefined });
    return {};
  }

  public async get(key: string): Promise<StoredObject | undefined> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return undefined;
    return { ...stored, body: Uint8Array.from(stored.body) };
  }

  public async remove(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  public async list(prefix: string): Promise<string[]> {
    return [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  public async removePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    for (const key of keys) this.#objects.delete(key);
    return keys.length;
  }
}

export class S3ObjectStore implements ObjectStore {
  readonly #client: S3Client;

  public constructor(
    private readonly bucket: string,
    config: S3ClientConfig,
  ) {
    this.#client = new S3Client(config);
  }

  public async put(
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<{ etag?: string }> {
    const response = await this.#client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType === undefined ? {} : { ContentType: contentType }),
      }),
    );
    return response.ETag === undefined ? {} : { etag: response.ETag };
  }

  public async get(key: string): Promise<StoredObject | undefined> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (response.Body === undefined) return undefined;
      return {
        body: await response.Body.transformToByteArray(),
        contentType: response.ContentType,
        etag: response.ETag,
      };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.name === "NoSuchKey" || error.$metadata.httpStatusCode === 404)
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async remove(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  public async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        }),
      );
      keys.push(
        ...(response.Contents ?? []).flatMap((item) => (item.Key === undefined ? [] : [item.Key])),
      );
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return keys;
  }

  public async removePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    for (let offset = 0; offset < keys.length; offset += 1_000) {
      const batch = keys.slice(offset, offset + 1_000);
      if (batch.length === 0) continue;
      await this.#client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    return keys.length;
  }
}
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
