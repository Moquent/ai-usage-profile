import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const objectStoreConfigSchema = z.object({
  endpoint: z.url(),
  accessKey: z.string().min(1),
  secretKey: z.string().min(8),
  bucketCards: z.string().min(1).default("cards"),
});

export function loadObjectStoreConfig(environment = process.env) {
  const endpoint = environment.S3_ENDPOINT;
  const accessKey = environment.S3_ACCESS_KEY ?? environment.MINIO_ROOT_USER;
  const secretKey = environment.S3_SECRET_KEY ?? environment.MINIO_ROOT_PASSWORD;
  if (!endpoint || !accessKey || !secretKey) return null;
  return objectStoreConfigSchema.parse({
    endpoint,
    accessKey,
    secretKey,
    bucketCards: environment.S3_BUCKET_CARDS,
  });
}

export class MinioCardStore {
  constructor({ endpoint, accessKey, secretKey, bucketCards }) {
    this.bucket = bucketCards;
    this.client = new S3Client({
      endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true,
    });
  }

  async putCard(slug, filename, svg, { revision, collectedAt }) {
    const etag = `"${revision}"`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${slug}/${filename}`,
      Body: svg,
      ContentType: "image/svg+xml; charset=utf-8",
      CacheControl: "public, max-age=0, must-revalidate",
      Metadata: {
        revision: String(revision),
        collectedat: collectedAt,
      },
    }));
    return etag;
  }

  async health() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return { ok: true };
  }
}

export function createCardStore(config) {
  if (!config) return null;
  return new MinioCardStore(config);
}
