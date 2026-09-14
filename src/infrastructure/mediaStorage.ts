import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppConfig } from '../config.js'

export interface MediaReadResult {
  body: NodeJS.ReadableStream
  contentType: string
  contentLength?: number | undefined
}

export interface MediaStorage {
  saveImage(file: { buffer: Buffer; mimetype: string; originalname: string }): Promise<string>
  saveAudio(file: { buffer: Buffer; mimetype: string; originalname: string }): Promise<string>
  readMedia(key: string): Promise<MediaReadResult>
}

const extensionFor = (mimeType: string) =>
  mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'

const audioExtensionFor = (mimeType: string) => (mimeType === 'audio/mpeg' ? 'mp3' : 'webm')

const contentTypeFor = (key: string) =>
  key.endsWith('.png')
    ? 'image/png'
    : key.endsWith('.webp')
      ? 'image/webp'
      : key.endsWith('.webm')
        ? 'audio/webm'
        : key.endsWith('.mp3')
          ? 'audio/mpeg'
          : 'image/jpeg'

export const mediaKeySchema = /^(?:broadcasts|audio)-[a-f0-9-]+\.(?:jpg|png|webp|webm|mp3)$/u

class LocalMediaStorage implements MediaStorage {
  private readonly directory = resolve(process.cwd(), 'uploads')

  async saveImage(file: { buffer: Buffer; mimetype: string }) {
    await mkdir(this.directory, { recursive: true })
    const key = `broadcasts-${crypto.randomUUID()}.${extensionFor(file.mimetype)}`
    await writeFile(resolve(this.directory, key), file.buffer)
    return key
  }

  async saveAudio(file: { buffer: Buffer; mimetype: string }) {
    await mkdir(this.directory, { recursive: true })
    const key = `audio-${crypto.randomUUID()}.${audioExtensionFor(file.mimetype)}`
    await writeFile(resolve(this.directory, key), file.buffer)
    return key
  }

  readMedia(key: string) {
    return Promise.resolve({
      body: createReadStream(resolve(this.directory, key)),
      contentType: contentTypeFor(key)
    })
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

  async saveAudio(file: { buffer: Buffer; mimetype: string }) {
    const key = `audio-${crypto.randomUUID()}.${audioExtensionFor(file.mimetype)}`
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

  async readMedia(key: string) {
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    )
    if (!object.Body || !('pipe' in object.Body))
      throw new Error('Media object body is unavailable.')
    return {
      body: object.Body as NodeJS.ReadableStream,
      contentType: object.ContentType ?? contentTypeFor(key),
      contentLength: object.ContentLength
    }
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
