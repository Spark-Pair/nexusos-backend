export interface OtpDeliveryProvider {
  deliver(phone: string, code: string): Promise<void>
  exposeDevelopmentCode(code: string): string | null
}

export class DevelopmentOtpDeliveryProvider implements OtpDeliveryProvider {
  deliver(phone: string, code: string): Promise<void> {
    void phone
    void code
    return Promise.resolve()
  }
  exposeDevelopmentCode(code: string) {
    return code
  }
}

export class UnconfiguredSmsDeliveryProvider implements OtpDeliveryProvider {
  deliver(phone: string, code: string): Promise<void> {
    void phone
    void code
    return Promise.reject(new Error('Production SMS provider is not configured.'))
  }
  exposeDevelopmentCode() {
    return null
  }
}
