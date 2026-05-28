export class LoggerService {
  async logAction(body: { action: string; meta?: Record<string, unknown> }) {
    // TODO: write to log store
    return { logged: true, timestamp: Date.now() };
  }
}
