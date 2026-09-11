import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { AppConfig } from '../config.js'
import type { AccountKind, AuthRepository, User } from '../domain/auth.js'

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 422
  ) {
    super(message)
  }
}
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly config: AppConfig
  ) {}
  private username(name: string) {
    const base =
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '')
        .slice(0, 36) || 'user'
    return `${base}-${crypto.randomUUID().slice(0, 6)}`
  }
  private isAdmin(user: User) {
    const allowed = this.config.ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
    return Boolean(user.email && allowed.includes(user.email.toLowerCase()))
  }
  async register(input: {
    name: string
    email: string
    password: string
    accountKind: AccountKind
  }) {
    const email = input.email.trim().toLowerCase()
    if (await this.repository.findUserByEmail(email))
      throw new AuthError('An account already uses this email.')
    const user = await this.repository.createUser({
      name: input.name.trim(),
      email,
      phone: null,
      passwordHash: await bcrypt.hash(input.password, 12),
      googleId: null,
      accountKind: input.accountKind,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      onboardingCompletedAt: null,
      username: this.username(input.name),
      signupMethod: 'email',
      lastLoginMethod: null,
      lastLoginAt: null,
      isActive: true,
      createdAt: new Date(),
      deletedAt: null
    })
    return this.session(await this.repository.recordLogin(user.id, 'email'))
  }
  async login(email: string, password: string) {
    const user = await this.repository.findUserByEmail(email.trim().toLowerCase())
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash)))
      throw new AuthError('The supplied credentials are invalid.')
    if (!user.isActive) throw new AuthError('This account has been deactivated.', 403)
    return this.session(await this.repository.recordLogin(user.id, 'email'))
  }
  async google(input: { googleId: string; email: string; name: string; accountKind: AccountKind }) {
    let user = await this.repository.findUserByEmail(input.email.toLowerCase())
    if (user)
      user = await this.repository.updateUser({
        ...user,
        googleId: input.googleId,
        emailVerifiedAt: new Date()
      })
    else
      user = await this.repository.createUser({
        name: input.name,
        email: input.email.toLowerCase(),
        phone: null,
        passwordHash: null,
        googleId: input.googleId,
        accountKind: input.accountKind,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: null,
        onboardingCompletedAt: null,
        username: this.username(input.name),
        signupMethod: 'google',
        lastLoginMethod: null,
        lastLoginAt: null,
        isActive: true,
        createdAt: new Date(),
        deletedAt: null
      })
    if (!user.isActive) throw new AuthError('This account has been deactivated.', 403)
    return this.session(await this.repository.recordLogin(user.id, 'google'))
  }
  session(user: User) {
    return {
      data: this.publicUser(user),
      token: jwt.sign({ sub: user.id, kind: user.accountKind }, this.config.JWT_SECRET, {
        expiresIn: '15m',
        issuer: this.config.JWT_ISSUER
      }),
      requires_phone: false
    }
  }
  async restore(token: string) {
    let subject: string
    try {
      const payload = jwt.verify(token, this.config.JWT_SECRET, { issuer: this.config.JWT_ISSUER })
      if (typeof payload === 'string' || typeof payload.sub !== 'string')
        throw new Error('Missing subject')
      subject = payload.sub
    } catch {
      throw new AuthError('The session is invalid or expired.', 401)
    }
    const user = await this.repository.findUserById(subject)
    if (!user || !user.isActive || user.deletedAt)
      throw new AuthError('The session is invalid or expired.', 401)
    return { data: this.publicUser(user), requires_phone: false }
  }
  publicUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      account_kind: user.accountKind,
      phone_verified_at: user.phoneVerifiedAt?.toISOString() ?? null,
      is_admin: this.isAdmin(user)
    }
  }
}
