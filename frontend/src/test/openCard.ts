import { fireEvent, screen, within } from '@testing-library/react'

// A library card (LibraryCard), found by its title and opened if it's closed, for tests that
// check what's inside it.
export async function openCard(name: string | RegExp) {
  const heading = await screen.findByRole('heading', { name })
  const toggle = within(heading).getByRole('button')
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
  return heading.closest('article') as HTMLElement
}
