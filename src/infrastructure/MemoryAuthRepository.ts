import type {
  AuthRepository,
  PhoneChallenge,
  ProfileSettings,
  PushSubscriptionRecord,
  User
} from '../domain/auth.js'
import type { Conversation, Message, MessagingRepository } from '../domain/messaging.js'
import type {
  BroadcastDraft,
  BroadcastList,
  BroadcastReport,
  BroadcastRepository,
  BusinessBroadcast
} from '../domain/broadcast.js'

export class MemoryAuthRepository
  implements AuthRepository, MessagingRepository, BroadcastRepository
{
  private readonly users = new Map<string, User>()
  private readonly challenges = new Map<string, PhoneChallenge>()
  private readonly follows = new Set<string>()
  private readonly conversations = new Map<string, Conversation>()
  private readonly messages = new Map<string, Message>()
  private readonly conversationStates = new Map<string, { archived: boolean; muted: boolean }>()
  private readonly pushSubscriptions = new Map<string, PushSubscriptionRecord>()
  private readonly profileSettings = new Map<string, ProfileSettings>()
  private readonly broadcastLists = new Map<string, BroadcastList>()
  private readonly broadcasts = new Map<string, BusinessBroadcast>()
  private readonly broadcastDrafts = new Map<string, BroadcastDraft>()
  private readonly broadcastStates = new Map<
    string,
    { read?: boolean; saved?: boolean; reported?: boolean }
  >()
  private readonly mutedBusinesses = new Set<string>()
  private readonly resolvedBroadcastReports = new Set<string>()
  private readonly suppressedBroadcasts = new Set<string>()
  /* eslint-disable @typescript-eslint/require-await -- Implements the async production contract. */
  async findUserById(id: string) {
    return this.users.get(id) ?? null
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null
  }
  async findUserByPhone(phone: string) {
    return [...this.users.values()].find((user) => user.phone === phone) ?? null
  }
  async createUser(input: Omit<User, 'id'>) {
    const user = { ...input, id: crypto.randomUUID() }
    this.users.set(user.id, user)
    return user
  }
  async updateUser(user: User) {
    this.users.set(user.id, user)
    return user
  }
  async createChallenge(challenge: PhoneChallenge) {
    this.challenges.set(challenge.id, challenge)
  }
  async findChallenge(id: string) {
    return this.challenges.get(id) ?? null
  }
  async updateChallenge(challenge: PhoneChallenge) {
    this.challenges.set(challenge.id, challenge)
  }
  async invalidateActiveChallenges(phone: string) {
    for (const challenge of this.challenges.values()) {
      if (challenge.phone === phone && !challenge.consumedAt) {
        challenge.consumedAt = new Date()
        this.challenges.set(challenge.id, challenge)
      }
    }
  }
  async recordLogin(id: string, method: NonNullable<User['lastLoginMethod']>) {
    const user = this.users.get(id)
    if (!user) throw new Error('User not found')
    const updated = { ...user, lastLoginMethod: method, lastLoginAt: new Date() }
    this.users.set(id, updated)
    return updated
  }
  async listUsersForAdmin(query: string) {
    const needle = query.trim().toLowerCase()
    return [...this.users.values()]
      .filter(
        (user) =>
          !needle ||
          `${user.name} ${user.username} ${user.email ?? ''} ${user.phone ?? ''}`
            .toLowerCase()
            .includes(needle)
      )
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        accountKind: user.accountKind,
        signupMethod: user.signupMethod,
        lastLoginMethod: user.lastLoginMethod,
        lastLoginAt: user.lastLoginAt,
        isActive: user.isActive,
        createdAt: user.createdAt,
        deletedAt: user.deletedAt
      }))
  }
  async setUserActive(id: string, active: boolean) {
    const user = this.users.get(id)
    if (!user || user.deletedAt) return null
    const updated = { ...user, isActive: active }
    this.users.set(id, updated)
    const [record] = await this.listUsersForAdmin(updated.username)
    return record ?? null
  }
  async deleteUser(id: string) {
    const user = this.users.get(id)
    if (!user || user.deletedAt) return null
    const deletedAt = new Date()
    const updated = {
      ...user,
      name: 'Deleted user',
      email: null,
      phone: null,
      passwordHash: null,
      googleId: null,
      isActive: false,
      deletedAt
    }
    this.users.set(id, updated)
    const [record] = await this.listUsersForAdmin(updated.username)
    return record ?? null
  }
  async savePushSubscription(userId: string, subscription: PushSubscriptionRecord) {
    this.pushSubscriptions.set(`${userId}:${subscription.endpoint}`, subscription)
  }
  async removePushSubscription(userId: string, endpoint: string) {
    this.pushSubscriptions.delete(`${userId}:${endpoint}`)
  }
  async listPushSubscriptions(userId: string) {
    return [...this.pushSubscriptions.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, value]) => value)
  }
  async getProfileSettings(userId: string) {
    return (
      this.profileSettings.get(userId) ?? {
        userId,
        bio: '',
        language: 'en' as const,
        showLastSeen: true,
        allowReadReceipts: true,
        allowBroadcasts: true,
        updatedAt: new Date(0)
      }
    )
  }
  async updateProfileSettings(value: ProfileSettings) {
    this.profileSettings.set(value.userId, value)
    return value
  }
  async searchProfiles(actorId: string, actorKind: User['accountKind'], query: string) {
    const needle = query.trim().toLowerCase()
    return [...this.users.values()]
      .filter(
        (user) =>
          !user.deletedAt &&
          user.id !== actorId &&
          actorKind === 'business' &&
          user.accountKind === 'customer' &&
          (user.id.toLowerCase() === needle || user.username.toLowerCase() === needle)
      )
      .slice(0, 20)
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        accountKind: user.accountKind,
        followed: this.follows.has(`${actorId}:${user.id}`)
      }))
  }
  async findProfile(id: string) {
    const user = this.users.get(id)
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
    const key = `${customerId}:${businessId}`
    if (following) this.follows.add(key)
    else this.follows.delete(key)
  }
  async isFollowing(customerId: string, businessId: string) {
    return this.follows.has(`${customerId}:${businessId}`)
  }
  async findConversation(id: string) {
    return this.conversations.get(id) ?? null
  }
  async findConversationBetween(customerId: string, businessId: string) {
    return (
      [...this.conversations.values()].find(
        (item) => item.customerId === customerId && item.businessId === businessId
      ) ?? null
    )
  }
  async createConversation(value: Conversation) {
    this.conversations.set(value.id, value)
  }
  async updateConversation(value: Conversation) {
    this.conversations.set(value.id, value)
  }
  async createMessage(value: Message) {
    if (!this.messages.has(value.id)) this.messages.set(value.id, value)
  }
  async findMessage(id: string) {
    return this.messages.get(id) ?? null
  }
  async listMessages(conversationId: string) {
    return [...this.messages.values()]
      .filter(
        (item) =>
          item.conversationId === conversationId &&
          (!item.broadcastId || !this.suppressedBroadcasts.has(item.broadcastId))
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
  async markMessagesRead(conversationId: string, readerId: string) {
    for (const [id, message] of this.messages)
      if (
        message.conversationId === conversationId &&
        message.senderId !== readerId &&
        !message.readAt &&
        (!message.broadcastId || !this.suppressedBroadcasts.has(message.broadcastId))
      )
        this.messages.set(id, { ...message, readAt: new Date() })
  }
  async countUnread(conversationId: string, readerId: string) {
    return (await this.listMessages(conversationId)).filter(
      (message) =>
        message.conversationId === conversationId &&
        message.senderId !== readerId &&
        !message.readAt
    ).length
  }
  async getConversationState(userId: string, conversationId: string) {
    return (
      this.conversationStates.get(`${userId}:${conversationId}`) ?? {
        archived: false,
        muted: false
      }
    )
  }
  async setConversationState(
    userId: string,
    conversationId: string,
    state: { archived?: boolean; muted?: boolean }
  ) {
    const key = `${userId}:${conversationId}`
    this.conversationStates.set(key, {
      ...(await this.getConversationState(userId, conversationId)),
      ...state
    })
  }
  async listBroadcastLists(businessId: string) {
    return [...this.broadcastLists.values()].filter((x) => x.businessId === businessId)
  }
  async listConnectedCustomers(businessId: string) {
    const ids = new Set(
      [...this.conversations.values()]
        .filter((x) => x.businessId === businessId && x.status === 'accepted')
        .map((x) => x.customerId)
    )
    return [...this.users.values()]
      .filter((x) => ids.has(x.id) && !x.deletedAt)
      .map((x) => ({ id: x.id, name: x.name, username: x.username }))
  }
  async saveBroadcastList(value: BroadcastList) {
    this.broadcastLists.set(value.id, value)
    return value
  }
  async deleteBroadcastList(businessId: string, id: string) {
    const item = this.broadcastLists.get(id)
    if (item?.businessId !== businessId) return false
    for (const [broadcastId, broadcast] of this.broadcasts)
      if (broadcast.listId === id) {
        this.broadcasts.delete(broadcastId)
        for (const [messageId, message] of this.messages)
          if (message.broadcastId === broadcastId) this.messages.delete(messageId)
      }
    return this.broadcastLists.delete(id)
  }
  async isAcceptedCustomer(businessId: string, customerId: string) {
    return [...this.conversations.values()].some(
      (x) => x.businessId === businessId && x.customerId === customerId && x.status === 'accepted'
    )
  }
  async createBroadcast(value: BusinessBroadcast) {
    this.broadcasts.set(value.id, value)
    const list = this.broadcastLists.get(value.listId)
    for (const conversation of this.conversations.values()) {
      const customer = this.users.get(conversation.customerId)
      if (
        conversation.businessId !== value.businessId ||
        conversation.status !== 'accepted' ||
        !list?.customerIds.includes(conversation.customerId) ||
        !customer?.isActive ||
        customer.deletedAt ||
        this.profileSettings.get(customer.id)?.allowBroadcasts === false
      )
        continue
      const message: Message = {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: value.businessId,
        body: value.body,
        title: value.title,
        imageUrls: value.imageUrls,
        broadcastId: value.id,
        createdAt: value.publishedAt,
        readAt: null
      }
      this.messages.set(message.id, message)
      this.conversations.set(conversation.id, { ...conversation, updatedAt: value.publishedAt })
    }
    return value
  }
  async listBroadcastConversations(broadcastId: string) {
    const ids = new Set(
      [...this.messages.values()]
        .filter((message) => message.broadcastId === broadcastId)
        .map((message) => message.conversationId)
    )
    return [...this.conversations.values()].filter((conversation) => ids.has(conversation.id))
  }
  async listBroadcastsForCustomer(customerId: string) {
    if (this.profileSettings.get(customerId)?.allowBroadcasts === false) return []
    const ids = new Set(
      [...this.messages.values()]
        .filter(
          (message) => this.conversations.get(message.conversationId)?.customerId === customerId
        )
        .map((message) => message.broadcastId)
    )
    return [...this.broadcasts.values()]
      .filter((x) => ids.has(x.id) && !this.suppressedBroadcasts.has(x.id))
      .map((x) => ({
        ...x,
        ...this.broadcastStates.get(`${customerId}:${x.id}`),
        muted: this.mutedBusinesses.has(`${customerId}:${x.businessId}`),
        readAt: this.broadcastStates.get(`${customerId}:${x.id}`)?.read ? new Date() : null
      }))
  }
  async listBroadcastsForBusiness(businessId: string) {
    return [...this.broadcasts.values()].filter((x) => x.businessId === businessId)
  }
  async setBroadcastState(
    customerId: string,
    broadcastId: string,
    state: { read?: boolean; saved?: boolean; reported?: boolean }
  ) {
    const item = (await this.listBroadcastsForCustomer(customerId)).find(
      (x) => x.id === broadcastId
    )
    if (!item) return false
    this.broadcastStates.set(`${customerId}:${broadcastId}`, {
      ...this.broadcastStates.get(`${customerId}:${broadcastId}`),
      ...state
    })
    return true
  }
  async setBusinessMuted(customerId: string, businessId: string, muted: boolean) {
    const key = `${customerId}:${businessId}`
    if (muted) this.mutedBusinesses.add(key)
    else this.mutedBusinesses.delete(key)
  }
  async listBroadcastDrafts(businessId: string) {
    return [...this.broadcastDrafts.values()].filter((x) => x.businessId === businessId)
  }
  async saveBroadcastDraft(value: BroadcastDraft) {
    this.broadcastDrafts.set(value.id, value)
    return value
  }
  async deleteBroadcastDraft(businessId: string, id: string) {
    const item = this.broadcastDrafts.get(id)
    return item?.businessId === businessId ? this.broadcastDrafts.delete(id) : false
  }
  async listBroadcastReports(): Promise<BroadcastReport[]> {
    return [...this.broadcastStates.entries()]
      .filter(([key, state]) => state.reported && !this.resolvedBroadcastReports.has(key))
      .flatMap(([key]) => {
        const [customerId, broadcastId] = key.split(':')
        const item = this.broadcasts.get(broadcastId ?? '')
        const customer = this.users.get(customerId ?? '')
        const business = item ? this.users.get(item.businessId) : undefined
        return item && customer && business
          ? [
              {
                broadcastId: item.id,
                customerId: customer.id,
                customerName: customer.name,
                businessId: business.id,
                businessName: business.name,
                title: item.title,
                body: item.body,
                reportedAt: new Date()
              }
            ]
          : []
      })
  }
  async resolveBroadcastReport(
    _adminId: string,
    broadcastId: string,
    customerId: string,
    action: 'dismissed' | 'suppressed'
  ) {
    const key = `${customerId}:${broadcastId}`
    if (!this.broadcastStates.get(key)?.reported || this.resolvedBroadcastReports.has(key))
      return false
    this.resolvedBroadcastReports.add(key)
    if (action === 'suppressed') this.suppressedBroadcasts.add(broadcastId)
    return true
  }
  async listConversations(userId: string) {
    return [...this.conversations.values()]
      .filter((item) => item.customerId === userId || item.businessId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }
  /* eslint-enable @typescript-eslint/require-await */
}
