import { levelOf } from '@/lib/entry-stats'
import type { FeisCompetition } from '@/lib/types/feis-listing'

export interface SyllabusOutline {
  /** Levels offered, in syllabus order */
  levels: string[]
  /** e.g. "Under 6 to 21 & Over", or null when no competition has an age group */
  ages: string | null
}

/** What a feis offers in one line, for parents. `competitions` should be in syllabus order. */
export function syllabusOutline(
  competitions: Pick<
    FeisCompetition,
    'competition_type' | 'level_label' | 'championship_key' | 'age_group_label'
  >[]
): SyllabusOutline {
  const levels: string[] = []
  const ageGroups: string[] = []
  for (const comp of competitions) {
    const level = levelOf(comp)
    if (!levels.includes(level)) levels.push(level)
    if (comp.age_group_label && !ageGroups.includes(comp.age_group_label)) {
      ageGroups.push(comp.age_group_label)
    }
  }

  const ages =
    ageGroups.length === 0
      ? null
      : ageGroups.length === 1
        ? ageGroups[0]
        : `${ageGroups[0]} to ${ageGroups[ageGroups.length - 1]}`
  return { levels, ages }
}

/** "A", "A and B", "A, B and C" */
export function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
