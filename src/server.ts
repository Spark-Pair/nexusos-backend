import { createServer } from 'node:http'
import pg from 'pg'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { PostgresAuthRepository } from './infrastructure/database/PostgresAuthRepository.js'
import { createRealtimeGateway } from './infrastructure/RealtimeGateway.js'

const config = loadConfig()
const pool = new pg.Pool({ connectionString: config.DATABASE_URL })
const repository = new PostgresAuthRepository(pool)
let publishRealtime: (userId: string, payload: { conversationId: string }) => void = () => undefined
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

const shutdown = () =>
  void realtime.close().then(() => server.close(() => void pool.end().then(() => process.exit(0))))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
