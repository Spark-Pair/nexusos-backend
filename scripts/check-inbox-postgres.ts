import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { loadConfig } from '../src/config.js'
import { PostgresAuthRepository } from '../src/infrastructure/database/PostgresAuthRepository.js'
import { MessagingService } from '../src/application/MessagingService.js'

// Uses a new, uniquely named schema; never inserts fixtures in application tables.
const schemaName = `nexusos_inbox_test_${crypto.randomUUID().replaceAll('-', '')}`
if (!/^nexusos_inbox_test_[a-f0-9]{32}$/.test(schemaName)) throw new Error('Invalid test schema')
const config = loadConfig()
const admin = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5000 })
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  options: `-c search_path=${schemaName}`,
  connectionTimeoutMillis: 5000
})
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`)
  const sql = await readFile(
    new URL('../src/infrastructure/database/schema.sql', import.meta.url),
    'utf8'
  )
  await pool.query(sql)
  const repository = new PostgresAuthRepository(pool)
  const service = new MessagingService(repository)
  const now = new Date()
  const makeUser = (name: string, accountKind: 'customer' | 'business') =>
    repository.createUser({
      name,
      accountKind,
      username: name,
      email: `${name}@example.test`,
      phone: null,
      passwordHash: null,
      googleId: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      onboardingCompletedAt: now,
      signupMethod: 'email',
      lastLoginMethod: null,
      lastLoginAt: null,
      isActive: true,
      createdAt: now,
      deletedAt: null
    })
  const business = await makeUser('business', 'business')
  const customer = await makeUser('customer', 'customer')
  const optedOut = await makeUser('optedout', 'customer')
  const newcomer = await makeUser('newcomer', 'customer')
  const chats = []
  for (const user of [customer, optedOut, newcomer]) {
    const chat = {
      id: crypto.randomUUID(),
      businessId: business.id,
      customerId: user.id,
      invitedBy: business.id,
      status: 'accepted' as const,
      createdAt: now,
      updatedAt: now
    }
    await repository.createConversation(chat)
    chats.push(chat)
  }
  await repository.updateProfileSettings({
    ...(await repository.getProfileSettings(optedOut.id)),
    allowBroadcasts: false
  })
  const list = {
    id: crypto.randomUUID(),
    businessId: business.id,
    name: 'Test list',
    customerIds: [customer.id, optedOut.id],
    createdAt: now,
    updatedAt: now
  }
  await repository.saveBroadcastList(list)
  const broadcast = {
    id: crypto.randomUUID(),
    businessId: business.id,
    listId: list.id,
    title: 'Arrival',
    body: 'Now in your inbox',
    imageUrls: ['/uploads/test.png'],
    publishedAt: now
  }
  await repository.createBroadcast(broadcast)
  assert.equal((await repository.listBroadcastConversations(broadcast.id)).length, 1)
  const delivered = await repository.listMessages(chats[0]!.id)
  assert.equal(delivered[0]?.broadcastId, broadcast.id)
  assert.deepEqual(delivered[0]?.imageUrls, ['/uploads/test.png'])
  assert.equal(await repository.countUnread(chats[0]!.id, customer.id), 1)
  await repository.markMessagesRead(chats[0]!.id, customer.id)
  assert.equal(await repository.countUnread(chats[0]!.id, customer.id), 0)
  assert.equal((await repository.listMessages(chats[1]!.id)).length, 0)
  await repository.saveBroadcastList({ ...list, customerIds: [newcomer.id] })
  // A second migration must not deliver historical broadcasts to newly added members.
  await pool.query(sql)
  assert.equal((await repository.listMessages(chats[2]!.id)).length, 0)
  assert.equal((await repository.listBroadcastsForCustomer(customer.id)).length, 1)
  assert.equal(
    await repository.setBroadcastState(customer.id, broadcast.id, { reported: true }),
    true
  )
  assert.equal(
    await repository.setBroadcastState(newcomer.id, broadcast.id, { reported: true }),
    false
  )
  const clientId = crypto.randomUUID()
  await Promise.all([
    service.send(customer.id, chats[0]!.id, 'Queued offline', clientId),
    service.send(customer.id, chats[0]!.id, 'Queued offline', clientId)
  ])
  assert.equal(
    (await repository.listMessages(chats[0]!.id)).filter((message) => message.id === clientId)
      .length,
    1
  )
  await assert.rejects(service.send(customer.id, chats[0]!.id, 'Changed content', clientId))
  await pool.query('UPDATE business_broadcasts SET suppressed_at=now() WHERE id=$1', [broadcast.id])
  assert.equal(
    (await repository.listMessages(chats[0]!.id)).some(
      (message) => message.broadcastId === broadcast.id
    ),
    false
  )
  console.log(
    'PostgreSQL inbox checks passed: migration repeatability, consent, recipient snapshots, read state, suppression and concurrent UUID replay.'
  )
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
  await admin.end()
}
