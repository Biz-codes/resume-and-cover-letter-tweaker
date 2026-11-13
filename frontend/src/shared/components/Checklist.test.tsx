import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Checklist from './Checklist'

const OPTIONS = [
  { id: 1, name: 'Summary' },
  { id: 6, name: 'Intro' },
  { id: 8, name: 'Outro' },
]

describe('Checklist', () => {
  it('checks the selected options, and keeps the options order when one is checked', () => {
    const onChange = vi.fn()
    render(<Checklist legend="Sections that list it" options={OPTIONS} selected={[8]} onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Sections that list it' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Outro' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Summary' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Summary' }))
    expect(onChange).toHaveBeenCalledWith([1, 8])
  })

  it('unchecks an option', () => {
    const onChange = vi.fn()
    render(<Checklist legend="Sections" options={OPTIONS} selected={[1, 6]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Summary' }))
    expect(onChange).toHaveBeenCalledWith([6])
  })

  it("shows an option's description under it, read with its checkbox", () => {
    render(
      <Checklist
        legend="Sections"
        options={[{ id: 1, name: 'Summary', description: 'Breaks a rule.' }, ...OPTIONS.slice(1)]}
        selected={[]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Summary' })).toHaveAccessibleDescription('Breaks a rule.')
    expect(screen.getByRole('checkbox', { name: 'Intro' })).not.toHaveAttribute('aria-describedby')
  })

  it('says when there are no options', () => {
    render(<Checklist legend="Sections" options={[]} selected={[]} onChange={() => {}} />)
    expect(screen.getByText('None yet.')).toBeInTheDocument()
  })
})
