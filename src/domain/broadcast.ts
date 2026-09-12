export interface BroadcastList {
  id: string
  businessId: string
  name: string
  customerIds: string[]
  createdAt: Date
  updatedAt: Date
}
export interface BusinessBroadcast {
  id: string
  businessId: string
  listId: string
  listIds?: string[]
  title: string
  body: string
  imageUrls: string[]
  publishedAt: Date
  scheduledFor?: Date | null
  deliveredAt?: Date | null
  businessName?: string
  readAt?: Date | null
  saved?: boolean
  muted?: boolean
  reported?: boolean
}
export interface BroadcastDraft {
  id: string
  businessId: string
  listId: string | null
  title: string
  body: string
  imageUrls: string[]
  createdAt: Date
  updatedAt: Date
}
export interface BroadcastReport {
  broadcastId: string
  customerId: string
  customerName: string
  businessId: string
  businessName: string
  title: string
  body: string
  reportedAt: Date
}
export interface BroadcastRepository {
  listConnectedCustomers(
    businessId: string
  ): Promise<Array<{ id: string; name: string; username: string }>>
  listBroadcastLists(businessId: string): Promise<BroadcastList[]>
  saveBroadcastList(value: BroadcastList): Promise<BroadcastList>
  deleteBroadcastList(businessId: string, id: string): Promise<boolean>
  isAcceptedCustomer(businessId: string, customerId: string): Promise<boolean>
  createBroadcast(value: BusinessBroadcast): Promise<BusinessBroadcast>
  deliverDueBroadcasts(now: Date): Promise<BusinessBroadcast[]>
  listBroadcastConversations(
    broadcastId: string
  ): Promise<Array<{ id: string; customerId: string; businessId: string }>>
  listBroadcastsForCustomer(customerId: string): Promise<BusinessBroadcast[]>
  listBroadcastsForBusiness(businessId: string): Promise<BusinessBroadcast[]>
  setBroadcastState(
    customerId: string,
    broadcastId: string,
    state: {
      read?: boolean | undefined
      saved?: boolean | undefined
      reported?: boolean | undefined
    }
  ): Promise<boolean>
  setBusinessMuted(customerId: string, businessId: string, muted: boolean): Promise<void>
  listBroadcastDrafts(businessId: string): Promise<BroadcastDraft[]>
  saveBroadcastDraft(value: BroadcastDraft): Promise<BroadcastDraft>
  deleteBroadcastDraft(businessId: string, id: string): Promise<boolean>
  listBroadcastReports(): Promise<BroadcastReport[]>
  resolveBroadcastReport(
    adminId: string,
    broadcastId: string,
    customerId: string,
    action: 'dismissed' | 'suppressed'
  ): Promise<boolean>
}
