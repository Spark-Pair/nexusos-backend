import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { loadConfig, type AppConfig } from './config.js'
import { MemoryAuthRepository } from './infrastructure/MemoryAuthRepository.js'

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest exposes response bodies as any. */

const config: AppConfig = {
  NODE_ENV: 'test',
  PORT: 8000,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'unused',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
  JWT_ISSUER: 'nexusos-test',
  ADMIN_EMAILS: 'admin@example.test'
}
const setup = () => createApp(config, new MemoryAuthRepository())

const googleConfig: AppConfig = {
  ...config,
  GOOGLE_CLIENT_ID: 'web-client-id.apps.googleusercontent.com'
}

function googleDependencies(overrides?: { tokenError?: Error; emailVerified?: boolean }) {
  const idToken = 'test-google-id-token'
  const verifyIdToken = vi.fn(() => {
    if (overrides?.tokenError) return Promise.reject(overrides.tokenError)
    return Promise.resolve({
      sub: 'google-user-1',
      email: 'google@example.test',
      emailVerified: overrides?.emailVerified ?? true,
      name: 'Google User'
    })
  })
  return { idToken, dependencies: { verifyIdToken, warn: vi.fn() } }
}

const googlePayload = (idToken: string) => ({
  id_token: idToken,
  account_kind: 'customer',
  device_name: 'web test'
})

describe('NexusOS Express authentication API', () => {
  it('registers and signs in by email without requiring phone at registration', async () => {
    const app = setup()
    const registered = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Hasan Raza',
        email: 'hasan@example.test',
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: 'customer',
        device_name: 'web test'
      })
      .expect(201)
    expect(registered.body.requires_phone).toBe(false)
    expect(registered.body.token).toEqual(expect.any(String))
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'hasan@example.test', password: 'Secure123', device_name: 'Android' })
      .expect(200)
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'hasan@example.test', password: 'incorrect', device_name: 'Android' })
      .expect(422)
  })
  it('keeps business account creation behind the admin API', async () => {
    const app = setup()
    await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Public Business',
        email: 'public-business@example.test',
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: 'business',
        device_name: 'web test'
      })
      .expect(403)
    const admin = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Admin User',
        email: 'admin@example.test',
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: 'customer',
        device_name: 'web test'
      })
      .expect(201)
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${String(admin.body.token)}`)
      .send({
        name: 'North Studio',
        email: 'north@example.test',
        password: 'Secure123',
        account_kind: 'business',
        device_name: 'admin panel'
      })
      .expect(201)
    expect(created.body.data.accountKind).toBe('business')
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'north@example.test', password: 'Secure123', device_name: 'web test' })
      .expect(200)
  })
  it('verifies a Google ID token before account creation', async () => {
    const google = googleDependencies()
    await request(createApp(googleConfig, new MemoryAuthRepository(), google.dependencies))
      .post('/api/auth/google/exchange')
      .send(googlePayload(google.idToken))
      .expect(200)

    expect(google.dependencies.verifyIdToken).toHaveBeenCalledWith(google.idToken)
  })

  it('rejects a Google ID token that cannot be verified', async () => {
    const google = googleDependencies({ tokenError: new Error('invalid token') })
    const response = await request(
      createApp(googleConfig, new MemoryAuthRepository(), google.dependencies)
    )
      .post('/api/auth/google/exchange')
      .send(googlePayload(google.idToken))
      .expect(401)

    expect(response.body.message).toBe('Invalid Google token.')
  })

  it('rejects a Google identity with an unverified email', async () => {
    const google = googleDependencies({ emailVerified: false })
    const response = await request(
      createApp(googleConfig, new MemoryAuthRepository(), google.dependencies)
    )
      .post('/api/auth/google/exchange')
      .send(googlePayload(google.idToken))
      .expect(401)

    expect(response.body.message).toBe('Google email is not verified.')
  })

  it('continues through NexusOS account creation for a verified Google identity', async () => {
    const google = googleDependencies()
    const response = await request(
      createApp(googleConfig, new MemoryAuthRepository(), google.dependencies)
    )
      .post('/api/auth/google/exchange')
      .send(googlePayload(google.idToken))
      .expect(200)

    expect(response.body.data).toMatchObject({
      name: 'Google User',
      email: 'google@example.test',
      account_kind: 'customer'
    })
    expect(response.body.token).toEqual(expect.any(String))
    expect(response.body.requires_phone).toBe(false)
  })

  it('restores authenticated identity and rejects invalid sessions', async () => {
    const app = setup()
    const registered = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Session User',
        email: 'session@example.test',
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: 'customer',
        device_name: 'web'
      })
      .expect(201)
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registered.body.token}`)
      .expect(200)
      .expect((response) => expect(response.body.data.id).toBe(registered.body.data.id))
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid-token').expect(401)
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${registered.body.token}`)
      .expect(204)
  })

  it('reuses the existing NexusOS user on subsequent Google sign-in', async () => {
    const repository = new MemoryAuthRepository()
    const google = googleDependencies()
    const app = createApp(googleConfig, repository, google.dependencies)
    const first = await request(app)
      .post('/api/auth/google/exchange')
      .send(googlePayload(google.idToken))
      .expect(200)
    const second = await request(app)
      .post('/api/auth/google/exchange')
      .send(googlePayload(google.idToken))
      .expect(200)
    expect(second.body.data.id).toBe(first.body.data.id)
  })

  it('lets a customer request business access and lets an admin approve it', async () => {
    const app = setup()
    const customer = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Request User',
        email: 'request-user@example.test',
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: 'customer',
        device_name: 'web test'
      })
      .expect(201)
    const admin = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Admin User',
        email: 'admin@example.test',
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: 'customer',
        device_name: 'web test'
      })
      .expect(201)

    const created = await request(app)
      .post('/api/business-requests')
      .set('Authorization', `Bearer ${String(customer.body.token)}`)
      .send({
        business_name: 'Request Studio',
        contact_person_name: 'Hasan Raza',
        phone: '+92 300 1234567'
      })
      .expect(201)

    expect(created.body.data).toMatchObject({
      businessName: 'Request Studio',
      contactPersonName: 'Hasan Raza',
      status: 'pending'
    })

    const requests = await request(app)
      .get('/api/admin/business-requests')
      .set('Authorization', `Bearer ${String(admin.body.token)}`)
      .expect(200)
    expect(requests.body.data).toHaveLength(1)

    const approved = await request(app)
      .post(`/api/admin/business-requests/${String(created.body.data.id)}/resolve`)
      .set('Authorization', `Bearer ${String(admin.body.token)}`)
      .send({ decision: 'approved' })
      .expect(200)
    expect(approved.body.data.status).toBe('approved')

    await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${String(customer.body.token)}`)
      .expect(200)
      .expect((response) => expect(response.body.data.account_kind).toBe('business'))
  })

  it('enforces follow, invitation acceptance, and participant-only messaging', async () => {
    const app = setup()
    const register = (name: string, email: string, kind: 'customer' | 'business') =>
      request(app).post('/api/auth/register').send({
        name,
        email,
        password: 'Secure123',
        password_confirmation: 'Secure123',
        account_kind: kind,
        device_name: 'web test'
      })
    const admin = await register('Admin Fixture', 'admin@example.test', 'customer').expect(201)
    const createBusiness = (name: string, email: string) =>
      request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${String(admin.body.token)}`)
        .send({
          name,
          email,
          password: 'Secure123',
          account_kind: 'business',
          device_name: 'admin panel'
        })
    const customer = await register('Customer One', 'customer-one@example.test', 'customer').expect(
      201
    )
    await createBusiness('Business One', 'business-one@example.test').expect(201)
    const business = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'business-one@example.test',
        password: 'Secure123',
        device_name: 'web test'
      })
      .expect(200)
    const outsider = await register('Customer Two', 'customer-two@example.test', 'customer').expect(
      201
    )
    const customerToken = String(customer.body.token as unknown)
    const businessToken = String(business.body.token as unknown)
    const outsiderToken = String(outsider.body.token as unknown)
    const customerId = String(customer.body.data.id as unknown)
    const businessId = String(business.body.data.id as unknown)

    await request(app)
      .post('/api/conversations/invite')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ counterpart_id: businessId, message: 'Hello' })
      .expect(403)
    const directory = await request(app)
      .get('/api/directory?q=Business')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200)
    expect(directory.body.data).toEqual([])
    const exactCustomer = await request(app)
      .get(`/api/directory?q=${customerId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(exactCustomer.body.data[0].id).toBe(customerId)
    const fuzzyCustomer = await request(app)
      .get('/api/directory?q=Customer')
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(fuzzyCustomer.body.data).toEqual([])

    const invited = await request(app)
      .post('/api/conversations/invite')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ counterpart_id: customerId, message: 'Welcome to our business.' })
      .expect(201)
    const conversationId = String(invited.body.data.id as unknown)
    expect(invited.body.data.status).toBe('pending')
    await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ body: 'Too early' })
      .expect(403)
    await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404)
    await request(app)
      .post(`/api/conversations/${conversationId}/respond`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'accepted' })
      .expect(200)
    await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'Thanks, connected!' })
      .expect(201)
    const unreadList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(unreadList.body.data[0].unreadCount).toBe(1)
    const detail = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(detail.body.data.messages).toHaveLength(2)
    expect(detail.body.data.messages[1].body).toBe('Thanks, connected!')
    expect(detail.body.data.messages[1].readAt).toEqual(expect.any(String))
    const readList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(readList.body.data[0].unreadCount).toBe(0)
    const broadcastList = await request(app)
      .post('/api/broadcast-lists')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ name: 'New arrivals', customer_ids: [customerId] })
      .expect(201)
    const connectedCustomers = await request(app)
      .get('/api/business/customers')
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(connectedCustomers.body.data[0]).toMatchObject({ id: customerId, name: 'Customer One' })
    await request(app)
      .put(`/api/broadcast-lists/${String(broadcastList.body.data.id)}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ name: 'VIP arrivals', customer_ids: [customerId] })
      .expect(200)
    const uploaded = await request(app)
      .post('/api/broadcasts/images')
      .set('Authorization', `Bearer ${businessToken}`)
      .attach('images', Buffer.from('fake image bytes'), {
        filename: 'arrival.jpg',
        contentType: 'image/jpeg'
      })
      .expect(201)
    expect(uploaded.body.data[0].url).toMatch(/^\/api\/media\/broadcasts-[a-f0-9-]+\.jpg$/u)
    await request(app)
      .post('/api/broadcasts')
      .set('Authorization', `Bearer ${businessToken}`)
      .send({
        list_id: broadcastList.body.data.id,
        title: 'Summer collection',
        body: 'Now available.',
        image_urls: [uploaded.body.data[0].url]
      })
      .expect(201)
    const updates = await request(app)
      .get('/api/broadcasts')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200)
    expect(updates.body.data[0]).toMatchObject({
      title: 'Summer collection',
      body: 'Now available.'
    })
    const broadcastId = String(updates.body.data[0].id)
    const inbox = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200)
    expect(inbox.body.data[0].lastMessage).toMatchObject({
      broadcastId,
      title: 'Summer collection',
      body: 'Now available.'
    })
    const broadcastChat = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200)
    expect(broadcastChat.body.data.messages).toHaveLength(3)
    expect(broadcastChat.body.data.messages[2]).toMatchObject({
      broadcastId,
      readAt: expect.any(String)
    })
    const clientId = crypto.randomUUID()
    for (let retry = 0; retry < 2; retry++) {
      const sent = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Queued while offline', client_id: clientId })
        .expect(201)
      expect(sent.body.data.id).toBe(clientId)
    }
    await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'Different content', client_id: clientId })
      .expect(409)
    const replayed = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .expect(200)
    expect(replayed.body.data.messages).toHaveLength(4)
    await request(app)
      .put(`/api/broadcast-lists/${String(broadcastList.body.data.id)}`)
      .set('Authorization', `Bearer ${businessToken}`)
      .send({ name: 'Empty now', customer_ids: [] })
      .expect(200)
    const snapshot = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200)
    expect(snapshot.body.data.messages).toHaveLength(4)
    await request(app)
      .patch(`/api/broadcasts/${broadcastId}/state`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ read: true, saved: true })
      .expect(204)
    const savedUpdates = await request(app)
      .get('/api/broadcasts')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200)
    expect(savedUpdates.body.data[0]).toMatchObject({ saved: true })
  })

  it('restricts user administration and invalidates deactivated user sessions', async () => {
    const app = setup()
    const payload = (name: string, email: string) => ({
      name,
      email,
      password: 'Secure123',
      password_confirmation: 'Secure123',
      account_kind: 'customer',
      device_name: 'web test'
    })
    const admin = await request(app)
      .post('/api/auth/register')
      .send(payload('Platform Admin', 'admin@example.test'))
      .expect(201)
    const user = await request(app)
      .post('/api/auth/register')
      .send(payload('Managed User', 'managed@example.test'))
      .expect(201)
    const adminToken = String(admin.body.token as unknown)
    const userToken = String(user.body.token as unknown)
    const userId = String(user.body.data.id as unknown)
    expect(admin.body.data.is_admin).toBe(true)
    await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403)
    const listing = await request(app)
      .get('/api/admin/users?q=managed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(listing.body.data[0]).toMatchObject({
      id: userId,
      username: expect.any(String),
      signupMethod: 'email',
      lastLoginMethod: 'email',
      isActive: true
    })
    await request(app)
      .patch(`/api/admin/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200)
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`).expect(401)
    const deleted = await request(app)
      .delete(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(deleted.body.data).toMatchObject({
      name: 'Deleted user',
      email: null,
      phone: null,
      isActive: false
    })
    expect(deleted.body.data.deletedAt).toEqual(expect.any(String))
    await request(app)
      .delete(`/api/admin/users/${String(admin.body.data.id as unknown)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409)
  })
})
