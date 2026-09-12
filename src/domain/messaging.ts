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
  broadcastId?: string | null
  title?: string
  imageUrls?: string[]
}
export interface ConversationSummary extends Conversation {
  counterpart: DirectoryProfile
  lastMessage: Message | null
  unreadCount: number
  archived: boolean
  muted: boolean
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
  listConversations(userId: string): Promise<Conversation[]>
  markMessagesDelivered(conversationId: string, recipientId: string): Promise<Date>
  markMessagesRead(conversationId: string, readerId: string): Promise<void>
  countUnread(conversationId: string, readerId: string): Promise<number>
  findProfile(id: string): Promise<DirectoryProfile | null>
  getConversationState(
    userId: string,
    conversationId: string
  ): Promise<{ archived: boolean; muted: boolean }>
  setConversationState(
    userId: string,
    conversationId: string,
    state: { archived?: boolean | undefined; muted?: boolean | undefined }
  ): Promise<void>
}
