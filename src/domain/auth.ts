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
export interface PhoneChallenge {
  id: string
  phone: string
  codeHash: string
  attempts: number
  expiresAt: Date
  consumedAt: Date | null
}
export interface AuthRepository {
  findUserById(id: string): Promise<User | null>
  findUserByEmail(email: string): Promise<User | null>
  findUserByPhone(phone: string): Promise<User | null>
  createUser(input: Omit<User, 'id'>): Promise<User>
  updateUser(user: User): Promise<User>
  createChallenge(challenge: PhoneChallenge): Promise<void>
  findChallenge(id: string): Promise<PhoneChallenge | null>
  updateChallenge(challenge: PhoneChallenge): Promise<void>
  invalidateActiveChallenges(phone: string): Promise<void>
  recordLogin(id: string, method: NonNullable<User['lastLoginMethod']>): Promise<User>
  listUsersForAdmin(query: string): Promise<AdminUserRecord[]>
  setUserActive(id: string, active: boolean): Promise<AdminUserRecord | null>
  deleteUser(id: string): Promise<AdminUserRecord | null>
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
