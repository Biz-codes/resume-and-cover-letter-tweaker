import { afterEach, describe, expect, it, vi } from 'vitest'
import { measure } from './keepInPlace'

// jsdom doesn't lay out a page, so each test sets the numbers the browser would give.
function page({ scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const root = document.documentElement
  // The content's height; the body's bottom padding adds to it, as it does in a browser.
  const state = { scrollHeight, scrollTop }
  const height = () => state.scrollHeight + (parseFloat(document.body.style.paddingBottom) || 0)
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: height })
  Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(root, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (value: number) => (state.scrollTop = Math.min(value, height() - clientHeight)),
  })
  Object.defineProperty(document, 'scrollingElement', { configurable: true, get: () => root })
  return state
}

function buttonAt(tops: number[]) {
  const button = document.createElement('button')
  document.body.append(button)
  let call = 0
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => ({ top: tops[Math.min(call++, tops.length - 1)] }) as DOMRect)
  return button
}

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.paddingBottom = ''
  vi.restoreAllMocks()
})

describe('keepInPlace', () => {
  it('leaves the page alone when the button did not move', () => {
    const state = page({ scrollHeight: 3000, clientHeight: 800, scrollTop: 1000 })
    const restore = measure(buttonAt([300, 300]))
    restore()
    expect(state.scrollTop).toBe(1000)
    expect(document.body.style.paddingBottom).toBe('')
  })

  it('scrolls back when the button moved and there is room below', () => {
    const state = page({ scrollHeight: 3000, clientHeight: 800, scrollTop: 1000 })
    measure(buttonAt([300, 340]))()
    expect(state.scrollTop).toBe(1040)
    expect(document.body.style.paddingBottom).toBe('')
  })

  it('adds room at the end when closing left too little below, then shrinks it as the user scrolls up', () => {
    // The page was 3000 tall, scrolled to 2000; closing made it 2400, so the browser scrolled up
    // to 1600 and the button moved down 400.
    const state = page({ scrollHeight: 2400, clientHeight: 800, scrollTop: 1600 })
    const button = buttonAt([100, 500])
    const restore = measure(button)
    restore()
    expect(document.body.style.paddingBottom).toBe('400px')
    expect(state.scrollTop).toBe(2000)

    state.scrollTop = 1800
    window.dispatchEvent(new Event('scroll'))
    expect(document.body.style.paddingBottom).toBe('200px')

    state.scrollTop = 500
    window.dispatchEvent(new Event('scroll'))
    expect(document.body.style.paddingBottom).toBe('')
  })

  it('does nothing once the button is gone', () => {
    const state = page({ scrollHeight: 3000, clientHeight: 800, scrollTop: 1000 })
    const button = buttonAt([300, 500])
    const restore = measure(button)
    button.remove()
    restore()
    expect(state.scrollTop).toBe(1000)
  })
})
