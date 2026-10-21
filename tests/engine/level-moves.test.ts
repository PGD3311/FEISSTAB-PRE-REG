import { describe, it, expect } from 'vitest'
import { levelMoves, ordinal, type DancerResult } from '@/lib/engine/level-moves'
import type { Level } from '@/lib/types/feis-listing'

const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 }
]

function result(overrides: Partial<DancerResult> = {}): DancerResult {
  return {
    dancerId: 'aoife',
    feisName: 'Newport Feis',
    feisDate: '2026-11-07',
    competitionType: 'solo',
    danceKey: 'reel',
    danceLabel: 'Reel',
    levelKey: 'NOV',
    place: 1,
    dancersInCompetition: 8,
    ...overrides
  }
}

const novice = { aoife: { reel: 'NOV', slip_jig: 'NOV' } }

describe('levelMoves', () => {
  it('moves a Novice who won 1st up to Prizewinner in that dance only', () => {
    const moves = levelMoves([result()], novice, LEVELS)
    expect(moves).toEqual([
      {
        dancerId: 'aoife',
        danceKey: 'reel',
        danceLabel: 'Reel',
        fromLevel: 'NOV',
        toLevel: 'PW',
        because: {
          feisName: 'Newport Feis',
          feisDate: '2026-11-07',
          levelKey: 'NOV',
          place: 1,
          dancersInCompetition: 8
        }
      }
    ])
  })

  it('does not move a Novice who came 2nd', () => {
    expect(levelMoves([result({ place: 2 })], novice, LEVELS)).toEqual([])
  })

  it.each([1, 2, 3])('moves an Advanced Beginner who came %i up to Novice', (place) => {
    const moves = levelMoves(
      [result({ levelKey: 'AB', place })],
      { aoife: { reel: 'AB' } },
      LEVELS
    )
    expect(moves.map((m) => m.toLevel)).toEqual(['NOV'])
  })

  it('does not move an Advanced Beginner who came 4th', () => {
    const moves = levelMoves(
      [result({ levelKey: 'AB', place: 4 })],
      { aoife: { reel: 'AB' } },
      LEVELS
    )
    expect(moves).toEqual([])
  })

  it('ignores a win with fewer than 5 dancers (MAR §2.17)', () => {
    expect(levelMoves([result({ dancersInCompetition: 4 })], novice, LEVELS)).toEqual([])
    expect(levelMoves([result({ dancersInCompetition: 5 })], novice, LEVELS)).toHaveLength(1)
  })

  it('suggests nothing once the dancer is already at the new level', () => {
    expect(levelMoves([result()], { aoife: { reel: 'PW' } }, LEVELS)).toEqual([])
  })

  it('suggests a move for a dance with no level set yet', () => {
    const moves = levelMoves([result()], {}, LEVELS)
    expect(moves[0]).toMatchObject({ fromLevel: null, toLevel: 'PW' })
  })

  it('ignores championships, specials, Beginner and Prizewinner results', () => {
    const moves = levelMoves(
      [
        result({ competitionType: 'championship' }),
        result({ competitionType: 'special' }),
        result({ levelKey: 'BG' }),
        result({ levelKey: 'PW' })
      ],
      novice,
      LEVELS
    )
    expect(moves).toEqual([])
  })

  it('keeps the highest level earned when two results apply to one dance', () => {
    const moves = levelMoves(
      [
        result({ levelKey: 'AB', place: 2, feisDate: '2026-12-01' }),
        result({ levelKey: 'NOV', place: 1, feisDate: '2026-11-01' })
      ],
      { aoife: { reel: 'AB' } },
      LEVELS
    )
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ toLevel: 'PW', fromLevel: 'AB' })
  })

  it('cites the most recent result when two earn the same level', () => {
    const moves = levelMoves(
      [
        result({ feisName: 'Older Feis', feisDate: '2026-10-01' }),
        result({ feisName: 'Newer Feis', feisDate: '2026-12-01' })
      ],
      novice,
      LEVELS
    )
    expect(moves).toHaveLength(1)
    expect(moves[0].because.feisName).toBe('Newer Feis')
  })

  it('keeps each dancer and dance separate', () => {
    const moves = levelMoves(
      [
        result(),
        result({ danceKey: 'slip_jig', danceLabel: 'Slip Jig' }),
        result({ dancerId: 'niamh' })
      ],
      { ...novice, niamh: { reel: 'NOV' } },
      LEVELS
    )
    expect(moves.map((m) => `${m.dancerId}:${m.danceKey}`).sort()).toEqual([
      'aoife:reel',
      'aoife:slip_jig',
      'niamh:reel'
    ])
  })
})

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd']
  ])('%i → %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected)
  })
})
