import { describe, expect, it } from 'vitest'
import { addedOn, distinctLabels } from './labels'

const ITEMS = [
  { id: 1, name: 'Tweaker (Freelance)', created_at: '2026-10-30T09:15:02' },
  { id: 2, name: 'tweaker (freelance)', created_at: '2026-10-31T14:05:13' },
  { id: 3, name: 'Lesson planner', created_at: '2026-10-31T14:05:20' },
]

describe('distinctLabels', () => {
  it('adds when it was added only to labels another item shares, ignoring capitals', () => {
    const labelOf = distinctLabels(ITEMS, (item) => item.name, (item) => item.created_at)
    expect(labelOf(ITEMS[0])).toBe(`Tweaker (Freelance), added ${addedOn('2026-10-30T09:15:02')}`)
    expect(labelOf(ITEMS[1])).toBe(`tweaker (freelance), added ${addedOn('2026-10-31T14:05:13')}`)
    expect(labelOf(ITEMS[2])).toBe('Lesson planner')
  })

  it('reads as a date and time, to the second', () => {
    expect(addedOn('2026-10-31T14:05:13')).toBe('Oct 31, 2026, 2:05:13 PM')
  })
})
