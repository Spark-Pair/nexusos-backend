import webpush from 'web-push'
import type { AppConfig } from '../config.js'
import type { AuthRepository, PushSubscriptionRecord } from '../domain/auth.js'

export class PushNotificationService {
  private readonly enabled: boolean
  constructor(
    private readonly repository: AuthRepository,
    config: AppConfig
  ) {
    this.enabled = Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)
    if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)
      webpush.setVapidDetails(
        config.VAPID_SUBJECT ?? 'mailto:admin@nexusos.local',
        config.VAPID_PUBLIC_KEY,
        config.VAPID_PRIVATE_KEY
      )
  }
  subscribe(userId: string, subscription: PushSubscriptionRecord) {
    return this.repository.savePushSubscription(userId, subscription)
  }
  unsubscribe(userId: string, endpoint: string) {
    return this.repository.removePushSubscription(userId, endpoint)
  }
  async send(userId: string, payload: { title: string; body: string; url: string }) {
    if (!this.enabled) return
    const subscriptions = await this.repository.listPushSubscriptions(userId)
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, JSON.stringify(payload))
        } catch (error) {
          const statusCode =
            typeof error === 'object' && error && 'statusCode' in error
              ? Number(error.statusCode)
              : 0
          if (statusCode === 404 || statusCode === 410)
            await this.repository.removePushSubscription(userId, subscription.endpoint)
        }
      })
    )
  }
}
