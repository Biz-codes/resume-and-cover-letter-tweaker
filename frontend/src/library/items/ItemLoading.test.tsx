import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { expectNoA11yViolations } from '../../test/axe'
import ItemLoading from './ItemLoading'

describe('ItemLoading', () => {
  it('says it is loading, or that the item is gone', async () => {
    const { rerender } = render(<ItemLoading error={null} missing={false} onRetry={() => {}} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    rerender(<ItemLoading error={null} missing onRetry={() => {}} />)
    expect(screen.getByText("It's no longer in your library.")).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows a failed load with Retry', async () => {
    const onRetry = vi.fn()
    render(<ItemLoading error={new ApiError('INTERNAL_ERROR', 'Something went wrong.', null, 500)} missing={false} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
    await expectNoA11yViolations()
  })
})
