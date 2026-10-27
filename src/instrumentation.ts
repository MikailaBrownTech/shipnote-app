// Runs once when the server starts. If ALERTS_ENABLED or GITHUB_ENABLED is true
// but a variable is missing, this throws, naming it, so the server does not start half-working.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { assertServerConfig } = await import('@/server/startup')
  assertServerConfig()
}
