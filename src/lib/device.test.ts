import { describe, expect, it } from 'vitest'
import { deviceHash, ipPrefix, userAgentFamily } from './device'

describe('userAgentFamily', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
      'Opera',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Firefox',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari',
    ],
    ['curl/8.0', 'Other'],
  ])('%s', (ua, family) => {
    expect(userAgentFamily(ua)).toBe(family)
  })

  it('handles a missing header', () => {
    expect(userAgentFamily(null)).toBe('Other')
  })

  it('never returns text from the header', () => {
    expect(userAgentFamily('<script>alert(1)</script> Firefox/1')).toBe(
      'Firefox',
    )
  })
})

describe('ipPrefix', () => {
  it('keeps only the /24 of an IPv4 address', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24')
  })

  it('keeps only the /48 of an IPv6 address', () => {
    expect(ipPrefix('2001:db8:abcd:12:34:56:78:9a')).toBe('2001:db8:abcd::/48')
  })

  it('expands compressed IPv6 first', () => {
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0::/48')
    expect(ipPrefix('::1')).toBe('0:0:0::/48')
    expect(ipPrefix('2001:db8:1:2:3:4:5::')).toBe('2001:db8:1::/48')
  })

  it('handles IPv4-mapped IPv6', () => {
    expect(ipPrefix('::ffff:203.0.113.77')).toBe('0:0:0::/48')
  })

  it('returns null for anything else and never echoes the input', () => {
    expect(ipPrefix('unknown')).toBeNull()
    expect(ipPrefix('')).toBeNull()
    expect(ipPrefix('1.2.3')).toBeNull()
  })
})

describe('deviceHash', () => {
  const salt = 'a-long-enough-test-salt'

  it('is stable for the same device and differs by salt, browser and network', () => {
    const base = deviceHash(salt, 'Firefox', '203.0.113.0/24')
    expect(deviceHash(salt, 'Firefox', '203.0.113.0/24')).toBe(base)
    expect(
      deviceHash('another-long-test-salt', 'Firefox', '203.0.113.0/24'),
    ).not.toBe(base)
    expect(deviceHash(salt, 'Chrome', '203.0.113.0/24')).not.toBe(base)
    expect(deviceHash(salt, 'Firefox', '198.51.100.0/24')).not.toBe(base)
  })

  it('contains neither the browser nor the network in the clear', () => {
    const hash = deviceHash(salt, 'Firefox', '203.0.113.0/24')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
