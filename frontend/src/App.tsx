// The app shell: the header with the main nav (one link per mode, src/modes.ts), and one route
// per page inside <main>. Library pages are child routes of /library, under its own sub-nav.
// main.tsx provides the router.
import { useEffect, useRef } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router'
import { PAGE_HEADING_ID } from './hooks/useFocusLater'
import { usePageTitle } from './hooks/usePageTitle'
import BulletsPage from './pages/BulletsPage'
import DocumentRoute from './pages/DocumentPage'
import DocumentsPage from './pages/DocumentsPage'
import EducationPage from './pages/EducationPage'
import ExperiencePage from './pages/ExperiencePage'
import HeadersPage from './pages/HeadersPage'
import { MODES } from './modes'
import ComingSoonPage from './pages/ComingSoonPage'
import HomePage from './pages/HomePage'
import { LibraryHome, LibraryLayout } from './pages/LibraryPage'
import ProjectsPage from './pages/ProjectsPage'
import SectionsPage from './pages/SectionsPage'
import NarrativeContentPage from './pages/NarrativeContentPage'
import SignOffsPage from './pages/SignOffsPage'
import SkillsPage from './pages/SkillsPage'
import ToneSetsPage from './pages/ToneSetsPage'
import WritingRulesPage from './pages/WritingRulesPage'

function NotFound() {
  usePageTitle('Page not found')
  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Page not found
      </h2>
      <p>That page doesn't exist.</p>
    </section>
  )
}

function App() {
  const { pathname } = useLocation()
  const shownPath = useRef(pathname)

  // After moving to another page, focus its heading: the link that was followed may be gone (a
  // choice on Home), and screen readers then read the new page's name. The first page loaded
  // leaves focus where the browser puts it.
  useEffect(() => {
    if (shownPath.current === pathname) return
    shownPath.current = pathname
    document.getElementById(PAGE_HEADING_ID)?.focus()
  }, [pathname])

  return (
    <div className="app">
      <header>
        <h1>Resume and Cover Letter Tweaker</h1>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Home
          </NavLink>
          {MODES.map((mode) => (
            // A mode's link stays marked on its sub-pages, as the current section ("true")
            // rather than the current page.
            <NavLink
              key={mode.path}
              to={mode.path}
              aria-current={pathname === mode.path ? 'page' : 'true'}
            >
              {mode.name}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryLayout />}>
            <Route index element={<LibraryHome />} />
            <Route path="headers" element={<HeadersPage />} />
            <Route path="sections" element={<SectionsPage />} />
            <Route path="narrative-content" element={<NarrativeContentPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="experience" element={<ExperiencePage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="bullets" element={<BulletsPage />} />
            <Route path="education" element={<EducationPage />} />
            <Route path="sign-offs" element={<SignOffsPage />} />
            <Route path="writing-rules" element={<WritingRulesPage />} />
            <Route path="tone-sets" element={<ToneSetsPage />} />
          </Route>
          <Route path="/resumes" element={<DocumentsPage key="resume" kind="resume" />} />
          <Route path="/resumes/:id" element={<DocumentRoute kind="resume" />} />
          <Route path="/cover-letters" element={<DocumentsPage key="cover_letter" kind="cover_letter" />} />
          <Route path="/cover-letters/:id" element={<DocumentRoute kind="cover_letter" />} />
          {MODES.filter((mode) => mode.comingIn).map((mode) => (
            <Route key={mode.path} path={mode.path} element={<ComingSoonPage mode={mode} />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
