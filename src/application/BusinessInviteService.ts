import { createHash, randomBytes } from 'node:crypto'
import type { AccountKind } from '../domain/auth.js'
import type {
  BusinessInvite,
  InviteConnectionResult,
  MessagingRepository,
  PublicBusinessInvite
} from '../domain/messaging.js'
import { AuthError } from './AuthService.js'

const inviteType = 'customer_connect' as const

export class BusinessInviteService {
  constructor(
    private readonly repository: MessagingRepository,
    private readonly frontendUrl: string
  ) {}

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private token() {
    return randomBytes(32).toString('base64url')
  }

  private inviteUrl(token: string) {
    return new URL(`/join/${token}`, this.frontendUrl).toString()
  }

  private async publicInvite(invite: BusinessInvite): Promise<PublicBusinessInvite> {
    if (!invite.isActive || invite.revokedAt)
      throw new AuthError('Invite link is no longer active.', 410)
    if (invite.expiresAt && invite.expiresAt <= new Date())
      throw new AuthError('Invite link has expired.', 410)
    const business = await this.repository.findProfile(invite.businessId)
    if (!business || business.accountKind !== 'business')
      throw new AuthError('Invite business is unavailable.', 404)
    return { id: invite.id, business }
  }

  async getBusinessInvite(businessId: string, kind: AccountKind) {
    if (kind !== 'business') throw new AuthError('Business access is required.', 403)
    const existing = await this.repository.findReusableBusinessInvite(businessId)
    if (existing) return { inviteUrl: this.inviteUrl(existing.token), invite: existing }
    return this.createBusinessInvite(businessId, kind)
  }

  async createBusinessInvite(businessId: string, kind: AccountKind) {
    if (kind !== 'business') throw new AuthError('Business access is required.', 403)
    await this.repository.revokeBusinessInvites(businessId, new Date())
    const token = this.token()
    const now = new Date()
    const invite: BusinessInvite = {
      id: crypto.randomUUID(),
      businessId,
      token,
      tokenHash: this.hash(token),
      type: inviteType,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      revokedAt: null
    }
    await this.repository.createBusinessInvite(invite)
    return { inviteUrl: this.inviteUrl(token), invite }
  }

  async currentBusinessInvite(businessId: string, kind: AccountKind) {
    if (kind !== 'business') throw new AuthError('Business access is required.', 403)
    return this.getBusinessInvite(businessId, kind)
  }

  async revokeBusinessInvite(businessId: string, kind: AccountKind) {
    if (kind !== 'business') throw new AuthError('Business access is required.', 403)
    await this.repository.revokeBusinessInvites(businessId, new Date())
  }

  async resolve(token: string) {
    const invite = await this.repository.findBusinessInviteByTokenHash(this.hash(token))
    if (!invite) throw new AuthError('Invite link was not found.', 404)
    return this.publicInvite(invite)
  }

  async connect(
    token: string,
    customerId: string,
    kind: AccountKind
  ): Promise<InviteConnectionResult> {
    if (kind !== 'customer')
      throw new AuthError('Only customer accounts can accept this invite.', 403)
    const invite = await this.repository.findBusinessInviteByTokenHash(this.hash(token))
    if (!invite) throw new AuthError('Invite link was not found.', 404)
    const publicInvite = await this.publicInvite(invite)
    const result = await this.repository.connectBusinessInvite({
      inviteId: invite.id,
      customerId,
      businessId: invite.businessId,
      connectedAt: new Date()
    })
    return { invite: publicInvite, ...result }
  }
}
