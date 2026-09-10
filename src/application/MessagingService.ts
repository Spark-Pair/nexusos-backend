import type { AccountKind } from '../domain/auth.js'
import type { Conversation, MessagingRepository } from '../domain/messaging.js'
import { AuthError } from './AuthService.js'

export class MessagingService {
  constructor(
    private readonly repository: MessagingRepository,
    private readonly notify?: (
      userId: string,
      payload: { title: string; body: string; url: string }
    ) => Promise<void>
  ) {}
  search(userId: string, kind: AccountKind, query: string) {
    if (kind !== 'business' || !query.trim()) return []
    return this.repository.searchProfiles(userId, kind, query)
  }
  async follow(
    customerId: string,
    customerKind: AccountKind,
    businessId: string,
    following: boolean
  ) {
    if (customerKind !== 'customer')
      throw new AuthError('Only customers can follow businesses.', 403)
    const business = await this.repository.findProfile(businessId)
    if (!business || business.accountKind !== 'business')
      throw new AuthError('Business not found.', 404)
    await this.repository.setFollow(customerId, businessId, following)
  }
  async invite(actorId: string, kind: AccountKind, counterpartId: string, body: string) {
    if (kind !== 'business') throw new AuthError('Only businesses can invite customers.', 403)
    const counterpart = await this.repository.findProfile(counterpartId)
    if (!counterpart || counterpart.accountKind === kind)
      throw new AuthError('Account not found.', 404)
    const customerId = counterpartId
    const businessId = actorId
    const existing = await this.repository.findConversationBetween(customerId, businessId)
    if (existing && existing.status !== 'rejected')
      throw new AuthError('A conversation already exists.', 409)
    const now = new Date()
    const conversation: Conversation = existing
      ? {
          ...existing,
          invitedBy: actorId,
          status: 'pending',
          updatedAt: now
        }
      : {
          id: crypto.randomUUID(),
          customerId,
          businessId,
          invitedBy: actorId,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        }
    if (existing) await this.repository.updateConversation(conversation)
    else await this.repository.createConversation(conversation)
    await this.repository.createMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      senderId: actorId,
      body: body.trim(),
      createdAt: now,
      readAt: null
    })
    const sender = await this.repository.findProfile(actorId)
    await this.notify?.(counterpartId, {
      title: sender?.name ?? 'NexusOS',
      body: conversation.status === 'pending' ? 'New conversation invitation' : body.trim(),
      url: `/app/chats/${conversation.id}`
    }).catch(() => undefined)
    return conversation
  }
  async respond(actorId: string, id: string, decision: 'accepted' | 'rejected') {
    const conversation = await this.requireParticipant(actorId, id)
    if (conversation.customerId !== actorId || conversation.invitedBy === actorId)
      throw new AuthError('Only the invited customer can respond.', 403)
    if (conversation.status !== 'pending')
      throw new AuthError('This invitation was already handled.', 409)
    conversation.status = decision
    conversation.updatedAt = new Date()
    await this.repository.updateConversation(conversation)
    return conversation
  }
  async send(actorId: string, id: string, body: string, clientId: string = crypto.randomUUID()) {
    const conversation = await this.requireParticipant(actorId, id)
    if (conversation.status !== 'accepted')
      throw new AuthError('Accept the invitation before messaging.', 403)
    const previous = await this.repository.findMessage(clientId)
    if (previous) {
      if (
        previous.senderId !== actorId ||
        previous.conversationId !== id ||
        previous.body !== body.trim()
      )
        throw new AuthError('This message identifier has already been used.', 409)
      return previous
    }
    const message = {
      id: clientId,
      conversationId: id,
      senderId: actorId,
      body: body.trim(),
      createdAt: new Date(),
      readAt: null
    }
    await this.repository.createMessage(message)
    const persisted = await this.repository.findMessage(clientId)
    if (
      !persisted ||
      persisted.senderId !== actorId ||
      persisted.conversationId !== id ||
      persisted.body !== body.trim()
    )
      throw new AuthError('This message identifier has already been used.', 409)
    conversation.updatedAt = message.createdAt
    await this.repository.updateConversation(conversation)
    const recipientId =
      conversation.customerId === actorId ? conversation.businessId : conversation.customerId
    const sender = await this.repository.findProfile(actorId)
    await this.notify?.(recipientId, {
      title: sender?.name ?? 'NexusOS',
      body: message.body,
      url: `/app/chats/${conversation.id}`
    }).catch(() => undefined)
    return persisted
  }
  async list(actorId: string) {
    const conversations = await this.repository.listConversations(actorId)
    return Promise.all(
      conversations.map(async (conversation) => {
        const counterpartId =
          conversation.customerId === actorId ? conversation.businessId : conversation.customerId
        const counterpart = await this.repository.findProfile(counterpartId)
        const messages = await this.repository.listMessages(conversation.id)
        if (!counterpart) throw new AuthError('Conversation participant not found.', 500)
        return {
          ...conversation,
          counterpart,
          lastMessage: messages.at(-1) ?? null,
          unreadCount: await this.repository.countUnread(conversation.id, actorId),
          ...(await this.repository.getConversationState(actorId, conversation.id))
        }
      })
    )
  }
  async setState(
    actorId: string,
    id: string,
    state: { archived?: boolean | undefined; muted?: boolean | undefined }
  ) {
    await this.requireParticipant(actorId, id)
    await this.repository.setConversationState(actorId, id, state)
  }
  async detail(actorId: string, id: string) {
    const conversation = await this.requireParticipant(actorId, id)
    const counterpartId =
      conversation.customerId === actorId ? conversation.businessId : conversation.customerId
    const counterpart = await this.repository.findProfile(counterpartId)
    if (!counterpart) throw new AuthError('Conversation participant not found.', 500)
    await this.repository.markMessagesRead(id, actorId)
    return { conversation, counterpart, messages: await this.repository.listMessages(id) }
  }
  private async requireParticipant(actorId: string, id: string) {
    const conversation = await this.repository.findConversation(id)
    if (!conversation) throw new AuthError('Conversation not found.', 404)
    if (conversation.customerId !== actorId && conversation.businessId !== actorId)
      throw new AuthError('Conversation not found.', 404)
    return conversation
  }
}
