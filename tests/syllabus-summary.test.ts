import { describe, it, expect } from 'vitest'
import { competitionTypeCounts, joinWithAnd, syllabusOutline } from '@/lib/syllabus-summary'

const solo = (level: string, age: string) => ({
  competition_type: 'solo' as const,
  level_label: level,
  championship_key: null,
  age_group_label: age
})

describe('syllabusOutline', () => {
  it('lists each level once and the age range, in syllabus order', () => {
    expect(
      syllabusOutline([
        solo('Beginner', 'Under 6'),
        solo('Beginner', 'Under 7'),
        solo('Novice', '21 & Over'),
        {
          competition_type: 'championship',
          level_label: null,
          championship_key: 'open',
          age_group_label: 'Under 7'
        }
      ])
    ).toEqual({ levels: ['Beginner', 'Novice', 'Open championship'], ages: 'Under 6 to 21 & Over' })
  })

  it('gives one age group as is, and none as null', () => {
    expect(syllabusOutline([solo('Beginner', 'Under 9')]).ages).toBe('Under 9')
    expect(
      syllabusOutline([
        {
          competition_type: 'special',
          level_label: null,
          championship_key: null,
          age_group_label: null
        }
      ])
    ).toEqual({ levels: ['Specials and other'], ages: null })
  })
})

describe('joinWithAnd', () => {
  it('joins with commas and a final and', () => {
    expect(joinWithAnd([])).toBe('')
    expect(joinWithAnd(['A'])).toBe('A')
    expect(joinWithAnd(['A', 'B'])).toBe('A and B')
    expect(joinWithAnd(['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('competitionTypeCounts', () => {
  it('counts solos, championships and specials (custom ones included)', () => {
    expect(
      competitionTypeCounts([
        { competition_type: 'solo' },
        { competition_type: 'solo' },
        { competition_type: 'championship' },
        { competition_type: 'special' },
        { competition_type: 'custom' }
      ])
    ).toEqual({ total: 5, solos: 2, championships: 1, specials: 2 })
  })

  it('is all zeros for no competitions', () => {
    expect(competitionTypeCounts([])).toEqual({
      total: 0,
      solos: 0,
      championships: 0,
      specials: 0
    })
  })
})
