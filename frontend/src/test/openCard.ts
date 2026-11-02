import { fireEvent, screen, within } from '@testing-library/react'

// A library card (LibraryCard), found by its title, for tests that check what it shows.
export async function findCard(name: string | RegExp) {
  return (await screen.findByRole('heading', { name })).closest('article') as HTMLElement
}

// A library item's dialog (ItemDialog), opened with its card's Edit button, for tests that
// check what's inside it.
export async function openItem(name: string | RegExp) {
  fireEvent.click(within(await findCard(name)).getByRole('button', { name: /^Edit/ }))
  return screen.getByRole('dialog')
}
