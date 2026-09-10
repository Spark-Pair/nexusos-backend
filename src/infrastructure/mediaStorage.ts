import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppConfig } from '../config.js'

export interface MediaStorage {
  saveImage(file: { buffer: Buffer; mimetype: string; originalname: string }): Promise<string>
  readUrl(key: string): Promise<string>
}

const extensionFor = (mimeType: string) =>
  mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'

export const mediaKeySchema = /^broadcasts-[a-f0-9-]+\.(?:jpg|png|webp)$/u

class LocalMediaStorage implements MediaStorage {
  private readonly directory = resolve(process.cwd(), 'uploads')

  async saveImage(file: { buffer: Buffer; mimetype: string }) {
    await mkdir(this.directory, { recursive: true })
    const key = `broadcasts-${crypto.randomUUID()}.${extensionFor(file.mimetype)}`
    await writeFile(resolve(this.directory, key), file.buffer)
    return key
  }

  readUrl(key: string) {
    return Promise.resolve(`/uploads/${key}`)
  }
}

class R2MediaStorage implements MediaStorage {
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey }
    })
  }

  async saveImage(file: { buffer: Buffer; mimetype: string }) {
    const key = `broadcasts-${crypto.randomUUID()}.${extensionFor(file.mimetype)}`
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'private, max-age=31536000, immutable'
      })
    )
    return key
  }

  async readUrl(key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      }),
      { expiresIn: 60 * 5 }
    )
  }
}

export function createMediaStorage(config: AppConfig): MediaStorage {
  if (
    config.R2_BUCKET &&
    config.R2_ENDPOINT &&
    config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY
  )
    return new R2MediaStorage(
      config.R2_BUCKET,
      config.R2_ENDPOINT,
      config.R2_ACCESS_KEY_ID,
      config.R2_SECRET_ACCESS_KEY
    )
  return new LocalMediaStorage()
}
