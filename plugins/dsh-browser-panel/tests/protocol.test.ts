import { describe, expect, it } from 'vitest'
import { renderSnapshot, type PageSnapshot } from '../src/protocol.ts'

describe('renderSnapshot', () => {
  it('renders numbered interactive inventory with truncation', () => {
    const snapshot: PageSnapshot = {
      url: 'https://example.com',
      title: 'Example',
      truncated: true,
      elements: [
        { index: 1, role: 'link', name: 'About', tag: 'a', visible: true, xpath: '/html/body/a' },
      ],
    }
    const text = renderSnapshot(snapshot, 1000)
    expect(text).toContain('URL: https://example.com')
    expect(text).toContain('[1] <a> link: About')
    expect(text).toContain('truncated')
  })

  it('caps output at maxChars', () => {
    const snapshot: PageSnapshot = {
      url: 'https://example.com',
      title: 'Example',
      truncated: false,
      elements: [],
    }
    const text = renderSnapshot(snapshot, 10)
    expect(text.length).toBeLessThanOrEqual(30)
    expect(text).toContain('truncated')
  })
})
