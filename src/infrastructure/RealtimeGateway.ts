import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import type { AppConfig } from '../config.js'
import type { AuthRepository } from '../domain/auth.js'
import type { MessagingRepository } from '../domain/messaging.js'

export function createRealtimeGateway(
  server: HttpServer,
  config: AppConfig,
  repository: AuthRepository & MessagingRepository
) {
  const origins = (config.FRONTEND_ORIGINS ?? config.FRONTEND_URL)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const io = new Server(server, { cors: { origin: origins } })
  const authenticatedUsers = new Map<string, string>()
  io.use((socket, next) => {
    void (async () => {
      try {
        const token =
          typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : ''
        const payload = jwt.verify(token, config.JWT_SECRET, { issuer: config.JWT_ISSUER })
        if (typeof payload === 'string' || typeof payload.sub !== 'string')
          throw new Error('Invalid session')
        const user = await repository.findUserById(payload.sub)
        if (!user?.isActive || user.deletedAt) throw new Error('Invalid session')
        authenticatedUsers.set(socket.id, user.id)
        await socket.join(`user:${user.id}`)
        next()
      } catch {
        next(new Error('Authentication failed'))
      }
    })()
  })
  io.on('connection', (socket) => {
    socket.on('disconnect', () => authenticatedUsers.delete(socket.id))
    socket.on('conversation:typing', (payload: unknown) => {
      void (async () => {
        const userId = authenticatedUsers.get(socket.id) ?? ''
        if (!userId || typeof payload !== 'object' || payload === null) return
        const value = payload as Record<string, unknown>
        if (typeof value.conversationId !== 'string' || typeof value.active !== 'boolean') return
        const conversation = await repository.findConversation(value.conversationId)
        if (
          !conversation ||
          conversation.status !== 'accepted' ||
          (conversation.customerId !== userId && conversation.businessId !== userId)
        )
          return
        const recipient =
          conversation.customerId === userId ? conversation.businessId : conversation.customerId
        io.to(`user:${recipient}`).emit('conversation:typing', {
          conversationId: conversation.id,
          active: value.active
        })
      })().catch(() => undefined)
    })
  })
  return {
    publish(
      userId: string,
      payload: {
        conversationId: string
        title?: string
        body?: string
        url?: string
        message?: unknown
        readBy?: string
        readAt?: string
      }
    ) {
      io.to(`user:${userId}`).emit('conversation:updated', payload)
    },
    close() {
      return io.close()
    }
  }
}
