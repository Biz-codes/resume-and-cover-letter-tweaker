// What the library's item views share with each other and with the pages: each kind's fields,
// the labels that tell versions apart (labels.ts), and the locked note for a rename.
import type { EducationFields, Education } from '../../shared/api/education'
import { educationLabel } from '../../shared/api/education'
import { experienceLabel, type Experience, type ExperienceFields } from '../../shared/api/experience'
import type { Header, HeaderFields } from '../../shared/api/headers'
import { distinctLabels } from '../../shared/api/labels'
import { projectLabel, type Project, type ProjectFields } from '../../shared/api/projects'
import type { Field } from '../../shared/components/FieldsForm'

export const ROLE_FIELDS: Field<ExperienceFields>[] = [
  { name: 'role_title', label: 'Title', required: true },
  { name: 'organization', label: 'Organization', required: true },
  { name: 'location', label: 'Location' },
  { name: 'dates', label: 'Dates (as printed, e.g. Jan 2020 – Present)' },
]

// The full label of each role, telling versions apart (labels.ts), for its dialog and buttons.
export const roleLabels = (roles: Experience[]) => distinctLabels(roles, experienceLabel, (item) => item.created_at)

export const PROJECT_FIELDS: Field<ProjectFields>[] = [
  { name: 'project_title', label: 'Project title', required: true },
  {
    name: 'done_for',
    label: 'Affiliation (e.g. McGraw Hill, Freelance, Independent project)',
  },
  { name: 'url', label: 'Link', type: 'url' },
  { name: 'dates', label: 'Dates (as printed, e.g. Spring 2024)' },
]

// The full label of each project, telling versions apart (labels.ts).
export const projectLabels = (projects: Project[]) => distinctLabels(projects, projectLabel, (item) => item.created_at)

export const EDUCATION_FIELDS: Field<EducationFields>[] = [
  { name: 'degree', label: 'Degree and field of study (e.g. B.A. in English)', required: true },
  { name: 'institution', label: 'School or institution', required: true },
  { name: 'graduation', label: 'Graduation and honors (as printed, e.g. May 2015, magna cum laude)' },
  { name: 'details', label: 'Details', multiline: true },
]

// The full label of each entry, telling versions apart (labels.ts).
export const educationLabels = (entries: Education[]) =>
  distinctLabels(entries, educationLabel, (item) => item.created_at)

export interface ExcerptFields {
  content: string
}

export const EXCERPT_FIELDS: Field<ExcerptFields>[] = [
  { name: 'content', label: 'Narrative content text', required: true, multiline: true },
]

// Names a header; several headers can share a name, so versions are told apart (labels.ts).
const headerName = (header: Header) => (header.headline ? `${header.full_name}, ${header.headline}` : header.full_name)
export const headerLabels = (headers: Header[]) => distinctLabels(headers, headerName, (item) => item.created_at)

// autoComplete lets browsers fill in the user's own details (WCAG 1.3.5).
export const HEADER_FIELDS: { name: keyof HeaderFields; label: string; type?: string; autoComplete?: string }[] = [
  { name: 'full_name', label: 'Full name (required)', autoComplete: 'name' },
  { name: 'headline', label: 'Headline', autoComplete: 'organization-title' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { name: 'location', label: 'Location' },
  { name: 'linkedin_url', label: 'LinkedIn URL', autoComplete: 'url' },
  { name: 'github_url', label: 'GitHub URL', autoComplete: 'url' },
  { name: 'portfolio_url', label: 'Portfolio URL', autoComplete: 'url' },
]

export const EMPTY_HEADER: HeaderFields = {
  full_name: '',
  headline: null,
  email: null,
  phone: null,
  location: null,
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
}

export const lockedNote = (what: string) =>
  `A sent version uses this ${what}, so the new name is saved as a new ${what}. The sent version keeps the old one.`
