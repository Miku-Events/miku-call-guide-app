export type E2EAudience = 'desktop' | 'mobile' | 'both'

export interface E2EScenario {
  id: string
  audience: E2EAudience
}

const numbered = (prefix: string, count: number, audience: E2EAudience): E2EScenario[] => (
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    audience,
  }))
)

export const E2E_SCENARIOS: readonly E2EScenario[] = Object.freeze([
  ...numbered('CAT-D', 4, 'desktop'),
  ...numbered('CAT-M', 2, 'mobile'),
  ...numbered('EVT-D', 1, 'desktop'),
  ...numbered('EVT-M', 2, 'mobile'),
  ...numbered('PLY-D', 9, 'desktop'),
  ...numbered('PLY-M', 5, 'mobile'),
  ...numbered('A11-D', 7, 'desktop'),
  ...numbered('A11-M', 2, 'mobile'),
  { id: 'A11-B-01', audience: 'both' },
  ...numbered('SPO-D', 4, 'desktop'),
  ...numbered('SPO-M', 1, 'mobile'),
])
