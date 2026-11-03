import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'

// A library card (LibraryCard), found by its title, for tests that check what it shows.
export async function findCard(name: string | RegExp) {
  return (await screen.findByRole('heading', { name })).closest('article') as HTMLElement
}

// The open dialog, once its item has loaded.
export async function loadedDialog() {
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument())
  return dialog
}

// A library item's dialog (ItemDialogs), opened with its card's View and Edit button, for tests that
// check what's inside it.
export async function openItem(name: string | RegExp) {
  fireEvent.click(within(await findCard(name)).getByRole('button', { name: /^View and Edit/ }))
  return loadedDialog()
}
