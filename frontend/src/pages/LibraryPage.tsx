// The library mode: a sub-nav for its pages (LibraryLayout) and a landing page that says what
// each one holds (LibraryHome). Each library table's page is a child route of /library.
import { useId } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { PAGE_HEADING_ID } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

export const LIBRARY_PAGES = [
  { path: 'headers', name: 'Headers', description: 'Your name, headline, and contact details.' },
  { path: 'sections', name: 'Sections', description: 'Resume headings and cover letter topics, and what each lists.' },
  {
    path: 'narrative-content',
    name: 'Narrative content',
    description: 'Sentences and paragraphs that summaries and cover letter paragraphs are built from.',
  },
  { path: 'skills', name: 'Skills', description: 'Skill categories and the skills in each.' },
  { path: 'experience', name: 'Experience', description: 'Roles (paid, volunteer, or other) and their bullets.' },
  { path: 'projects', name: 'Projects', description: 'Projects, with their skills and bullets.' },
  { path: 'bullets', name: 'Bullet points', description: 'Every bullet, and where each is listed.' },
  { path: 'education', name: 'Education', description: 'Degrees, certificates, and other schooling.' },
  { path: 'sign-offs', name: 'Sign-offs', description: 'Closings for cover letters, like "Sincerely".' },
  { path: 'writing-rules', name: 'Writing rules', description: 'Filler words and patterns kept out of every suggestion.' },
  { path: 'tone-sets', name: 'Tone sets', description: 'Word choice and style rules for different kinds of jobs.' },
]

export function LibraryLayout() {
  return (
    <>
      <nav aria-label="Library" className="subnav">
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
