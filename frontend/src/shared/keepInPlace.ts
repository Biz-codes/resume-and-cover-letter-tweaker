// Keeps the button that opened or closed a level (Disclosure, OrderedList's rows, Collapsible)
// where it was on the screen. Closing a level near the end of the page (or of a dialog that
// scrolls) leaves too little below it to fill the screen, so the browser scrolls up and the button
// just clicked jumps down. `measure` notes where the button is before the change; the function it
// returns, called once the change has rendered, scrolls it back, adding room at the end of its
// scroll container when there isn't enough. That room shrinks as the user scrolls up and is gone
// once nothing needs it, so they never see more of it than the closing made.

import { useCallback, useLayoutEffect, useRef } from 'react'

// For a component whose button opens and closes a level through its own state: call `hold` with
// the button just before the change; it's put back once React has rendered it.
export function useKeepInPlace() {
  const pending = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const restore = pending.current
    pending.current = null
    restore?.()
  })
  return useCallback((element: HTMLElement) => {
    pending.current = measure(element)
  }, [])
}

interface Room {
  // The element's own inline padding, put back when the room goes.
  inline: string
  // Its bottom padding before any room was added, in pixels.
  base: number
  // The room added.
  extra: number
  release: () => void
}

const rooms = new Map<HTMLElement, Room>()

function scrollerOf(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

function addRoom(scroller: HTMLElement, more: number) {
  const page = scroller === document.scrollingElement || scroller === document.documentElement
  // The page's room goes on the body; a dialog's on the element that scrolls.
  const padded = page ? document.body : scroller
  let room = rooms.get(padded)
  if (!room) {
    const target: EventTarget = page ? window : scroller
    // Shrinks the room to what keeps the bottom of the screen on the page, never growing it.
    const fit = () => {
      const current = rooms.get(padded)
      if (!current) return
      const content = scroller.scrollHeight - current.extra
      const needed = Math.min(current.extra, Math.max(0, Math.ceil(scroller.scrollTop + scroller.clientHeight - content)))
      if (needed === current.extra) return
      if (needed === 0) {
        padded.style.paddingBottom = current.inline
        current.release()
        rooms.delete(padded)
        return
      }
      current.extra = needed
      padded.style.paddingBottom = `${current.base + needed}px`
    }
    target.addEventListener('scroll', fit, { passive: true })
    room = {
      inline: padded.style.paddingBottom,
      base: parseFloat(getComputedStyle(padded).paddingBottom) || 0,
      extra: 0,
      release: () => target.removeEventListener('scroll', fit),
    }
    rooms.set(padded, room)
  }
  room.extra += more
  padded.style.paddingBottom = `${room.base + room.extra}px`
}

export function measure(element: HTMLElement) {
  const before = element.getBoundingClientRect().top
  return () => {
    if (!element.isConnected) return
    const moved = element.getBoundingClientRect().top - before
    if (Math.abs(moved) < 1) return
    const scroller = scrollerOf(element)
    // Moved down: the browser scrolled up for want of room below, so add that room first.
    const short = Math.ceil(scroller.scrollTop + moved + scroller.clientHeight - scroller.scrollHeight)
    if (moved > 0 && short > 0) addRoom(scroller, short)
    scroller.scrollTop += moved
  }
}
