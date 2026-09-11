export type AccountKind = 'customer' | 'business'
export interface User {
  id: string
  name: string
  email: string | null
  phone: string | null
  passwordHash: string | null
  googleId: string | null
  accountKind: AccountKind
  emailVerifiedAt: Date | null
  phoneVerifiedAt: Date | null
  onboardingCompletedAt: Date | null
  username: string
  signupMethod: 'email' | 'phone' | 'google'
  lastLoginMethod: 'email' | 'phone' | 'google' | null
  lastLoginAt: Date | null
  isActive: boolean
  createdAt: Date
  deletedAt: Date | null
}
export interface BusinessRequest {
  id: string
  userId: string
  userName: string
  userEmail: string | null
  businessName: string
  contactPersonName: string
  phone: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: Date
  reviewedAt: Date | null
  reviewedBy: string | null
}

export interface AdminUserRecord {
  id: string
  name: string
  username: string
  email: string | null
  phone: string | null
  accountKind: AccountKind
  signupMethod: User['signupMethod']
  lastLoginMethod: User['lastLoginMethod']
  lastLoginAt: Date | null
  isActive: boolean
  createdAt: Date
  deletedAt: Date | null
}
export interface AuthRepository {
  findUserById(id: string): Promise<User | null>
  findUserByEmail(email: string): Promise<User | null>
  createUser(input: Omit<User, 'id'>): Promise<User>
  updateUser(user: User): Promise<User>
  recordLogin(id: string, method: NonNullable<User['lastLoginMethod']>): Promise<User>
  listUsersForAdmin(query: string): Promise<AdminUserRecord[]>
  setUserActive(id: string, active: boolean): Promise<AdminUserRecord | null>
  deleteUser(id: string): Promise<AdminUserRecord | null>
  createBusinessRequest(input: {
    userId: string
    businessName: string
    contactPersonName: string
    phone: string
  }): Promise<BusinessRequest>
  listBusinessRequests(): Promise<BusinessRequest[]>
  resolveBusinessRequest(
    id: string,
    adminId: string,
    decision: 'approved' | 'rejected'
  ): Promise<BusinessRequest | null>
  savePushSubscription(userId: string, subscription: PushSubscriptionRecord): Promise<void>
  removePushSubscription(userId: string, endpoint: string): Promise<void>
  listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>
  getProfileSettings(userId: string): Promise<ProfileSettings>
  updateProfileSettings(value: ProfileSettings): Promise<ProfileSettings>
}

export interface ProfileSettings {
  userId: string
  bio: string
  language: 'en' | 'ur' | 'roman-ur'
  showLastSeen: boolean
  allowReadReceipts: boolean
  allowBroadcasts: boolean
  updatedAt: Date
}

export interface PushSubscriptionRecord {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}
