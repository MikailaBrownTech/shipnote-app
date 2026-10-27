import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AccountDeletedPage from './page'

async function render(search: Record<string, string | string[]> = {}) {
  const element: ReactElement = (
    <AccountDeletedPage searchParams={Promise.resolve(search)} />
  )
  const stream = await renderToReadableStream(element)
  await stream.allReady
  return (await new Response(stream).text()).replaceAll('<!-- -->', '')
}

describe('the account deleted page', () => {
  it('says the account was deleted, and nothing about Buffer when there was none', async () => {
    const html = await render()
    expect(html).toContain('Your account was deleted')
    expect(html).not.toContain('Buffer')
  })

  it('tells the person to remove Shipnote in Buffer when they had connected it', async () => {
    const html = await render({ buffer: '1' })
    expect(html).toContain(
      'Shipnote deleted its saved access to your Buffer account.',
    )
    expect(html).toContain(
      'remove Shipnote from the connected apps in your Buffer account settings',
    )
    expect(html).not.toContain('could not be cancelled')
  })

  it('says how many scheduled posts may still publish', async () => {
    const one = await render({ buffer: '1', left: '1' })
    expect(one).toContain('1 scheduled post could not be')
    expect(one).toContain('Cancel it in Buffer.')
    const many = await render({ buffer: '1', left: '4' })
    expect(many).toContain('4 scheduled posts could not be')
    expect(many).toContain('Cancel them in Buffer.')
  })

  it('never echoes the address, and ignores junk', async () => {
    const html = await render({
      buffer: '<script>x</script>',
      left: '<b>9</b>',
      extra: 'EVIL',
    })
    expect(html).not.toContain('EVIL')
    expect(html).not.toContain('<script>x')
    expect(html).not.toContain('Buffer')
  })
})
