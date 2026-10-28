import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import UsedBy from './UsedBy'

describe('UsedBy', () => {
  it('lists each use, tagging sent versions in text', async () => {
    render(
      <UsedBy
        uses={[
          { kind: 'resume', id: 1, name: 'Tech base', locked: false },
          { kind: 'cover_letter', id: 2, name: 'Acme letter', locked: true },
        ]}
      />,
    )
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Resume: Tech base',
      'Cover letter: Acme lettersent',
    ])
    await expectNoA11yViolations()
  })

  it('says when nothing uses it', async () => {
    render(<UsedBy uses={[]} />)
    expect(screen.getByText('Not used yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
