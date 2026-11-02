// The library mode: a sub-nav for its pages (LibraryLayout) and a landing page that says what
// each one holds (LibraryHome), both from LIBRARY_PAGES (libraryPages.ts). Each library table's
// page is a child route of /library.
import { useId } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { PAGE_HEADING_ID } from '../../shared/hooks/useFocusLater'
import { usePageTitle } from '../../shared/hooks/usePageTitle'
import { LIBRARY_PAGES } from '../libraryPages'
import styles from './LibraryPage.module.css'

export function LibraryLayout() {
  return (
    <>
      <nav aria-label="Library" className={styles.subnav}>
        {LIBRARY_PAGES.map((page) => (
          <NavLink key={page.path} to={`/library/${page.path}`}>
            {page.name}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}

export function LibraryHome() {
  usePageTitle('Library')
  const id = useId()
  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Library
      </h2>
      <p className="muted">
        Everything a resume or cover letter can draw from. Each item is stored once and reused, so
        every new application builds on your best earlier work.
      </p>
      <ul className="choices">
        {LIBRARY_PAGES.map((page) => (
          <li key={page.path}>
            <Link to={`/library/${page.path}`} aria-describedby={`${id}-${page.path}`}>
              {page.name}
            </Link>
            <p className="muted" id={`${id}-${page.path}`}>
              {page.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
