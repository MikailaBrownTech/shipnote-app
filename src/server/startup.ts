import 'server-only'
import { getAlertsEnv } from './env'

// Called once at server start (see src/instrumentation.ts). Throws, naming
// the variable, if ALERTS_ENABLED=true and the email settings are incomplete.
export function assertServerConfig() {
  getAlertsEnv()
}
