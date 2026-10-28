// The app shell: the header with the main nav (one link per mode, src/modes.ts), and one route
// per page inside <main>. Library pages are child routes of /library, under its own sub-nav.
// main.tsx provides the router.
import { NavLink, Route, Routes, useLocation } from 'react-router'
import { usePageTitle } from './hooks/usePageTitle'
import BulletsPage from './pages/BulletsPage'
import ExperiencePage from './pages/ExperiencePage'
import HeadersPage from './pages/HeadersPage'
import { MODES } from './modes'
import ComingSoonPage from './pages/ComingSoonPage'
import HomePage from './pages/HomePage'
import { LibraryHome, LibraryLayout } from './pages/LibraryPage'
import ProjectsPage from './pages/ProjectsPage'
import SectionsPage from './pages/SectionsPage'
import SkillsPage from './pages/SkillsPage'

function NotFound() {
  usePageTitle('Page not found')
  return <p>That page doesn't exist.</p>
}

function App() {
  const { pathname } = useLocation()
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
            <Route path="skills" element={<SkillsPage />} />
            <Route path="experience" element={<ExperiencePage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="bullets" element={<BulletsPage />} />
          </Route>
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
