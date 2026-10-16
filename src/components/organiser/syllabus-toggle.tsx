'use client'

import { useMemo } from 'react'

import type { TemplateData, SyllabusSelection } from '@/lib/types/feis-listing'
import { expandSyllabus } from '@/lib/engine/syllabus-expander'

interface SyllabusToggleProps {
  templateData: TemplateData
  selection: SyllabusSelection
  onChange: (selection: SyllabusSelection) => void
}

export function SyllabusToggle({ templateData, selection, onChange }: SyllabusToggleProps) {
  const expanded = useMemo(() => expandSyllabus(templateData, selection), [templateData, selection])

  const soloCount = expanded.filter((c) => c.competition_type === 'solo').length
  const champCount = expanded.filter((c) => c.competition_type === 'championship').length
  const specialCount = expanded.filter((c) => c.competition_type === 'special').length
  const totalCount = expanded.length

  // Helpers to toggle arrays
  function toggleInArray(arr: string[], key: string): string[] {
    return arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]
  }

  function setAllKeys(keys: string[]): string[] {
    return [...keys]
  }

  // Dances per level. No level_dances means every level gets every dance.
  const enabledLevels = templateData.levels.filter((l) => selection.enabled_levels.includes(l.key))
  const enabledDances = templateData.dances.filter((d) => selection.enabled_dances.includes(d.key))

  function levelOffersDance(levelKey: string, danceKey: string): boolean {
    return !selection.level_dances || (selection.level_dances[levelKey] ?? []).includes(danceKey)
  }

  function toggleLevelDance(levelKey: string, danceKey: string) {
    const current =
      selection.level_dances ??
      Object.fromEntries(
        templateData.levels.map((l) => [l.key, templateData.dances.map((d) => d.key)])
      )
    const dances = current[levelKey] ?? []
    onChange({
      ...selection,
      level_dances: {
        ...current,
        [levelKey]: dances.includes(danceKey)
          ? dances.filter((k) => k !== danceKey)
          : [...dances, danceKey]
      }
    })
  }

  // Age group toggles
  function toggleAgeGroup(key: string) {
    onChange({
      ...selection,
      enabled_age_groups: toggleInArray(selection.enabled_age_groups, key)
    })
  }

  function selectAllAgeGroups() {
    onChange({
      ...selection,
      enabled_age_groups: setAllKeys(templateData.age_groups.map((a) => a.key))
    })
  }

  function clearAllAgeGroups() {
    onChange({ ...selection, enabled_age_groups: [] })
  }

  // Level toggles
  function toggleLevel(key: string) {
    onChange({
      ...selection,
      enabled_levels: toggleInArray(selection.enabled_levels, key)
    })
  }

  function selectAllLevels() {
    onChange({
      ...selection,
      enabled_levels: setAllKeys(templateData.levels.map((l) => l.key))
    })
  }

  function clearAllLevels() {
    onChange({ ...selection, enabled_levels: [] })
  }

  // Dance toggles
  function toggleDance(key: string) {
    onChange({
      ...selection,
      enabled_dances: toggleInArray(selection.enabled_dances, key)
    })
  }

  function selectAllDances() {
    onChange({
      ...selection,
      enabled_dances: setAllKeys(templateData.dances.map((d) => d.key))
    })
  }

  function clearAllDances() {
    onChange({ ...selection, enabled_dances: [] })
  }

  // Championship toggles
  function togglePrelim() {
    onChange({ ...selection, enable_prelim: !selection.enable_prelim })
  }

  function toggleOpen() {
    onChange({ ...selection, enable_open: !selection.enable_open })
  }

  function togglePrelimAgeGroup(key: string) {
    onChange({
      ...selection,
      prelim_age_groups: toggleInArray(selection.prelim_age_groups, key)
    })
  }

  function toggleOpenAgeGroup(key: string) {
    onChange({
      ...selection,
      open_age_groups: toggleInArray(selection.open_age_groups, key)
    })
  }

  // Special toggles
  function toggleSpecial(key: string) {
    onChange({
      ...selection,
      enable_specials: toggleInArray(selection.enable_specials, key)
    })
  }

  const hasChampionships = templateData.championship_types.length > 0
  const hasSpecials = templateData.specials.length > 0

  const prelimCount = expanded.filter((c) => c.championship_key === 'prelim').length
  const openCount = expanded.filter((c) => c.championship_key === 'open').length

  return (
    <div className="space-y-8">
      {/* Live preview count */}
      <div
        aria-live="polite"
        className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-y-[1.5px] border-[var(--color-feis-charcoal)] py-3"
      >
        <p className="flex items-baseline gap-2">
          <span className="feis-card-number text-[44px] text-[var(--color-feis-green)]">
            {totalCount}
          </span>
          <span className="text-[15px] font-bold">
            {totalCount === 1 ? 'competition' : 'competitions'}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {[
            `${soloCount} solo`,
            champCount > 0 && `${champCount} championship`,
            specialCount > 0 && `${specialCount} special`
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
      </div>

      {/* Age groups, levels and dances */}
      <div className="feis-entry-form">
        <TickSection
          title="Age groups"
          onSelectAll={selectAllAgeGroups}
          onClearAll={clearAllAgeGroups}
          first
        >
          <TickGrid narrow>
            {templateData.age_groups.map((ag) => (
              <TickItem
                key={ag.key}
                label={ag.key}
                narrow
                checked={selection.enabled_age_groups.includes(ag.key)}
                onToggle={() => toggleAgeGroup(ag.key)}
              />
            ))}
          </TickGrid>
        </TickSection>

        <TickSection title="Levels" onSelectAll={selectAllLevels} onClearAll={clearAllLevels}>
          <TickGrid>
            {templateData.levels.map((level) => (
              <TickItem
                key={level.key}
                label={level.label}
                checked={selection.enabled_levels.includes(level.key)}
                onToggle={() => toggleLevel(level.key)}
              />
            ))}
          </TickGrid>
        </TickSection>

        <TickSection title="Dances" onSelectAll={selectAllDances} onClearAll={clearAllDances}>
          <TickGrid>
            {templateData.dances.map((dance) => (
              <TickItem
                key={dance.key}
                label={dance.label}
                checked={selection.enabled_dances.includes(dance.key)}
                onToggle={() => toggleDance(dance.key)}
              />
            ))}
          </TickGrid>
        </TickSection>
      </div>

      {/* Dances per level */}
      {selection.enabled_levels.length > 0 && selection.enabled_dances.length > 0 && (
        <section>
          <h3 className="text-base font-extrabold [font-stretch:80%]">Dances per level</h3>
          <p className="mt-0.5 mb-2 text-sm text-muted-foreground">
            Untick a dance a level doesn&apos;t offer, for example no treble jig for Beginners.
          </p>
          <div className="feis-entry-form overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="feis-thead">
                <tr>
                  <th className="text-left">Level</th>
                  {enabledDances.map((dance) => (
                    <th key={dance.key} className="px-2 text-center whitespace-nowrap">
                      {dance.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="feis-tbody">
                {enabledLevels.map((level) => (
                  <tr key={level.key}>
                    <td className="px-4 py-2 font-semibold whitespace-nowrap">{level.label}</td>
                    {enabledDances.map((dance) => (
                      <td key={dance.key} className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={`${level.label} ${dance.label}`}
                          checked={levelOffersDance(level.key, dance.key)}
                          onChange={() => toggleLevelDance(level.key, dance.key)}
                          className="feis-tick mx-auto"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Championships */}
      {hasChampionships && (
        <section>
          <h3 className="mb-2 text-base font-extrabold [font-stretch:80%]">Championships</h3>
          <div className="feis-entry-form">
            {templateData.championship_types.some((c) => c.key === 'prelim') && (
              <ChampionshipSection
                label="Preliminary championship"
                enabled={selection.enable_prelim}
                onToggle={togglePrelim}
                ageGroups={templateData.age_groups}
                selectedAgeGroups={selection.prelim_age_groups}
                enabledAgeGroups={selection.enabled_age_groups}
                onToggleAgeGroup={togglePrelimAgeGroup}
              />
            )}
            {templateData.championship_types.some((c) => c.key === 'open') && (
              <ChampionshipSection
                label="Open championship"
                enabled={selection.enable_open}
                onToggle={toggleOpen}
                ageGroups={templateData.age_groups}
                selectedAgeGroups={selection.open_age_groups}
                enabledAgeGroups={selection.enabled_age_groups}
                onToggleAgeGroup={toggleOpenAgeGroup}
              />
            )}
          </div>
        </section>
      )}

      {/* Specials */}
      {hasSpecials && (
        <section>
          <h3 className="mb-2 text-base font-extrabold [font-stretch:80%]">Specials</h3>
          <div className="feis-entry-form">
            {templateData.specials.map((special, i) => {
              const checked = selection.enable_specials.includes(special.key)
              return (
                <label
                  key={special.key}
                  className={`flex cursor-pointer items-center gap-2.5 px-4 py-2 text-sm focus-within:outline-3 focus-within:-outline-offset-3 focus-within:outline-[var(--color-feis-gold)] ${
                    i > 0 ? 'border-t border-[#E2DCCD]' : ''
                  } ${checked ? 'bg-[var(--color-feis-green-light)]' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="feis-tick shrink-0"
                    checked={checked}
                    onChange={() => toggleSpecial(special.key)}
                  />
                  {special.label}
                </label>
              )
            })}
          </div>
        </section>
      )}

      {/* Summary breakdown */}
      {totalCount > 0 && (
        <section>
          <h3 className="mb-2 text-base font-extrabold [font-stretch:80%]">Summary</h3>
          <dl className="grid grid-cols-2 border-y-[1.5px] border-[var(--color-feis-charcoal)] sm:grid-cols-4">
            <SummaryItem label="Solo" count={soloCount} />
            <SummaryItem label="Prelim championship" count={champCount > 0 ? prelimCount : 0} />
            <SummaryItem label="Open championship" count={champCount > 0 ? openCount : 0} />
            <SummaryItem label="Special" count={specialCount} />
          </dl>
        </section>
      )}
    </div>
  )
}

// ─── Sub-components ───

function TickSection({
  title,
  onSelectAll,
  onClearAll,
  first = false,
  children
}: {
  title: string
  onSelectAll: () => void
  onClearAll: () => void
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <fieldset className={first ? '' : 'border-t-[1.5px] border-[var(--color-feis-charcoal)]'}>
      <legend className="float-left px-4 pt-3 pb-2 text-base font-extrabold [font-stretch:80%]">
        {title}
      </legend>
      <span className="float-right flex gap-4 px-4 pt-3.5 pb-2 text-sm">
        <button
          type="button"
          onClick={onSelectAll}
          className="font-semibold text-[var(--color-feis-green)] underline underline-offset-2"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={onClearAll}
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Clear
        </button>
      </span>
      <div className="clear-both">{children}</div>
    </fieldset>
  )
}

function TickGrid({ narrow = false, children }: { narrow?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid border-t border-[#E2DCCD] px-2 py-2 ${
        narrow
          ? 'grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]'
          : 'grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]'
      }`}
    >
      {children}
    </div>
  )
}

function TickItem({
  label,
  checked,
  onToggle,
  narrow = false
}: {
  label: string
  checked: boolean
  onToggle: () => void
  narrow?: boolean
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1.5 focus-within:outline-3 focus-within:outline-[var(--color-feis-gold)] ${
        checked ? 'bg-[var(--color-feis-green-light)]' : ''
      }`}
    >
      <input type="checkbox" className="feis-tick shrink-0" checked={checked} onChange={onToggle} />
      <span className={narrow ? 'feis-narrow text-[17px]' : 'text-sm'}>{label}</span>
    </label>
  )
}

function ChampionshipSection({
  label,
  enabled,
  onToggle,
  ageGroups,
  selectedAgeGroups,
  enabledAgeGroups,
  onToggleAgeGroup
}: {
  label: string
  enabled: boolean
  onToggle: () => void
  ageGroups: { key: string; label: string }[]
  selectedAgeGroups: string[]
  enabledAgeGroups: string[]
  onToggleAgeGroup: (key: string) => void
}) {
  // Only show age groups that are enabled in the main age group selector
  const availableAgeGroups = ageGroups.filter((ag) => enabledAgeGroups.includes(ag.key))

  return (
    <div className="border-t-[1.5px] border-[var(--color-feis-charcoal)] first:border-t-0">
      <label
        className={`flex cursor-pointer items-center gap-2.5 px-4 py-2.5 focus-within:outline-3 focus-within:-outline-offset-3 focus-within:outline-[var(--color-feis-gold)] ${
          enabled ? 'bg-[var(--color-feis-green-light)]' : ''
        }`}
      >
        <input type="checkbox" checked={enabled} onChange={onToggle} className="feis-tick" />
        <span className="text-sm font-bold">{label}</span>
      </label>
      {enabled && availableAgeGroups.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] border-t border-[#E2DCCD] py-2 pr-2 pl-8">
          {availableAgeGroups.map((ag) => (
            <TickItem
              key={ag.key}
              label={ag.key}
              narrow
              checked={selectedAgeGroups.includes(ag.key)}
              onToggle={() => onToggleAgeGroup(ag.key)}
            />
          ))}
        </div>
      )}
      {enabled && availableAgeGroups.length === 0 && (
        <p className="border-t border-[#E2DCCD] py-2 pr-4 pl-11 text-sm text-muted-foreground">
          Tick some age groups above first.
        </p>
      )}
    </div>
  )
}

function SummaryItem({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex flex-col-reverse px-1 py-3">
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
      <dd className="feis-narrow text-[28px] leading-none">{count}</dd>
    </div>
  )
}
