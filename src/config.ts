import 'dotenv/config'
import { z } from 'zod'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8000),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    FRONTEND_ORIGINS: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default('nexusos-api'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    ADMIN_EMAILS: z.string().default(''),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_ENDPOINT: z.string().url().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional()
  })
  .superRefine((value, context) => {
    if (Boolean(value.VAPID_PUBLIC_KEY) !== Boolean(value.VAPID_PRIVATE_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'Both VAPID keys are required together.'
      })
    }
    const r2Values = [
      value.R2_ACCOUNT_ID,
      value.R2_BUCKET,
      value.R2_ENDPOINT,
      value.R2_ACCESS_KEY_ID,
      value.R2_SECRET_ACCESS_KEY
    ]
    if (r2Values.some(Boolean) && !r2Values.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        path: ['R2_BUCKET'],
        message: 'All R2 settings are required when R2 storage is enabled.'
      })
    }
  })

export type AppConfig = z.infer<typeof schema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(environment)
}
