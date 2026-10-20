import { describe, it, expect } from 'vitest'
import {
  buildCompetitionRow,
  buildDancerRow,
  buildEventRow,
  buildRegistrationRow
} from '@/lib/bridge'

const entry = {
  id: 'entry-1',
  dancer_id: 'dancer-1',
  feis_competition_id: 'comp-1',
  dancer_first_name: 'Aoife',
  dancer_last_name: 'Walsh',
  dancer_date_of_birth: '2016-04-02',
  dancer_school_name: 'Gilmartin School'
}

describe('bridge row mapping', () => {
  it('maps the listing to an event row', () => {
    const row = buildEventRow({
      id: 'l1',
      name: 'Newport Feis',
      feis_date: '2027-03-20',
      end_date: null,
      venue_name: 'Hall',
      venue_address: '1 Main St'
    })
    expect(row).toMatchObject({
      prereg_feis_listing_id: 'l1',
      name: 'Newport Feis',
      start_date: '2027-03-20',
      location: 'Hall — 1 Main St',
      import_status: 'importing'
    })
  })

  it('maps a paid entry to competition, dancer (with school) and registration rows', () => {
    const comp = buildCompetitionRow('ev1', {
      id: 'comp-1',
      display_name: 'U10 Reel',
      display_code: null,
      age_group_key: 'U10',
      age_group_label: 'Under 10',
      level_key: 'novice',
      level_label: null
    })
    expect(comp).toMatchObject({
      event_id: 'ev1',
      prereg_feis_competition_id: 'comp-1',
      code: 'U10 Reel',
      age_group: 'Under 10',
      level: 'novice'
    })

    expect(buildDancerRow(entry)).toEqual({
      prereg_dancer_id: 'dancer-1',
      first_name: 'Aoife',
      last_name: 'Walsh',
      date_of_birth: '2016-04-02',
      school_name: 'Gilmartin School'
    })

    expect(buildRegistrationRow('ev1', entry, 'p1-comp', 'p1-dancer', '214')).toEqual({
      event_id: 'ev1',
      dancer_id: 'p1-dancer',
      competition_id: 'p1-comp',
      status: 'registered',
      competitor_number: '214',
      prereg_registration_entry_id: 'entry-1'
    })
  })
})
