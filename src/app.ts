import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import multer from 'multer'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { AuthError, AuthService } from './application/AuthService.js'
import { MessagingService } from './application/MessagingService.js'
import { PushNotificationService } from './application/PushNotificationService.js'
import {
  DevelopmentOtpDeliveryProvider,
  UnconfiguredSmsDeliveryProvider
} from './application/OtpDeliveryProvider.js'
import type { AppConfig } from './config.js'
import type { AuthRepository } from './domain/auth.js'
import type { MessagingRepository } from './domain/messaging.js'
import type { BroadcastRepository } from './domain/broadcast.js'
import {
  createMediaStorage,
  mediaKeySchema,
  type MediaStorage
} from './infrastructure/mediaStorage.js'

interface GoogleExchangeDependencies {
  verifyIdToken: (
    idToken: string
  ) => Promise<{ sub: string; email: string; emailVerified: boolean; name: string }>
  warn: (message: string, metadata: Record<string, unknown>) => void
}

function decodeGoogleTokenAudience(idToken: string) {
  const payload = idToken.split('.')[1]
  if (!payload) return undefined
  try {
    const normalized = payload.replace(/-/gu, '+').replace(/_/gu, '/')
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as {
      aud?: unknown
    }
    return typeof decoded.aud === 'string' ? decoded.aud : undefined
  } catch {
    return undefined
  }
}

function createGoogleDependencies(config: AppConfig): GoogleExchangeDependencies {
  const client = new OAuth2Client(config.GOOGLE_CLIENT_ID)
  return {
    verifyIdToken: async (idToken) => {
      const audience = config.GOOGLE_CLIENT_ID
      if (!audience) throw new AuthError('Google sign-in is not configured.', 503)
      const ticket = await client.verifyIdToken({ idToken, audience })
      const payload = ticket.getPayload()
      if (!payload?.sub || !payload.email) throw new AuthError('Invalid Google token.', 401)
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name ?? 'NexusOS user'
      }
    },
    warn: (message, metadata) => console.warn(message, metadata)
  }
}

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  device_name: z.string().min(1).max(100).optional()
})
const accountKind = z.enum(['customer', 'business'])
export function createApp(
  config: AppConfig,
  repository: AuthRepository & MessagingRepository & BroadcastRepository,
  googleDependencies: GoogleExchangeDependencies = createGoogleDependencies(config),
  publishRealtime: (
    userId: string,
    payload: { conversationId: string; title?: string; body?: string; url?: string }
  ) => void = () => undefined,
  mediaStorage: MediaStorage = createMediaStorage(config)
) {
  const app = express()
  app.set('trust proxy', 1)
  const uploadDirectory = resolve(process.cwd(), 'uploads')
  mkdirSync(uploadDirectory, { recursive: true })
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 10 },
    fileFilter: (_request, file, done) =>
      done(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
  })
  const otpDelivery =
    config.OTP_DELIVERY_MODE === 'development'
      ? new DevelopmentOtpDeliveryProvider()
      : new UnconfiguredSmsDeliveryProvider()
  const auth = new AuthService(repository, config, otpDelivery)
  const push = new PushNotificationService(repository, config)
  const messaging = new MessagingService(repository, async (userId, payload) => {
    publishRealtime(userId, {
      conversationId: payload.url.split('/').at(-1) ?? '',
      title: payload.title,
      body: payload.body,
      url: payload.url
    })
    await push.send(userId, payload)
  })
  app.use(helmet())
  const allowedOrigins = (config.FRONTEND_ORIGINS ?? config.FRONTEND_URL)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true)
        else callback(new AuthError('Origin is not allowed.', 403))
      }
    })
  )
  app.use(express.json({ limit: '32kb' }))
  app.use(
    '/uploads',
    express.static(uploadDirectory, { immutable: true, maxAge: '30d', dotfiles: 'deny' })
  )
  app.get('/api/media/:key', async (request, response) => {
    const key = z.string().regex(mediaKeySchema).parse(request.params.key)
    const image = await mediaStorage.readImage(key)
    response.setHeader('Content-Type', image.contentType)
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    if (image.contentLength) response.setHeader('Content-Length', String(image.contentLength))
    image.body.pipe(response)
  })
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  })
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
  app.get('/api/push/public-key', (_request, response) =>
    response.json({ public_key: config.VAPID_PUBLIC_KEY ?? null })
  )
  const bearerToken = (header: string | undefined) => {
    const match = /^Bearer\s+(.+)$/iu.exec(header ?? '')
    if (!match?.[1]) throw new AuthError('Authentication is required.', 401)
    return match[1]
  }
  const actor = async (header: string | undefined) => (await auth.restore(bearerToken(header))).data
  const adminActor = async (header: string | undefined) => {
    const current = await actor(header)
    if (!current.is_admin) throw new AuthError('Administrator access is required.', 403)
    return current
  }
  app.get('/api/auth/me', async (request, response) => {
    response.json(await auth.restore(bearerToken(request.header('authorization'))))
  })
  app.post('/api/auth/logout', async (request, response) => {
    await auth.restore(bearerToken(request.header('authorization')))
    response.status(204).send()
  })
  app.post('/api/push/subscriptions', async (request, response) => {
    const current = await actor(request.header('authorization'))
    const subscription = z
      .object({
        endpoint: z.string().url(),
        expirationTime: z.number().nullable(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) })
      })
      .parse(request.body)
    await push.subscribe(current.id, subscription)
    response.status(204).send()
  })
  app.delete('/api/push/subscriptions', async (request, response) => {
    const current = await actor(request.header('authorization'))
    const endpoint = z.object({ endpoint: z.string().url() }).parse(request.body).endpoint
    await push.unsubscribe(current.id, endpoint)
    response.status(204).send()
  })
  app.get('/api/profile', async (request, response) => {
    const current = await actor(request.header('authorization'))
    const user = await repository.findUserById(current.id)
    if (!user) throw new AuthError('Profile not found.', 404)
    response.json({
      data: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        account_kind: user.accountKind,
        settings: await repository.getProfileSettings(user.id)
      }
    })
  })
  app.patch('/api/profile', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9-]{2,49}$/u),
        bio: z.string().trim().max(240),
        language: z.enum(['en', 'ur', 'roman-ur']),
        show_last_seen: z.boolean(),
        allow_read_receipts: z.boolean(),
        allow_broadcasts: z.boolean()
      })
      .parse(request.body)
    const user = await repository.findUserById(current.id)
    if (!user) throw new AuthError('Profile not found.', 404)
    const updatedUser = await repository.updateUser({
      ...user,
      name: data.name,
      username: data.username
    })
    const settings = await repository.updateProfileSettings({
      userId: user.id,
      bio: data.bio,
      language: data.language,
      showLastSeen: data.show_last_seen,
      allowReadReceipts: data.allow_read_receipts,
      allowBroadcasts: data.allow_broadcasts,
      updatedAt: new Date()
    })
    response.json({ data: { name: updatedUser.name, username: updatedUser.username, settings } })
  })
  app.post('/api/auth/register', limiter, async (request, response) => {
    const data = credentials
      .extend({
        name: z.string().trim().min(2).max(80),
        password_confirmation: z.string(),
        account_kind: accountKind
      })
      .parse(request.body)
    if (data.account_kind !== 'customer')
      throw new AuthError('Business accounts are created by an administrator.', 403)
    if (data.password !== data.password_confirmation)
      throw new AuthError('Password confirmation does not match.')
    response.status(201).json(
      await auth.register({
        name: data.name,
        email: data.email,
        password: data.password,
        accountKind: data.account_kind
      })
    )
  })
  app.post('/api/auth/login', limiter, async (request, response) => {
    const data = credentials.parse(request.body)
    response.json(await auth.login(data.email, data.password))
  })
  app.post(
    '/api/auth/phone/challenge',
    rateLimit({ windowMs: 60_000, limit: 3 }),
    async (request, response) => {
      const data = z.object({ phone: z.string().regex(/^\+923\d{9}$/u) }).parse(request.body)
      response.status(201).json(await auth.challenge(data.phone))
    }
  )
  app.post('/api/auth/phone/verify', limiter, async (request, response) => {
    const data = z
      .object({
        challenge_id: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/u),
        account_kind: accountKind,
        device_name: z.string()
      })
      .parse(request.body)
    if (data.account_kind !== 'customer')
      throw new AuthError('Business accounts are created by an administrator.', 403)
    response.json(
      await auth.verifyPhone({
        challengeId: data.challenge_id,
        code: data.code,
        accountKind: data.account_kind
      })
    )
  })
  app.post('/api/auth/phone/complete', limiter, async (request, response) => {
    const token = bearerToken(request.header('authorization'))
    const restored = await auth.restore(token)
    const data = z
      .object({
        challenge_id: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/u),
        account_kind: accountKind,
        device_name: z.string()
      })
      .parse(request.body)
    response.json(
      await auth.completePhone(
        {
          challengeId: data.challenge_id,
          code: data.code,
          accountKind: data.account_kind
        },
        restored.data.id
      )
    )
  })
  app.post('/api/auth/google/exchange', limiter, async (request, response) => {
    const data = z
      .object({
        id_token: z.string().min(1),
        account_kind: accountKind,
        device_name: z.string()
      })
      .parse(request.body)
    if (data.account_kind !== 'customer')
      throw new AuthError('Business accounts are created by an administrator.', 403)
    if (!config.GOOGLE_CLIENT_ID) throw new AuthError('Google sign-in is not configured.', 503)
    let profile: { sub: string; email: string; emailVerified: boolean; name: string }
    try {
      profile = await googleDependencies.verifyIdToken(data.id_token)
    } catch (error) {
      const tokenAudience = decodeGoogleTokenAudience(data.id_token)
      googleDependencies.warn('Google ID token verification failed.', {
        reason: error instanceof Error ? error.message : 'invalid_token',
        token_audience: tokenAudience,
        configured_client: config.GOOGLE_CLIENT_ID
      })
      throw new AuthError('Invalid Google token.', 401)
    }
    if (!profile.emailVerified) throw new AuthError('Google email is not verified.', 401)
    response.json(
      await auth.google({
        googleId: profile.sub,
        email: profile.email,
        name: profile.name,
        accountKind: data.account_kind
      })
    )
  })
  app.get('/api/directory', async (request, response) => {
    const current = await actor(request.header('authorization'))
    const query = z.string().max(80).catch('').parse(request.query.q)
    response.json({ data: await messaging.search(current.id, current.account_kind, query) })
  })
  app.put('/api/businesses/:businessId/follow', async (request, response) => {
    const current = await actor(request.header('authorization'))
    const businessId = z.string().uuid().parse(request.params.businessId)
    const following = z.object({ following: z.boolean() }).parse(request.body).following
    await messaging.follow(current.id, current.account_kind, businessId, following)
    response.status(204).send()
  })
  app.get('/api/conversations', async (request, response) => {
    const current = await actor(request.header('authorization'))
    response.json({ data: await messaging.list(current.id) })
  })
  app.post('/api/conversations/invite', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    const data = z
      .object({ counterpart_id: z.string().uuid(), message: z.string().trim().min(1).max(4000) })
      .parse(request.body)
    const conversation = await messaging.invite(
      current.id,
      current.account_kind,
      data.counterpart_id,
      data.message
    )
    publishRealtime(conversation.customerId, { conversationId: conversation.id })
    publishRealtime(conversation.businessId, { conversationId: conversation.id })
    response.status(201).json({ data: conversation })
  })
  app.get('/api/conversations/:conversationId', async (request, response) => {
    const current = await actor(request.header('authorization'))
    response.json({
      data: await messaging.detail(
        current.id,
        z.string().uuid().parse(request.params.conversationId)
      )
    })
  })
  app.patch('/api/conversations/:conversationId/state', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    const state = z
      .object({ archived: z.boolean().optional(), muted: z.boolean().optional() })
      .refine((value) => Object.keys(value).length > 0)
      .parse(request.body)
    await messaging.setState(
      current.id,
      z.string().uuid().parse(request.params.conversationId),
      state
    )
    response.status(204).send()
  })
  app.post('/api/conversations/:conversationId/respond', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    const decision = z
      .object({ decision: z.enum(['accepted', 'rejected']) })
      .parse(request.body).decision
    const conversation = await messaging.respond(
      current.id,
      z.string().uuid().parse(request.params.conversationId),
      decision
    )
    publishRealtime(conversation.customerId, { conversationId: conversation.id })
    publishRealtime(conversation.businessId, { conversationId: conversation.id })
    response.json({ data: conversation })
  })
  app.post('/api/conversations/:conversationId/messages', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    const { body, client_id } = z
      .object({ body: z.string().trim().min(1).max(4000), client_id: z.string().uuid().optional() })
      .parse(request.body)
    const conversationId = z.string().uuid().parse(request.params.conversationId)
    const message = await messaging.send(current.id, conversationId, body, client_id)
    const conversation = await repository.findConversation(conversationId)
    if (conversation) {
      publishRealtime(conversation.customerId, { conversationId: conversation.id })
      publishRealtime(conversation.businessId, { conversationId: conversation.id })
    }
    response.status(201).json({ data: message })
  })
  app.get('/api/broadcast-lists', async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    response.json({ data: await repository.listBroadcastLists(current.id) })
  })
  app.get('/api/business/customers', async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    response.json({ data: await repository.listConnectedCustomers(current.id) })
  })
  app.post(
    '/api/broadcasts/images',
    limiter,
    upload.array('images', 10),
    async (request, response) => {
      const current = await actor(request.header('authorization'))
      if (current.account_kind !== 'business')
        throw new AuthError('Business access is required.', 403)
      const files = request.files as Express.Multer.File[]
      if (!files.length) throw new AuthError('Choose at least one image.', 422)
      const saved = await Promise.all(files.map((file) => mediaStorage.saveImage(file)))
      response.status(201).json({ data: saved.map((key) => ({ url: `/api/media/${key}` })) })
    }
  )
  app.post('/api/broadcast-lists', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    const data = z
      .object({
        name: z.string().trim().min(1).max(80),
        customer_ids: z.array(z.string().uuid()).max(10000)
      })
      .parse(request.body)
    for (const id of data.customer_ids)
      if (!(await repository.isAcceptedCustomer(current.id, id)))
        throw new AuthError('Every recipient must be an accepted customer.', 422)
    const now = new Date()
    response.status(201).json({
      data: await repository.saveBroadcastList({
        id: crypto.randomUUID(),
        businessId: current.id,
        name: data.name,
        customerIds: [...new Set(data.customer_ids)],
        createdAt: now,
        updatedAt: now
      })
    })
  })
  app.put('/api/broadcast-lists/:id', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    const id = z.string().uuid().parse(request.params.id)
    const existing = (await repository.listBroadcastLists(current.id)).find((x) => x.id === id)
    if (!existing) throw new AuthError('Broadcast list not found.', 404)
    const data = z
      .object({
        name: z.string().trim().min(1).max(80),
        customer_ids: z.array(z.string().uuid()).max(10000)
      })
      .parse(request.body)
    for (const customerId of data.customer_ids)
      if (!(await repository.isAcceptedCustomer(current.id, customerId)))
        throw new AuthError('Every recipient must be an accepted customer.', 422)
    response.json({
      data: await repository.saveBroadcastList({
        ...existing,
        name: data.name,
        customerIds: [...new Set(data.customer_ids)],
        updatedAt: new Date()
      })
    })
  })
  app.delete('/api/broadcast-lists/:id', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    if (
      !(await repository.deleteBroadcastList(
        current.id,
        z.string().uuid().parse(request.params.id)
      ))
    )
      throw new AuthError('Broadcast list not found.', 404)
    response.status(204).send()
  })
  app.get('/api/broadcasts', async (request, response) => {
    const current = await actor(request.header('authorization'))
    response.json({
      data:
        current.account_kind === 'business'
          ? await repository.listBroadcastsForBusiness(current.id)
          : await repository.listBroadcastsForCustomer(current.id)
    })
  })
  app.get('/api/broadcast-drafts', async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    response.json({ data: await repository.listBroadcastDrafts(current.id) })
  })
  app.put('/api/broadcast-drafts/:id', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    const data = z
      .object({
        list_id: z.string().uuid().nullable(),
        title: z.string().max(100),
        body: z.string().max(4000),
        image_urls: z
          .array(z.string().regex(/^\/api\/media\/broadcasts-[a-f0-9-]+\.(?:jpg|png|webp)$/u))
          .max(10)
      })
      .parse(request.body)
    const id = z.string().uuid().parse(request.params.id)
    const existing = (await repository.listBroadcastDrafts(current.id)).find((x) => x.id === id)
    const now = new Date()
    response.json({
      data: await repository.saveBroadcastDraft({
        id,
        businessId: current.id,
        listId: data.list_id,
        title: data.title,
        body: data.body,
        imageUrls: data.image_urls,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
    })
  })
  app.delete('/api/broadcast-drafts/:id', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    if (
      !(await repository.deleteBroadcastDraft(
        current.id,
        z.string().uuid().parse(request.params.id)
      ))
    )
      throw new AuthError('Draft not found.', 404)
    response.status(204).send()
  })
  app.patch('/api/broadcasts/:id/state', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'customer')
      throw new AuthError('Customer access is required.', 403)
    const state = z
      .object({
        read: z.literal(true).optional(),
        saved: z.boolean().optional(),
        reported: z.literal(true).optional()
      })
      .refine((x) => Object.keys(x).length > 0)
      .parse(request.body)
    if (
      !(await repository.setBroadcastState(
        current.id,
        z.string().uuid().parse(request.params.id),
        state
      ))
    )
      throw new AuthError('Update not found.', 404)
    response.status(204).send()
  })
  app.put('/api/businesses/:id/mute', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'customer')
      throw new AuthError('Customer access is required.', 403)
    const muted = z.object({ muted: z.boolean() }).parse(request.body).muted
    await repository.setBusinessMuted(current.id, z.string().uuid().parse(request.params.id), muted)
    response.status(204).send()
  })
  app.post('/api/broadcasts', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'business')
      throw new AuthError('Business access is required.', 403)
    const data = z
      .object({
        list_id: z.string().uuid(),
        title: z.string().trim().min(1).max(100),
        body: z.string().trim().min(1).max(4000),
        image_urls: z
          .array(z.string().regex(/^\/api\/media\/broadcasts-[a-f0-9-]+\.(?:jpg|png|webp)$/u))
          .max(10)
          .default([])
      })
      .parse(request.body)
    const list = (await repository.listBroadcastLists(current.id)).find(
      (x) => x.id === data.list_id
    )
    if (!list) throw new AuthError('Broadcast list not found.', 404)
    const broadcast = await repository.createBroadcast({
      id: crypto.randomUUID(),
      businessId: current.id,
      listId: list.id,
      title: data.title,
      body: data.body,
      imageUrls: data.image_urls,
      publishedAt: new Date()
    })
    // Notification failure cannot turn a committed broadcast into a failed publish response.
    const delivered = await repository.listBroadcastConversations(broadcast.id).catch(() => [])
    for (const conversation of delivered) {
      try {
        const notification = {
          title: 'Broadcast: ' + data.title,
          body: data.body,
          url: `/app/chats/${conversation.id}`
        }
        publishRealtime(conversation.customerId, {
          conversationId: conversation.id,
          ...notification
        })
        publishRealtime(conversation.businessId, { conversationId: conversation.id })
        await push.send(conversation.customerId, notification)
      } catch {
        // Clients also reconcile from the inbox on reconnect and periodic refresh.
      }
    }
    response.status(201).json({ data: broadcast })
  })

  app.post('/api/business-requests', limiter, async (request, response) => {
    const current = await actor(request.header('authorization'))
    if (current.account_kind !== 'customer')
      throw new AuthError('Only customer accounts can request business access.', 403)
    const data = z
      .object({
        business_name: z.string().trim().min(2).max(120),
        contact_person_name: z.string().trim().min(2).max(80),
        phone: z
          .string()
          .trim()
          .regex(/^\+?[0-9][0-9\-\s()]{8,19}$/u)
      })
      .parse(request.body)
    response.status(201).json({
      data: await repository.createBusinessRequest({
        userId: current.id,
        businessName: data.business_name,
        contactPersonName: data.contact_person_name,
        phone: data.phone
      })
    })
  })

  app.get('/api/admin/business-requests', async (request, response) => {
    await adminActor(request.header('authorization'))
    response.json({ data: await repository.listBusinessRequests() })
  })

  app.post(
    '/api/admin/business-requests/:requestId/resolve',
    limiter,
    async (request, response) => {
      const admin = await adminActor(request.header('authorization'))
      const decision = z
        .object({ decision: z.enum(['approved', 'rejected']) })
        .parse(request.body).decision
      const result = await repository.resolveBusinessRequest(
        z.string().uuid().parse(request.params.requestId),
        admin.id,
        decision
      )
      if (!result) throw new AuthError('Business request not found.', 404)
      response.json({ data: result })
    }
  )

  app.get('/api/admin/users', async (request, response) => {
    await adminActor(request.header('authorization'))
    const query = z.string().max(100).catch('').parse(request.query.q)
    response.json({ data: await repository.listUsersForAdmin(query) })
  })
  app.post('/api/admin/users', limiter, async (request, response) => {
    await adminActor(request.header('authorization'))
    const data = credentials
      .extend({
        name: z.string().trim().min(2).max(80),
        account_kind: z.literal('business')
      })
      .parse(request.body)
    const session = await auth.register({
      name: data.name,
      email: data.email,
      password: data.password,
      accountKind: 'business'
    })
    const created = await repository.findUserById(session.data.id)
    if (!created) throw new AuthError('Business account was not created.', 500)
    response.status(201).json({
      data: {
        id: created.id,
        name: created.name,
        username: created.username,
        email: created.email,
        phone: created.phone,
        accountKind: created.accountKind,
        signupMethod: created.signupMethod,
        lastLoginMethod: created.lastLoginMethod,
        lastLoginAt: created.lastLoginAt,
        isActive: created.isActive,
        createdAt: created.createdAt,
        deletedAt: created.deletedAt
      }
    })
  })
  app.get('/api/admin/broadcast-reports', async (request, response) => {
    await adminActor(request.header('authorization'))
    response.json({ data: await repository.listBroadcastReports() })
  })
  app.post(
    '/api/admin/broadcast-reports/:broadcastId/resolve',
    limiter,
    async (request, response) => {
      const admin = await adminActor(request.header('authorization'))
      const broadcastId = z.string().uuid().parse(request.params.broadcastId)
      const data = z
        .object({ customer_id: z.string().uuid(), action: z.enum(['dismissed', 'suppressed']) })
        .parse(request.body)
      if (
        !(await repository.resolveBroadcastReport(
          admin.id,
          broadcastId,
          data.customer_id,
          data.action
        ))
      )
        throw new AuthError('Active report not found.', 404)
      response.status(204).send()
    }
  )
  app.patch('/api/admin/users/:userId/status', limiter, async (request, response) => {
    const admin = await adminActor(request.header('authorization'))
    const userId = z.string().uuid().parse(request.params.userId)
    const active = z.object({ active: z.boolean() }).parse(request.body).active
    if (userId === admin.id && !active)
      throw new AuthError('You cannot deactivate your own administrator account.', 409)
    const user = await repository.setUserActive(userId, active)
    if (!user) throw new AuthError('User not found.', 404)
    response.json({ data: user })
  })
  app.delete('/api/admin/users/:userId', limiter, async (request, response) => {
    const admin = await adminActor(request.header('authorization'))
    const userId = z.string().uuid().parse(request.params.userId)
    if (userId === admin.id)
      throw new AuthError('You cannot delete your own administrator account.', 409)
    const user = await repository.deleteUser(userId)
    if (!user) throw new AuthError('User not found or already deleted.', 404)
    response.json({ data: user })
  })
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    void next
    if (error instanceof z.ZodError) {
      response
        .status(422)
        .json({ message: 'Validation failed.', errors: error.flatten().fieldErrors })
      return
    }
    if (error instanceof AuthError) {
      response.status(error.status).json({ message: error.message })
      return
    }
    console.error('Unhandled request error', error instanceof Error ? error.message : 'unknown')
    response.status(500).json({ message: 'An unexpected error occurred.' })
  }
  app.use(errors)
  return app
}
