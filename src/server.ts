import { createServer } from 'node:http'
import pg from 'pg'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { PostgresAuthRepository } from './infrastructure/database/PostgresAuthRepository.js'
import { createRealtimeGateway } from './infrastructure/RealtimeGateway.js'

const config = loadConfig()
const pool = new pg.Pool({ connectionString: config.DATABASE_URL })
const repository = new PostgresAuthRepository(pool)
let publishRealtime: (
  userId: string,
  payload: { conversationId: string; title?: string; body?: string; url?: string }
) => void = () => undefined
const app = createApp(config, repository, undefined, (userId, payload) =>
  publishRealtime(userId, payload)
)
const server = createServer(app)
const realtime = createRealtimeGateway(server, config, repository)
publishRealtime = (userId, payload) => {
  realtime.publish(userId, payload)
}
server.listen(config.PORT, '0.0.0.0', () =>
  console.log(`NexusOS API listening on port ${config.PORT}`)
)

const runScheduledBroadcasts = async () => {
  try {
    const due = await repository.deliverDueBroadcasts(new Date())
    for (const broadcast of due) {
      const conversations = await repository.listBroadcastConversations(broadcast.id)
      for (const conversation of conversations) {
        publishRealtime(conversation.customerId, {
          conversationId: conversation.id,
          title: 'Broadcast: ' + broadcast.title,
          body: broadcast.body,
          url: `/app/chats/${conversation.id}`
        })
        publishRealtime(conversation.businessId, { conversationId: conversation.id })
      }
    }
  } catch (error) {
    console.error('Scheduled broadcast delivery failed', error)
  }
}
const scheduleTimer = setInterval(() => void runScheduledBroadcasts(), 30000)
void runScheduledBroadcasts()

const shutdown = () => {
  clearInterval(scheduleTimer)
  void realtime.close().then(() => server.close(() => void pool.end().then(() => process.exit(0))))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
