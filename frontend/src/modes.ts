// The app's modes: browsing the library, and building job postings, resumes, and cover letters
// from it (docs/APP_FLOW.md, "Modes"). The nav and the Home page both list them.
export interface Mode {
  path: string
  name: string
  // What Home offers to do there.
  action: string
  description: string
  // Not built yet: its page says which phase brings it.
  comingIn?: string
}

export const MODES: Mode[] = [
  {
    path: '/library',
    name: 'Library',
    action: 'Browse your library',
    description:
      'Everything a resume or cover letter can draw from: headers, narrative content, skills, roles, projects, bullets, education, sign-offs, and the rules for writing them.',
  },
  {
    path: '/postings',
    name: 'Job postings',
    action: 'Create a job posting',
    description: 'Save a posting to tailor a resume and cover letter to, and track the application.',
    comingIn: 'phase 4',
  },
  {
    path: '/resumes',
    name: 'Resumes',
    action: 'Create a resume',
    description: 'Build a resume from your library, as a base version or for a posting.',
  },
  {
    path: '/cover-letters',
    name: 'Cover letters',
    action: 'Create a cover letter',
    description: 'Build a cover letter from your library, as a base version or for a posting.',
  },
]
