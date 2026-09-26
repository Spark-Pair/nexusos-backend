import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../config.js'
import { MemoryAuthRepository } from '../infrastructure/MemoryAuthRepository.js'
import { PushNotificationService } from './PushNotificationService.js'

const config: AppConfig = {
  NODE_ENV: 'test',
  PORT: 8000,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'unused',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
  JWT_ISSUER: 'nexusos-test',
  ADMIN_EMAILS: 'admin@example.test'
}

describe('PushNotificationService quiet hours', () => {
  it('suppresses alerts during an overnight quiet window in the saved timezone', async () => {
    const repository = new MemoryAuthRepository()
    const service = new PushNotificationService(repository, config)
    const userId = crypto.randomUUID()
    const settings = await repository.getProfileSettings(userId)
    await repository.updateProfileSettings({
      ...settings,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timeZone: 'UTC'
    })

    await expect(service.isAllowed(userId, new Date('2026-01-01T21:59:00Z'))).resolves.toBe(true)
    await expect(service.isAllowed(userId, new Date('2026-01-01T22:00:00Z'))).resolves.toBe(false)
    await expect(service.isAllowed(userId, new Date('2026-01-02T07:59:00Z'))).resolves.toBe(false)
    await expect(service.isAllowed(userId, new Date('2026-01-02T08:00:00Z'))).resolves.toBe(true)
  })

  it('evaluates quiet-hours boundaries in the user timezone', async () => {
    const repository = new MemoryAuthRepository()
    const service = new PushNotificationService(repository, config)
    const userId = crypto.randomUUID()
    const settings = await repository.getProfileSettings(userId)
    await repository.updateProfileSettings({
      ...settings,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timeZone: 'Asia/Karachi'
    })

    await expect(service.isAllowed(userId, new Date('2026-01-01T16:59:00Z'))).resolves.toBe(true)
    await expect(service.isAllowed(userId, new Date('2026-01-01T17:00:00Z'))).resolves.toBe(false)
  })
})
