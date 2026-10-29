import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WritingRule } from '../api/writingRules'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import WritingRulesPage from './WritingRulesPage'

const LEVERAGE: WritingRule = { writing_rule_id: 1, kind: 'term', rule_text: 'leverage', active: true }
const SYNERGY: WritingRule = { writing_rule_id: 2, kind: 'term', rule_text: 'synergy', active: false }
const THREES: WritingRule = { writing_rule_id: 3, kind: 'pattern', rule_text: 'lists of three for rhythm', active: true }

function stub(extra: Record<string, Reply[]> = {}, rules = [LEVERAGE, SYNERGY, THREES]) {
  return stubApi({
    'GET /api/writing-rules': [
      { status: 200, body: rules },
      { status: 200, body: rules },
    ],
    ...extra,
  })
}

describe('WritingRulesPage', () => {
  it('groups words and phrases apart from patterns, and marks rules that are off', async () => {
    stub()
    render(<WritingRulesPage />)
    expect(document.title).toBe('Writing rules – Resume Tweaker')
    const words = (await screen.findByRole('heading', { name: 'Words and phrases' })).parentElement as HTMLElement
    const patterns = screen.getByRole('heading', { name: 'Patterns' }).parentElement as HTMLElement
    expect(within(words).getAllByRole('listitem')).toHaveLength(2)
    expect(within(patterns).getByText('lists of three for rhythm')).toBeInTheDocument()
    expect(within(words).getByText('off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off "leverage"' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on "synergy"' })).toBeInTheDocument()
    expect(within(patterns).getByLabelText('New pattern').tagName).toBe('TEXTAREA')
    await expectNoA11yViolations()
  })

  it('adds a word, as a term', async () => {
    const fetchMock = stub({
      'POST /api/writing-rules': [{ status: 201, body: { ...LEVERAGE, writing_rule_id: 4, rule_text: 'utilize' } }],
    })
    render(<WritingRulesPage />)
    fireEvent.change(await screen.findByLabelText('New word or phrase'), { target: { value: 'utilize' } })
    fireEvent.click(screen.getByText('Add word or phrase'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "utilize".')
    expect(sentBody(fetchMock, 'POST /api/writing-rules')).toEqual({ kind: 'term', rule_text: 'utilize', active: true })
  })

  it('turns a rule off, keeping focus on its button', async () => {
    const fetchMock = stub({ 'PUT /api/writing-rules/1': [{ status: 200, body: { ...LEVERAGE, active: false } }] })
    render(<WritingRulesPage />)
    const button = await screen.findByRole('button', { name: 'Turn off "leverage"' })
    button.focus()
    fireEvent.click(button)
    expect(await screen.findByRole('status')).toHaveTextContent('Turned off "leverage".')
    expect(sentBody(fetchMock, 'PUT /api/writing-rules/1')).toMatchObject({ active: false })
    expect(button).toHaveFocus()
  })

  it('shows an error when turning a rule off fails', async () => {
    stub({
      'PUT /api/writing-rules/1': [{ status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') }],
    })
    render(<WritingRulesPage />)
    const button = await screen.findByRole('button', { name: 'Turn off "leverage"' })
    fireEvent.click(button)
    const row = button.closest('li') as HTMLElement
    expect(await within(row).findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
  })

  it('edits a rule in place, then returns focus to Edit', async () => {
    const fetchMock = stub({ 'PUT /api/writing-rules/3': [{ status: 200, body: THREES }] })
    render(<WritingRulesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "lists of three for rhythm"' }))
    const field = screen.getByLabelText('Pattern')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'lists of three used for rhythm' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/writing-rules/3')).toMatchObject({ rule_text: 'lists of three used for rhythm' })
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit "lists of three for rhythm"' })).toHaveFocus(),
    )
  })

  it('confirms before deleting a rule', async () => {
    stub({ 'DELETE /api/writing-rules/1': [{ status: 204 }] })
    render(<WritingRulesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "leverage"' }))
    const confirm = screen.getByRole('group', { name: 'Delete "leverage"?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "leverage".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Writing rules' })).toHaveFocus())
  })

  it('returns focus to Delete when the delete is cancelled', async () => {
    stub()
    render(<WritingRulesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "leverage"' }))
    fireEvent.click(screen.getByText('Cancel'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete "leverage"' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<WritingRulesPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stub({
      'GET /api/writing-rules': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [LEVERAGE] },
      ],
    })
    render(<WritingRulesPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByText('leverage')).toBeInTheDocument()
  })

  it('says when a group is empty', async () => {
    stub({}, [])
    render(<WritingRulesPage />)
    expect(await screen.findAllByText('None yet.')).toHaveLength(2)
  })
})
