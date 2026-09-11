import type { Pool, QueryResultRow } from 'pg'
import type {
  AuthRepository,
  BusinessRequest,
  PhoneChallenge,
  ProfileSettings,
  PushSubscriptionRecord,
  User
} from '../../domain/auth.js'
import type { Conversation, Message, MessagingRepository } from '../../domain/messaging.js'
import type {
  BroadcastDraft,
  BroadcastList,
  BroadcastReport,
  BroadcastRepository,
  BusinessBroadcast
} from '../../domain/broadcast.js'

interface UserRow extends QueryResultRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  password_hash: string | null
  google_id: string | null
  account_kind: 'customer' | 'business'
  email_verified_at: Date | null
  phone_verified_at: Date | null
  onboarding_completed_at: Date | null
  username: string
  signup_method: User['signupMethod']
  last_login_method: User['lastLoginMethod']
  last_login_at: Date | null
  is_active: boolean
  created_at: Date
  deleted_at: Date | null
}

interface BusinessRequestRow extends QueryResultRow {
  id: string
  user_id: string
  user_name: string
  user_email: string | null
  business_name: string
  contact_person_name: string
  phone: string
  status: BusinessRequest['status']
  created_at: Date
  reviewed_at: Date | null
  reviewed_by: string | null
}

interface ConversationRow extends QueryResultRow {
  id: string
  customer_id: string
  business_id: string
  invited_by: string
  status: Conversation['status']
  created_at: Date
  updated_at: Date
}
interface MessageRow extends QueryResultRow {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: Date
  read_at: Date | null
  broadcast_id: string | null
  title: string
  image_urls: string[]
}

const toBusinessRequest = (row: BusinessRequestRow): BusinessRequest => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  userEmail: row.user_email,
  businessName: row.business_name,
  contactPersonName: row.contact_person_name,
  phone: row.phone,
  status: row.status,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
  reviewedBy: row.reviewed_by
})

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  passwordHash: row.password_hash,
  googleId: row.google_id,
  accountKind: row.account_kind,
  emailVerifiedAt: row.email_verified_at,
  phoneVerifiedAt: row.phone_verified_at,
  onboardingCompletedAt: row.onboarding_completed_at,
  username: row.username,
  signupMethod: row.signup_method,
  lastLoginMethod: row.last_login_method,
  lastLoginAt: row.last_login_at,
  isActive: row.is_active,
  createdAt: row.created_at,
  deletedAt: row.deleted_at
})

export class PostgresAuthRepository
  implements AuthRepository, MessagingRepository, BroadcastRepository
{
  constructor(private readonly pool: Pool) {}
  async findUserById(id: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
    return result.rows[0] ? toUser(result.rows[0]) : null
  }
  async findUserByEmail(email: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email])
    return result.rows[0] ? toUser(result.rows[0]) : null
  }
  async findUserByPhone(phone: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE phone = $1', [phone])
    return result.rows[0] ? toUser(result.rows[0]) : null
  }
  async createUser(user: Omit<User, 'id'>) {
    const id = crypto.randomUUID()
    const result = await this.pool.query<UserRow>(
      'INSERT INTO users (id,name,email,phone,password_hash,google_id,account_kind,email_verified_at,phone_verified_at,onboarding_completed_at,username,signup_method,last_login_method,last_login_at,is_active,created_at,deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',
      [
        id,
        user.name,
        user.email,
        user.phone,
        user.passwordHash,
        user.googleId,
        user.accountKind,
        user.emailVerifiedAt,
        user.phoneVerifiedAt,
        user.onboardingCompletedAt,
        user.username,
        user.signupMethod,
        user.lastLoginMethod,
        user.lastLoginAt,
        user.isActive,
        user.createdAt,
        user.deletedAt
      ]
    )
    return toUser(result.rows[0]!)
  }
  async updateUser(user: User) {
    const result = await this.pool.query<UserRow>(
      'UPDATE users SET name=$2,email=$3,phone=$4,password_hash=$5,google_id=$6,account_kind=$7,email_verified_at=$8,phone_verified_at=$9,onboarding_completed_at=$10,username=$11,signup_method=$12,last_login_method=$13,last_login_at=$14,is_active=$15,deleted_at=$16,updated_at=now() WHERE id=$1 RETURNING *',
      [
        user.id,
        user.name,
        user.email,
        user.phone,
        user.passwordHash,
        user.googleId,
        user.accountKind,
        user.emailVerifiedAt,
        user.phoneVerifiedAt,
        user.onboardingCompletedAt,
        user.username,
        user.signupMethod,
        user.lastLoginMethod,
        user.lastLoginAt,
        user.isActive,
        user.deletedAt
      ]
    )
    return toUser(result.rows[0]!)
  }
  async createChallenge(value: PhoneChallenge) {
    await this.pool.query(
      'INSERT INTO phone_challenges (id,phone,code_hash,attempts,expires_at,consumed_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [value.id, value.phone, value.codeHash, value.attempts, value.expiresAt, value.consumedAt]
    )
  }
  async findChallenge(id: string) {
    const result = await this.pool.query('SELECT * FROM phone_challenges WHERE id=$1', [id])
    const row = result.rows[0] as Record<string, unknown> | undefined
    return row
      ? {
          id: String(row.id),
          phone: String(row.phone),
          codeHash: String(row.code_hash),
          attempts: Number(row.attempts),
          expiresAt: new Date(String(row.expires_at)),
          consumedAt: row.consumed_at instanceof Date ? row.consumed_at : null
        }
      : null
  }
  async updateChallenge(value: PhoneChallenge) {
    await this.pool.query('UPDATE phone_challenges SET attempts=$2,consumed_at=$3 WHERE id=$1', [
      value.id,
      value.attempts,
      value.consumedAt
    ])
  }
  async invalidateActiveChallenges(phone: string) {
    await this.pool.query(
      'UPDATE phone_challenges SET consumed_at=now() WHERE phone=$1 AND consumed_at IS NULL',
      [phone]
    )
  }
  async recordLogin(id: string, method: NonNullable<User['lastLoginMethod']>) {
    const result = await this.pool.query<UserRow>(
      'UPDATE users SET last_login_method=$2,last_login_at=now(),updated_at=now() WHERE id=$1 RETURNING *',
      [id, method]
    )
    return toUser(result.rows[0]!)
  }
  async listUsersForAdmin(query: string) {
    const result = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE name ILIKE $1 OR username ILIKE $1 OR COALESCE(email,'') ILIKE $1 OR COALESCE(phone,'') ILIKE $1 ORDER BY created_at DESC LIMIT 200`,
      [`%${query.trim()}%`]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      email: row.email,
      phone: row.phone,
      accountKind: row.account_kind,
      signupMethod: row.signup_method,
      lastLoginMethod: row.last_login_method,
      lastLoginAt: row.last_login_at,
      isActive: row.is_active,
      createdAt: row.created_at,
      deletedAt: row.deleted_at
    }))
  }
  async setUserActive(id: string, active: boolean) {
    const result = await this.pool.query<UserRow>(
      'UPDATE users SET is_active=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *',
      [id, active]
    )
    const row = result.rows[0]
    return row
      ? {
          id: row.id,
          name: row.name,
          username: row.username,
          email: row.email,
          phone: row.phone,
          accountKind: row.account_kind,
          signupMethod: row.signup_method,
          lastLoginMethod: row.last_login_method,
          lastLoginAt: row.last_login_at,
          isActive: row.is_active,
          createdAt: row.created_at,
          deletedAt: row.deleted_at
        }
      : null
  }
  async deleteUser(id: string) {
    const result = await this.pool.query<UserRow>(
      `UPDATE users SET name='Deleted user',email=NULL,phone=NULL,password_hash=NULL,google_id=NULL,is_active=false,deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [id]
    )
    const row = result.rows[0]
    return row
      ? {
          id: row.id,
          name: row.name,
          username: row.username,
          email: row.email,
          phone: row.phone,
          accountKind: row.account_kind,
          signupMethod: row.signup_method,
          lastLoginMethod: row.last_login_method,
          lastLoginAt: row.last_login_at,
          isActive: row.is_active,
          createdAt: row.created_at,
          deletedAt: row.deleted_at
        }
      : null
  }

  async createBusinessRequest(input: {
    userId: string
    businessName: string
    contactPersonName: string
    phone: string
  }) {
    const result = await this.pool.query<BusinessRequestRow>(
      `INSERT INTO business_requests(id,user_id,business_name,contact_person_name,phone,status)
       VALUES($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (user_id) WHERE status='pending'
       DO UPDATE SET business_name=$3,contact_person_name=$4,phone=$5,updated_at=now()
       RETURNING id,user_id,business_name,contact_person_name,phone,status,created_at,reviewed_at,reviewed_by,
       (SELECT name FROM users WHERE users.id=business_requests.user_id) user_name,
       (SELECT email FROM users WHERE users.id=business_requests.user_id) user_email`,
      [crypto.randomUUID(), input.userId, input.businessName, input.contactPersonName, input.phone]
    )
    return toBusinessRequest(result.rows[0]!)
  }

  async listBusinessRequests() {
    const result = await this.pool.query<BusinessRequestRow>(
      `SELECT r.id,r.user_id,r.business_name,r.contact_person_name,r.phone,r.status,r.created_at,r.reviewed_at,r.reviewed_by,
       u.name user_name,u.email user_email
       FROM business_requests r JOIN users u ON u.id=r.user_id
       ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 200`
    )
    return result.rows.map(toBusinessRequest)
  }

  async resolveBusinessRequest(id: string, adminId: string, decision: 'approved' | 'rejected') {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query<BusinessRequestRow>(
        `UPDATE business_requests SET status=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now()
         WHERE id=$1 AND status='pending'
         RETURNING id,user_id,business_name,contact_person_name,phone,status,created_at,reviewed_at,reviewed_by,
         (SELECT name FROM users WHERE users.id=business_requests.user_id) user_name,
         (SELECT email FROM users WHERE users.id=business_requests.user_id) user_email`,
        [id, decision, adminId]
      )
      const row = updated.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return null
      }
      if (decision === 'approved') {
        await client.query(
          `UPDATE users SET account_kind='business',name=$2,phone=$3,updated_at=now()
           WHERE id=$1 AND deleted_at IS NULL`,
          [row.user_id, row.business_name, row.phone]
        )
      }
      await client.query('COMMIT')
      return toBusinessRequest(row)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async savePushSubscription(userId: string, subscription: PushSubscriptionRecord) {
    await this.pool.query(
      `INSERT INTO push_subscriptions(user_id,endpoint,expiration_time,p256dh,auth) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,endpoint) DO UPDATE SET expiration_time=$3,p256dh=$4,auth=$5,updated_at=now()`,
      [
        userId,
        subscription.endpoint,
        subscription.expirationTime,
        subscription.keys.p256dh,
        subscription.keys.auth
      ]
    )
  }
  async removePushSubscription(userId: string, endpoint: string) {
    await this.pool.query('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2', [
      userId,
      endpoint
    ])
  }
  async listPushSubscriptions(userId: string) {
    const result = await this.pool.query<
      {
        endpoint: string
        expiration_time: string | null
        p256dh: string
        auth: string
      } & QueryResultRow
    >('SELECT endpoint,expiration_time,p256dh,auth FROM push_subscriptions WHERE user_id=$1', [
      userId
    ])
    return result.rows.map((row) => ({
      endpoint: row.endpoint,
      expirationTime: row.expiration_time ? Number(row.expiration_time) : null,
      keys: { p256dh: row.p256dh, auth: row.auth }
    }))
  }
  async getProfileSettings(userId: string): Promise<ProfileSettings> {
    const result = await this.pool.query(
      `INSERT INTO profile_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id
       RETURNING user_id,bio,language,show_last_seen,allow_read_receipts,allow_broadcasts,updated_at`,
      [userId]
    )
    const row = result.rows[0] as Record<string, unknown>
    return {
      userId: String(row.user_id),
      bio: String(row.bio),
      language: row.language as ProfileSettings['language'],
      showLastSeen: Boolean(row.show_last_seen),
      allowReadReceipts: Boolean(row.allow_read_receipts),
      allowBroadcasts: Boolean(row.allow_broadcasts),
      updatedAt: new Date(String(row.updated_at))
    }
  }
  async updateProfileSettings(value: ProfileSettings) {
    await this.pool.query(
      `INSERT INTO profile_settings(user_id,bio,language,show_last_seen,allow_read_receipts,allow_broadcasts,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET bio=$2,language=$3,show_last_seen=$4,allow_read_receipts=$5,allow_broadcasts=$6,updated_at=$7`,
      [
        value.userId,
        value.bio,
        value.language,
        value.showLastSeen,
        value.allowReadReceipts,
        value.allowBroadcasts,
        value.updatedAt
      ]
    )
    return value
  }
  async searchProfiles(actorId: string, actorKind: User['accountKind'], query: string) {
    const result = await this.pool.query<UserRow & { followed: boolean }>(
      `SELECT u.*, EXISTS(SELECT 1 FROM follows f WHERE f.customer_id=$1 AND f.business_id=u.id) followed
       FROM users u WHERE u.id<>$1 AND u.deleted_at IS NULL AND $2='business' AND u.account_kind='customer'
       AND (u.id::text=$3 OR lower(u.username)=lower($3)) LIMIT 1`,
      [actorId, actorKind, query.trim()]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      accountKind: row.account_kind,
      followed: row.followed
    }))
  }
  async findProfile(id: string) {
    const user = await this.findUserById(id)
    return user && !user.deletedAt
      ? {
          id: user.id,
          name: user.name,
          username: user.username,
          accountKind: user.accountKind,
          followed: false
        }
      : null
  }
  async setFollow(customerId: string, businessId: string, following: boolean) {
    if (following)
      await this.pool.query(
        'INSERT INTO follows(customer_id,business_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [customerId, businessId]
      )
    else
      await this.pool.query('DELETE FROM follows WHERE customer_id=$1 AND business_id=$2', [
        customerId,
        businessId
      ])
  }
  async isFollowing(customerId: string, businessId: string) {
    return (
      (
        await this.pool.query('SELECT 1 FROM follows WHERE customer_id=$1 AND business_id=$2', [
          customerId,
          businessId
        ])
      ).rowCount === 1
    )
  }
  private toConversation(row: ConversationRow): Conversation {
    return {
      id: String(row.id),
      customerId: String(row.customer_id),
      businessId: String(row.business_id),
      invitedBy: String(row.invited_by),
      status: row.status,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at))
    }
  }
  async findConversation(id: string) {
    const row = (
      await this.pool.query<ConversationRow>('SELECT * FROM conversations WHERE id=$1', [id])
    ).rows[0]
    return row ? this.toConversation(row) : null
  }
  async findConversationBetween(customerId: string, businessId: string) {
    const row = (
      await this.pool.query<ConversationRow>(
        'SELECT * FROM conversations WHERE customer_id=$1 AND business_id=$2',
        [customerId, businessId]
      )
    ).rows[0]
    return row ? this.toConversation(row) : null
  }
  async createConversation(value: Conversation) {
    await this.pool.query(
      'INSERT INTO conversations(id,customer_id,business_id,invited_by,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        value.id,
        value.customerId,
        value.businessId,
        value.invitedBy,
        value.status,
        value.createdAt,
        value.updatedAt
      ]
    )
  }
  async updateConversation(value: Conversation) {
    await this.pool.query(
      'UPDATE conversations SET status=$2,updated_at=$3,invited_by=$4 WHERE id=$1',
      [value.id, value.status, value.updatedAt, value.invitedBy]
    )
  }
  async createMessage(value: Message) {
    await this.pool.query(
      'INSERT INTO messages(id,conversation_id,sender_id,body,created_at,read_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
      [value.id, value.conversationId, value.senderId, value.body, value.createdAt, value.readAt]
    )
  }
  async findMessage(id: string): Promise<Message | null> {
    const result = await this.pool.query<MessageRow>('SELECT * FROM messages WHERE id=$1', [id])
    const row = result.rows[0]
    return row
      ? {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          body: row.body,
          createdAt: row.created_at,
          readAt: row.read_at,
          broadcastId: row.broadcast_id,
          title: row.title,
          imageUrls: row.image_urls
        }
      : null
  }
  async listMessages(conversationId: string) {
    const result = await this.pool.query<MessageRow>(
      'SELECT m.* FROM messages m LEFT JOIN business_broadcasts b ON b.id=m.broadcast_id WHERE m.conversation_id=$1 AND (m.broadcast_id IS NULL OR b.suppressed_at IS NULL) ORDER BY m.created_at,m.id',
      [conversationId]
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      conversationId: String(row.conversation_id),
      senderId: String(row.sender_id),
      body: String(row.body),
      createdAt: new Date(String(row.created_at)),
      readAt: row.read_at,
      broadcastId: row.broadcast_id,
      title: row.title,
      imageUrls: row.image_urls
    }))
  }
  async listConversations(userId: string) {
    const result = await this.pool.query<ConversationRow>(
      'SELECT * FROM conversations WHERE customer_id=$1 OR business_id=$1 ORDER BY updated_at DESC',
      [userId]
    )
    return result.rows.map((row) => this.toConversation(row))
  }
  async markMessagesRead(conversationId: string, readerId: string) {
    await this.pool.query(
      'UPDATE messages SET read_at=now() WHERE conversation_id=$1 AND sender_id<>$2 AND read_at IS NULL',
      [conversationId, readerId]
    )
  }
  async countUnread(conversationId: string, readerId: string) {
    const result = await this.pool.query<{ count: string } & QueryResultRow>(
      'SELECT count(*) count FROM messages m LEFT JOIN business_broadcasts b ON b.id=m.broadcast_id WHERE m.conversation_id=$1 AND m.sender_id<>$2 AND m.read_at IS NULL AND (m.broadcast_id IS NULL OR b.suppressed_at IS NULL)',
      [conversationId, readerId]
    )
    return Number(result.rows[0]?.count ?? 0)
  }
  async getConversationState(userId: string, conversationId: string) {
    const row = (
      await this.pool.query(
        'SELECT archived,muted FROM conversation_user_states WHERE user_id=$1 AND conversation_id=$2',
        [userId, conversationId]
      )
    ).rows[0] as { archived: boolean; muted: boolean } | undefined
    return row ?? { archived: false, muted: false }
  }
  async setConversationState(
    userId: string,
    conversationId: string,
    state: { archived?: boolean; muted?: boolean }
  ) {
    const current = await this.getConversationState(userId, conversationId)
    await this.pool.query(
      `INSERT INTO conversation_user_states(user_id,conversation_id,archived,muted) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,conversation_id) DO UPDATE SET archived=$3,muted=$4,updated_at=now()`,
      [userId, conversationId, state.archived ?? current.archived, state.muted ?? current.muted]
    )
  }
  async listBroadcastLists(businessId: string) {
    const result = await this.pool.query(
      `SELECT l.*,COALESCE(array_agg(m.customer_id) FILTER (WHERE m.customer_id IS NOT NULL),'{}') customer_ids FROM broadcast_lists l LEFT JOIN broadcast_list_members m ON m.list_id=l.id WHERE l.business_id=$1 GROUP BY l.id ORDER BY l.updated_at DESC`,
      [businessId]
    )
    return result.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      businessId: String(r.business_id),
      name: String(r.name),
      customerIds: (r.customer_ids as string[]) ?? [],
      createdAt: new Date(String(r.created_at)),
      updatedAt: new Date(String(r.updated_at))
    }))
  }
  async listConnectedCustomers(businessId: string) {
    const result = await this.pool.query<UserRow>(
      `SELECT DISTINCT u.* FROM users u JOIN conversations c ON c.customer_id=u.id WHERE c.business_id=$1 AND c.status='accepted' AND u.deleted_at IS NULL ORDER BY u.name`,
      [businessId]
    )
    return result.rows.map((x) => ({ id: x.id, name: x.name, username: x.username }))
  }
  async saveBroadcastList(value: BroadcastList) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO broadcast_lists(id,business_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$3,updated_at=$5 WHERE broadcast_lists.business_id=$2`,
        [value.id, value.businessId, value.name, value.createdAt, value.updatedAt]
      )
      await client.query('DELETE FROM broadcast_list_members WHERE list_id=$1', [value.id])
      for (const id of value.customerIds)
        await client.query(
          'INSERT INTO broadcast_list_members(list_id,customer_id) VALUES($1,$2)',
          [value.id, id]
        )
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  async deleteBroadcastList(businessId: string, id: string) {
    return (
      (
        await this.pool.query('DELETE FROM broadcast_lists WHERE id=$1 AND business_id=$2', [
          id,
          businessId
        ])
      ).rowCount === 1
    )
  }
  async isAcceptedCustomer(businessId: string, customerId: string) {
    return (
      (
        await this.pool.query(
          "SELECT 1 FROM conversations WHERE business_id=$1 AND customer_id=$2 AND status='accepted'",
          [businessId, customerId]
        )
      ).rowCount === 1
    )
  }
  async createBroadcast(value: BusinessBroadcast) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO business_broadcasts(id,business_id,list_id,title,body,image_urls,published_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          value.id,
          value.businessId,
          value.listId,
          value.title,
          value.body,
          JSON.stringify(value.imageUrls),
          value.publishedAt
        ]
      )
      await client.query(
        `INSERT INTO messages(id,conversation_id,sender_id,body,created_at,read_at,broadcast_id,title,image_urls)
        SELECT gen_random_uuid(),c.id,b.business_id,b.body,b.published_at,NULL,b.id,b.title,b.image_urls
        FROM business_broadcasts b JOIN broadcast_list_members m ON m.list_id=b.list_id
        JOIN conversations c ON c.business_id=b.business_id AND c.customer_id=m.customer_id AND c.status='accepted'
        JOIN users u ON u.id=m.customer_id AND u.is_active=true AND u.deleted_at IS NULL
        LEFT JOIN profile_settings p ON p.user_id=u.id
        WHERE b.id=$1 AND b.suppressed_at IS NULL AND COALESCE(p.allow_broadcasts,true)=true
        ON CONFLICT (broadcast_id,conversation_id) WHERE broadcast_id IS NOT NULL DO NOTHING`,
        [value.id]
      )
      await client.query(
        'UPDATE conversations SET updated_at=$2 WHERE id IN (SELECT conversation_id FROM messages WHERE broadcast_id=$1)',
        [value.id, value.publishedAt]
      )
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  async listBroadcastConversations(broadcastId: string) {
    const result = await this.pool.query<ConversationRow>(
      'SELECT c.* FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE m.broadcast_id=$1',
      [broadcastId]
    )
    return result.rows.map((row) => this.toConversation(row))
  }
  private async broadcasts(where: string, id: string) {
    const result = await this.pool.query(
      `SELECT b.*,u.name business_name,s.read_at,COALESCE(s.saved,false) saved,(s.reported_at IS NOT NULL) reported,(mb.business_id IS NOT NULL) muted FROM business_broadcasts b JOIN users u ON u.id=b.business_id ${where} AND b.suppressed_at IS NULL ORDER BY published_at DESC`,
      [id]
    )
    return result.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      businessId: String(r.business_id),
      listId: String(r.list_id),
      title: String(r.title),
      body: String(r.body),
      imageUrls: r.image_urls as string[],
      publishedAt: new Date(String(r.published_at)),
      businessName: String(r.business_name),
      readAt: r.read_at instanceof Date ? r.read_at : null,
      saved: Boolean(r.saved),
      reported: Boolean(r.reported),
      muted: Boolean(r.muted)
    }))
  }
  listBroadcastsForCustomer(id: string) {
    return this.broadcasts(
      'JOIN messages delivered ON delivered.broadcast_id=b.id JOIN conversations m ON m.id=delivered.conversation_id LEFT JOIN profile_settings p ON p.user_id=m.customer_id LEFT JOIN broadcast_customer_states s ON s.broadcast_id=b.id AND s.customer_id=m.customer_id LEFT JOIN muted_businesses mb ON mb.business_id=b.business_id AND mb.customer_id=m.customer_id WHERE m.customer_id=$1 AND COALESCE(p.allow_broadcasts,true)=true',
      id
    )
  }
  listBroadcastsForBusiness(id: string) {
    return this.broadcasts(
      'LEFT JOIN broadcast_customer_states s ON false LEFT JOIN muted_businesses mb ON false WHERE b.business_id=$1',
      id
    )
  }
  async setBroadcastState(
    customerId: string,
    broadcastId: string,
    state: { read?: boolean; saved?: boolean; reported?: boolean }
  ) {
    const result = await this.pool.query(
      `INSERT INTO broadcast_customer_states(broadcast_id,customer_id,read_at,saved,reported_at) SELECT b.id,$1,$3,COALESCE($4,false),$5 FROM business_broadcasts b JOIN messages delivered ON delivered.broadcast_id=b.id JOIN conversations c ON c.id=delivered.conversation_id AND c.customer_id=$1 WHERE b.id=$2 AND b.suppressed_at IS NULL ON CONFLICT(broadcast_id,customer_id) DO UPDATE SET read_at=COALESCE($3,broadcast_customer_states.read_at),saved=COALESCE($4,broadcast_customer_states.saved),reported_at=COALESCE($5,broadcast_customer_states.reported_at)`,
      [
        customerId,
        broadcastId,
        state.read === undefined ? null : state.read ? new Date() : null,
        state.saved ?? null,
        state.reported ? new Date() : null
      ]
    )
    return (result.rowCount ?? 0) > 0
  }
  async setBusinessMuted(customerId: string, businessId: string, muted: boolean) {
    if (muted)
      await this.pool.query(
        'INSERT INTO muted_businesses(customer_id,business_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [customerId, businessId]
      )
    else
      await this.pool.query(
        'DELETE FROM muted_businesses WHERE customer_id=$1 AND business_id=$2',
        [customerId, businessId]
      )
  }
  async listBroadcastDrafts(businessId: string): Promise<BroadcastDraft[]> {
    const result = await this.pool.query(
      'SELECT * FROM broadcast_drafts WHERE business_id=$1 ORDER BY updated_at DESC',
      [businessId]
    )
    return result.rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      businessId: String(r.business_id),
      listId: typeof r.list_id === 'string' ? r.list_id : null,
      title: String(r.title),
      body: String(r.body),
      imageUrls: r.image_urls as string[],
      createdAt: new Date(String(r.created_at)),
      updatedAt: new Date(String(r.updated_at))
    }))
  }
  async saveBroadcastDraft(value: BroadcastDraft) {
    await this.pool.query(
      `INSERT INTO broadcast_drafts(id,business_id,list_id,title,body,image_urls,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET list_id=$3,title=$4,body=$5,image_urls=$6,updated_at=$8 WHERE broadcast_drafts.business_id=$2`,
      [
        value.id,
        value.businessId,
        value.listId,
        value.title,
        value.body,
        JSON.stringify(value.imageUrls),
        value.createdAt,
        value.updatedAt
      ]
    )
    return value
  }
  async deleteBroadcastDraft(businessId: string, id: string) {
    return (
      (
        await this.pool.query('DELETE FROM broadcast_drafts WHERE id=$1 AND business_id=$2', [
          id,
          businessId
        ])
      ).rowCount === 1
    )
  }
  async listBroadcastReports(): Promise<BroadcastReport[]> {
    const result = await this.pool.query(
      `SELECT s.broadcast_id,s.customer_id,s.reported_at,b.business_id,b.title,b.body,c.name customer_name,u.name business_name FROM broadcast_customer_states s JOIN business_broadcasts b ON b.id=s.broadcast_id JOIN users c ON c.id=s.customer_id JOIN users u ON u.id=b.business_id WHERE s.reported_at IS NOT NULL AND s.resolved_at IS NULL ORDER BY s.reported_at DESC`
    )
    return result.rows.map((r: Record<string, unknown>) => ({
      broadcastId: String(r.broadcast_id),
      customerId: String(r.customer_id),
      customerName: String(r.customer_name),
      businessId: String(r.business_id),
      businessName: String(r.business_name),
      title: String(r.title),
      body: String(r.body),
      reportedAt: r.reported_at instanceof Date ? r.reported_at : new Date(String(r.reported_at))
    }))
  }
  async resolveBroadcastReport(
    adminId: string,
    broadcastId: string,
    customerId: string,
    action: 'dismissed' | 'suppressed'
  ) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE broadcast_customer_states SET report_resolution=$4,resolved_at=now(),resolved_by=$3 WHERE broadcast_id=$1 AND customer_id=$2 AND reported_at IS NOT NULL AND resolved_at IS NULL`,
        [broadcastId, customerId, adminId, action]
      )
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK')
        return false
      }
      if (action === 'suppressed')
        await client.query(
          'UPDATE business_broadcasts SET suppressed_at=now(),suppressed_by=$2 WHERE id=$1',
          [broadcastId, adminId]
        )
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
