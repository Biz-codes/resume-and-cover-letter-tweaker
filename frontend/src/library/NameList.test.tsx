import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NameList from './NameList'

describe('NameList', () => {
  it('lists the names, open, with the count', () => {
    render(<NameList title="Sections that list it" names={['Experience', 'Freelance']} />)
    expect(screen.getByText('Sections that list it (2)')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Experience', 'Freelance'])
  })

  it('says None when empty, closed', () => {
    const { container } = render(<NameList title="Projects" names={[]} />)
    expect(screen.getByText('Projects (0)')).toBeInTheDocument()
    expect(container.querySelector('details')).not.toHaveAttribute('open')
  })
})
