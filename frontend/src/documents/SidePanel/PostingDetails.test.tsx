import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { errorBody, stubApi, stubPendingApi } from '../../test/stubApi'
import PostingDetails from './PostingDetails'

const POSTING = {
  job_posting_id: 9,
  url: 'https://example.com/jobs/9',
  organization: 'Lincoln High',
  role_title: 'English Teacher',
  description: 'Teach English.\n\n- Grades 9 to 12',
  contacts: 'Ms. Rivera, principal',
}

describe('PostingDetails', () => {
  it('says it is loading', async () => {
    stubPendingApi()
    render(<PostingDetails postingId={9} />)
    expect(screen.getByText('Loading the job posting…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows the posting: its name, link, description, and contacts', async () => {
    stubApi({ 'GET /api/job-postings/9': [{ status: 200, body: POSTING }] })
    render(<PostingDetails postingId={9} />)
    expect(await screen.findByRole('heading', { name: 'English Teacher at Lincoln High' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'The posting (opens in a new tab)' })
    expect(link).toHaveAttribute('href', 'https://example.com/jobs/9')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('heading', { name: 'Job description' })).toBeInTheDocument()
    expect(screen.getByText(/Grades 9 to 12/)).toHaveClass('description')
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument()
    expect(screen.getByText('Ms. Rivera, principal')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows a contact for a job with no posting online, and no contacts notes when there are none', async () => {
    stubApi({ 'GET /api/job-postings/9': [{ status: 200, body: { ...POSTING, url: 'Sam at the front desk', contacts: ' ' } }] })
    render(<PostingDetails postingId={9} />)
    expect(await screen.findByText('Contact: Sam at the front desk')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contacts' })).not.toBeInTheDocument()
  })

  it('offers Retry when it fails to load', async () => {
    stubApi({
      'GET /api/job-postings/9': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: POSTING },
      ],
    })
    render(<PostingDetails postingId={9} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'English Teacher at Lincoln High' })).toBeInTheDocument()
  })
})
