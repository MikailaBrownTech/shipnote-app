// Pure part of the rate limiter, so it can be tested with a fake limiter.

export type Limiter = { limit(key: string): Promise<{ success: boolean }> }

type Options = {
  timeoutMs?: number
  onFailOpen?: () => void
}

// Returns true when the request may go ahead. If the limiter is missing,
// slow or throws, the request is allowed (fail open): Supabase's own limits
// remain the backstop, and a Redis outage must not lock everyone out.
export async function allow(
  limiter: Limiter | null,
  key: string,
  { timeoutMs = 1500, onFailOpen }: Options = {},
): Promise<boolean> {
  if (!limiter) return true

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout')
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([limiter.limit(key), timeout])
    if (result === 'timeout') {
      onFailOpen?.()
      return true
    }
    return result.success
  } catch {
    onFailOpen?.()
    return true
  } finally {
    clearTimeout(timer)
  }
}
