import { describe, expect, it } from 'vitest'
import { sortByName } from './sortByName'

describe('sortByName', () => {
  it('sorts A to Z, ignoring capitals and accents, with numbers in number order', () => {
    expect(sortByName(['step 10', 'Résumé', 'Step 2', 'apple', 'resume b'], (name) => name)).toEqual([
      'apple',
      'Résumé',
      'resume b',
      'Step 2',
      'step 10',
    ])
  })

  it('keeps items with the same name in the order they came in, without changing the list', () => {
    const items = [
      { id: 3, name: 'Engineer' },
      { id: 1, name: 'Analyst' },
      { id: 2, name: 'engineer' },
    ]
    expect(sortByName(items, (item) => item.name).map((item) => item.id)).toEqual([1, 3, 2])
    expect(items.map((item) => item.id)).toEqual([3, 1, 2])
  })
})
