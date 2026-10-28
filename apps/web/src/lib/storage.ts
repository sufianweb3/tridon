import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Neon Object Storage speaks the S3 API with path-style addressing. The
 * credentials, endpoint and region come from the branch-scoped AWS_* env vars
 * that `neon env pull` writes; only the bucket name is application config.
 */
const BUCKET = process.env.NEON_STORAGE_BUCKET ?? "assets";

let client: S3Client | null = null;

export function storageConfigured(): boolean {
  return Boolean(
    process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function storageBucket(): string {
  return BUCKET;
}

function s3(): S3Client {
  if (!client) {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("Neon Object Storage is not configured.");
    }
    client = new S3Client({
      region: process.env.AWS_REGION ?? "us-east-2",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

export async function putJsonObject(key: string, value: unknown): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "private, max-age=0, no-store",
    }),
  );
}

export async function presignObject(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export function receiptObjectKey(paymentId: string): string {
  return `receipts/${paymentId}.json`;
}
