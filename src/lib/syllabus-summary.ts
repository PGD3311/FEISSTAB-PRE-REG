import { levelOf } from '@/lib/entry-stats'
import type { FeisCompetition } from '@/lib/types/feis-listing'

export interface SyllabusLevel {
  label: string
  /** Column heads: the dances for a solo level, none for championships and specials */
  dances: string[]
  /** Row heads in syllabus order: age groups, or competition names when there's no age group */
  rows: string[]
  /** The competition in each cell, keyed `${row}|${dance}` (dance is '' with no columns) */
  cells: Map<string, FeisCompetition>
  /** Age groups in syllabus order, for the "Under 6 to 21 & Over" line */
  ageGroups: string[]
  competitions: FeisCompetition[]
}

function rowOf(comp: FeisCompetition): string {
  if (comp.competition_type === 'solo' || comp.competition_type === 'championship') {
    return comp.age_group_label ?? comp.display_name
  }
  return comp.display_name
}

function columnOf(comp: FeisCompetition): string {
  return comp.competition_type === 'solo' ? (comp.dance_label ?? comp.display_name) : ''
}

/**
 * The syllabus folded into one grid per level (age groups down, dances across), so a parent
 * sees six levels instead of hundreds of rows. `competitions` should be in syllabus order.
 */
export function summariseSyllabus(competitions: FeisCompetition[]): SyllabusLevel[] {
  const levels = new Map<string, SyllabusLevel>()

  for (const comp of competitions) {
    const label = levelOf(comp)
    let level = levels.get(label)
    if (!level) {
      level = { label, dances: [], rows: [], cells: new Map(), ageGroups: [], competitions: [] }
      levels.set(label, level)
    }

    const row = rowOf(comp)
    const column = columnOf(comp)
    if (column && !level.dances.includes(column)) level.dances.push(column)
    if (!level.rows.includes(row)) level.rows.push(row)
    if (comp.age_group_label && !level.ageGroups.includes(comp.age_group_label)) {
      level.ageGroups.push(comp.age_group_label)
    }
    level.cells.set(`${row}|${column}`, comp)
    level.competitions.push(comp)
  }

  return [...levels.values()]
}

/** e.g. "Under 6 to 21 & Over", or the one age group, or null when there are none. */
export function ageRange(ageGroups: string[]): string | null {
  if (ageGroups.length === 0) return null
  if (ageGroups.length === 1) return ageGroups[0]
  return `${ageGroups[0]} to ${ageGroups[ageGroups.length - 1]}`
}
