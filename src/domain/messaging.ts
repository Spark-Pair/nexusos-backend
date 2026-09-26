import type { AccountKind } from './auth.js'

export type ConversationStatus = 'pending' | 'accepted' | 'rejected'
export interface DirectoryProfile {
  id: string
  name: string
  username: string
  accountKind: AccountKind
  followed: boolean
}
export interface Conversation {
  id: string
  customerId: string
  businessId: string
  invitedBy: string
  status: ConversationStatus
  createdAt: Date
  updatedAt: Date
}
export interface Message {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: Date
  deliveredAt?: Date | null
  readAt: Date | null
  editedAt?: Date | null
  deletedAt?: Date | null
  forwardedAt?: Date | null
  broadcastId?: string | null
  title?: string
  imageUrls?: string[]
  audioUrl?: string | null
  reactions?: Record<string, string[]>
  replyToMessageId?: string | null
  replyToBody?: string | null
  replyToSenderId?: string | null
}
export interface ConversationSummary extends Conversation {
  counterpart: DirectoryProfile
  lastMessage: Message | null
  unreadCount: number
  archived: boolean
  muted: boolean
  pinned: boolean
}
export interface MessageSearchResult {
  conversationId: string
  messageId: string
  body: string
  title: string
  createdAt: Date
}
export interface BusinessInvite {
  id: string
  businessId: string
  token: string
  tokenHash: string
  type: 'customer_connect'
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}
export interface PublicBusinessInvite {
  id: string
  business: DirectoryProfile
}
export interface InviteConnectionResult {
  invite: PublicBusinessInvite
  conversation: Conversation
  alreadyConnected: boolean
}
export interface MessagingRepository {
  searchProfiles(
    actorId: string,
    actorKind: AccountKind,
    query: string
  ): Promise<DirectoryProfile[]>
  setFollow(customerId: string, businessId: string, following: boolean): Promise<void>
  isFollowing(customerId: string, businessId: string): Promise<boolean>
  findConversation(id: string): Promise<Conversation | null>
  findConversationBetween(customerId: string, businessId: string): Promise<Conversation | null>
  createConversation(value: Conversation): Promise<void>
  updateConversation(value: Conversation): Promise<void>
  createMessage(value: Message): Promise<void>
  findMessage(id: string): Promise<Message | null>
  listMessages(conversationId: string): Promise<Message[]>
  searchMessages(userId: string, query: string): Promise<MessageSearchResult[]>
  setMessageReaction(
    messageId: string,
    userId: string,
    emoji: string | null
  ): Promise<Message | null>
  updateMessageBody(messageId: string, body: string, editedAt: Date): Promise<Message | null>
  deleteMessageForEveryone(messageId: string, deletedAt: Date): Promise<Message | null>
  listConversations(userId: string): Promise<Conversation[]>
  markMessagesDelivered(conversationId: string, recipientId: string): Promise<Date>
  markMessagesRead(conversationId: string, readerId: string): Promise<void>
  countUnread(conversationId: string, readerId: string): Promise<number>
  findProfile(id: string): Promise<DirectoryProfile | null>
  getConversationState(
    userId: string,
    conversationId: string
  ): Promise<{ archived: boolean; muted: boolean; pinned: boolean }>
  setConversationState(
    userId: string,
    conversationId: string,
    state: {
      archived?: boolean | undefined
      muted?: boolean | undefined
      pinned?: boolean | undefined
    }
  ): Promise<void>
  findReusableBusinessInvite(businessId: string): Promise<BusinessInvite | null>
  createBusinessInvite(value: BusinessInvite): Promise<void>
  revokeBusinessInvites(businessId: string, revokedAt: Date): Promise<void>
  findBusinessInviteByTokenHash(tokenHash: string): Promise<BusinessInvite | null>
  connectBusinessInvite(input: {
    inviteId: string
    customerId: string
    businessId: string
    connectedAt: Date
  }): Promise<{ conversation: Conversation; alreadyConnected: boolean }>
}
