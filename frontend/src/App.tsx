// The app shell: the header with navigation, and one route per page inside <main>.
// main.tsx provides the router.
import { NavLink, Route, Routes } from 'react-router'
import { usePageTitle } from './hooks/usePageTitle'
import BulletsPage from './pages/BulletsPage'
import ExperiencePage from './pages/ExperiencePage'
import HeadersPage from './pages/HeadersPage'
import HomePage from './pages/HomePage'
import ProjectsPage from './pages/ProjectsPage'
import SectionsPage from './pages/SectionsPage'
import SkillsPage from './pages/SkillsPage'

function NotFound() {
  usePageTitle('Page not found')
  return <p>That page doesn't exist.</p>
}

function App() {
  return (
    <div className="app">
      <header>
        <h1>Resume and Cover Letter Tweaker</h1>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Home
          </NavLink>
          <span className="nav-group">Library:</span>
          <NavLink to="/library/headers">Headers</NavLink>
          <NavLink to="/library/sections">Sections</NavLink>
          <NavLink to="/library/skills">Skills</NavLink>
          <NavLink to="/library/experience">Experience</NavLink>
          <NavLink to="/library/projects">Projects</NavLink>
          <NavLink to="/library/bullets">Bullet points</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library/headers" element={<HeadersPage />} />
          <Route path="/library/sections" element={<SectionsPage />} />
          <Route path="/library/skills" element={<SkillsPage />} />
          <Route path="/library/experience" element={<ExperiencePage />} />
          <Route path="/library/projects" element={<ProjectsPage />} />
          <Route path="/library/bullets" element={<BulletsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
