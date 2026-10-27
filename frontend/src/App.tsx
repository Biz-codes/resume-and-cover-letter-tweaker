// The app shell: navigation and one route per page. main.tsx provides the router.
import { NavLink, Route, Routes } from 'react-router'
import HeadersPage from './pages/HeadersPage'
import HomePage from './pages/HomePage'

function App() {
  return (
    <main>
      <h1>Resume and Cover Letter Tweaker</h1>
      <nav aria-label="Main">
        <NavLink to="/" end>
          Home
        </NavLink>
        <span className="nav-group">Library:</span>
        <NavLink to="/library/headers">Headers</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/library/headers" element={<HeadersPage />} />
        <Route path="*" element={<p>That page doesn't exist.</p>} />
      </Routes>
    </main>
  )
}

export default App
