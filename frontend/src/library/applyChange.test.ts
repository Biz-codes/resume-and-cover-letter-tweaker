import { describe, expect, it } from 'vitest'
import type { Use } from '../shared/api/usage'
import { changeNote, inProgressUses } from './applyChange'

const use = (id: number, locked = false): Use => ({ kind: 'resume', id, name: `Resume ${id}`, locked })

describe('changeNote', () => {
  it('says whether saving from a resume adds a new version to the library or changes the item', () => {
    // Used only here: the item itself changes.
    let uses = inProgressUses([use(1)], { kind: 'resume', id: 1 })
    expect(uses.elsewhere).toBe(false)
    expect(changeNote(uses.here, uses.others, 'resume', undefined, uses.elsewhere)).toBe(
      'Saving changes it in your library and in this resume.',
    )
    // Also used by a sent one: a new version, and the note for the sent one says so first.
    uses = inProgressUses([use(1), use(2, true)], { kind: 'resume', id: 1 })
    expect(uses.elsewhere).toBe(true)
    expect(changeNote(uses.here, uses.others, 'resume', 'A sent version keeps this one.', uses.elsewhere)).toBe(
      'A sent version keeps this one. The new one goes in your library, used in this resume only.',
    )
    expect(changeNote(uses.here, uses.others, 'cover letter', undefined, uses.elsewhere)).toBe(
      'Saving adds a new version to your library, used in this cover letter only. Other cover letters keep the original.',
    )
    // Others in progress: they're checked below.
    uses = inProgressUses([use(1), use(2)], { kind: 'resume', id: 1 })
    expect(changeNote(uses.here, uses.others, 'resume', undefined, uses.elsewhere)).toBe(
      'Saving changes it in this resume, and in the others you check below.',
    )
  })

  it('from the library, says only the ones checked change', () => {
    const uses = inProgressUses([use(2)], undefined)
    expect(changeNote(uses.here, uses.others, undefined, undefined, uses.elsewhere)).toBe(
      'Saving changes it only in the ones you check below; the rest keep it as it is.',
    )
    expect(changeNote(undefined, [], undefined, undefined, false)).toBeUndefined()
  })
})
