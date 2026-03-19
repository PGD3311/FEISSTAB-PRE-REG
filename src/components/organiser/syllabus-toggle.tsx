'use client'

import { useMemo } from 'react'

import type {
  TemplateData,
  SyllabusSelection,
} from '@/lib/types/feis-listing'
import { expandSyllabus } from '@/lib/engine/syllabus-expander'

interface SyllabusToggleProps {
  templateData: TemplateData
  selection: SyllabusSelection
  onChange: (selection: SyllabusSelection) => void
}

export function SyllabusToggle({
  templateData,
  selection,
  onChange,
}: SyllabusToggleProps) {
  const expanded = useMemo(
    () => expandSyllabus(templateData, selection),
    [templateData, selection]
  )

  const soloCount = expanded.filter((c) => c.competition_type === 'solo').length
  const champCount = expanded.filter(
    (c) => c.competition_type === 'championship'
  ).length
  const specialCount = expanded.filter(
    (c) => c.competition_type === 'special'
  ).length
  const totalCount = expanded.length

  // Helpers to toggle arrays
  function toggleInArray(arr: string[], key: string): string[] {
    return arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]
  }

  function setAllKeys(keys: string[]): string[] {
    return [...keys]
  }

  // Age group toggles
  function toggleAgeGroup(key: string) {
    onChange({
      ...selection,
      enabled_age_groups: toggleInArray(selection.enabled_age_groups, key),
    })
  }

  function selectAllAgeGroups() {
    onChange({
      ...selection,
      enabled_age_groups: setAllKeys(
        templateData.age_groups.map((a) => a.key)
      ),
    })
  }

  function clearAllAgeGroups() {
    onChange({ ...selection, enabled_age_groups: [] })
  }

  // Level toggles
  function toggleLevel(key: string) {
    onChange({
      ...selection,
      enabled_levels: toggleInArray(selection.enabled_levels, key),
    })
  }

  function selectAllLevels() {
    onChange({
      ...selection,
      enabled_levels: setAllKeys(templateData.levels.map((l) => l.key)),
    })
  }

  function clearAllLevels() {
    onChange({ ...selection, enabled_levels: [] })
  }

  // Dance toggles
  function toggleDance(key: string) {
    onChange({
      ...selection,
      enabled_dances: toggleInArray(selection.enabled_dances, key),
    })
  }

  function selectAllDances() {
    onChange({
      ...selection,
      enabled_dances: setAllKeys(templateData.dances.map((d) => d.key)),
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
      prelim_age_groups: toggleInArray(selection.prelim_age_groups, key),
    })
  }

  function toggleOpenAgeGroup(key: string) {
    onChange({
      ...selection,
      open_age_groups: toggleInArray(selection.open_age_groups, key),
    })
  }

  // Special toggles
  function toggleSpecial(key: string) {
    onChange({
      ...selection,
      enable_specials: toggleInArray(selection.enable_specials, key),
    })
  }

  const hasChampionships = templateData.championship_types.length > 0
  const hasSpecials = templateData.specials.length > 0

  return (
    <div className="space-y-8">
      {/* Live preview count */}
      <div className="feis-card feis-accent-left px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <span className="feis-stat">{totalCount}</span>
            <span className="ml-2 text-sm text-muted-foreground">
              total competitions
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span>{soloCount} solo</span>
            {champCount > 0 && <span>{champCount} championship</span>}
            {specialCount > 0 && <span>{specialCount} special</span>}
          </div>
        </div>
      </div>

      {/* Age Groups */}
      <ToggleSection
        title="Age Groups"
        onSelectAll={selectAllAgeGroups}
        onClearAll={clearAllAgeGroups}
      >
        <div className="flex flex-wrap gap-2">
          {templateData.age_groups.map((ag) => (
            <ToggleChip
              key={ag.key}
              label={ag.key}
              enabled={selection.enabled_age_groups.includes(ag.key)}
              onClick={() => toggleAgeGroup(ag.key)}
            />
          ))}
        </div>
      </ToggleSection>

      {/* Levels */}
      <ToggleSection
        title="Levels"
        onSelectAll={selectAllLevels}
        onClearAll={clearAllLevels}
      >
        <div className="flex flex-wrap gap-2">
          {templateData.levels.map((level) => (
            <ToggleChip
              key={level.key}
              label={level.label}
              enabled={selection.enabled_levels.includes(level.key)}
              onClick={() => toggleLevel(level.key)}
            />
          ))}
        </div>
      </ToggleSection>

      {/* Dances */}
      <ToggleSection
        title="Dances"
        onSelectAll={selectAllDances}
        onClearAll={clearAllDances}
      >
        <div className="flex flex-wrap gap-2">
          {templateData.dances.map((dance) => (
            <ToggleChip
              key={dance.key}
              label={dance.label}
              enabled={selection.enabled_dances.includes(dance.key)}
              onClick={() => toggleDance(dance.key)}
            />
          ))}
        </div>
      </ToggleSection>

      {/* Championships */}
      {hasChampionships && (
        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Championships
            </h3>
          </div>
          <div className="space-y-4">
            {templateData.championship_types.some(
              (c) => c.key === 'prelim'
            ) && (
              <ChampionshipSection
                label="Preliminary Championship"
                enabled={selection.enable_prelim}
                onToggle={togglePrelim}
                ageGroups={templateData.age_groups}
                selectedAgeGroups={selection.prelim_age_groups}
                enabledAgeGroups={selection.enabled_age_groups}
                onToggleAgeGroup={togglePrelimAgeGroup}
              />
            )}
            {templateData.championship_types.some(
              (c) => c.key === 'open'
            ) && (
              <ChampionshipSection
                label="Open Championship"
                enabled={selection.enable_open}
                onToggle={toggleOpen}
                ageGroups={templateData.age_groups}
                selectedAgeGroups={selection.open_age_groups}
                enabledAgeGroups={selection.enabled_age_groups}
                onToggleAgeGroup={toggleOpenAgeGroup}
              />
            )}
          </div>
        </div>
      )}

      {/* Specials */}
      {hasSpecials && (
        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Specials
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {templateData.specials.map((special) => (
              <ToggleChip
                key={special.key}
                label={special.label}
                enabled={selection.enable_specials.includes(special.key)}
                onClick={() => toggleSpecial(special.key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Summary breakdown */}
      {totalCount > 0 && (
        <div className="feis-card px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Summary
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <SummaryItem label="Solo" count={soloCount} />
            <SummaryItem label="Prelim Champ" count={champCount > 0
              ? expanded.filter((c) => c.championship_key === 'prelim').length
              : 0
            } />
            <SummaryItem label="Open Champ" count={champCount > 0
              ? expanded.filter((c) => c.championship_key === 'open').length
              : 0
            } />
            <SummaryItem label="Special" count={specialCount} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───

function ToggleSection({
  title,
  onSelectAll,
  onClearAll,
  children,
}: {
  title: string
  onSelectAll: () => void
  onClearAll: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <button
          type="button"
          onClick={onSelectAll}
          className="text-xs text-primary hover:underline"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-muted-foreground hover:underline"
        >
          Clear All
        </button>
      </div>
      {children}
    </div>
  )
}

function ToggleChip({
  label,
  enabled,
  onClick,
}: {
  label: string
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        enabled
          ? 'bg-primary text-primary-foreground'
          : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      {label}
    </button>
  )
}

function ChampionshipSection({
  label,
  enabled,
  onToggle,
  ageGroups,
  selectedAgeGroups,
  enabledAgeGroups,
  onToggleAgeGroup,
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
  const availableAgeGroups = ageGroups.filter((ag) =>
    enabledAgeGroups.includes(ag.key)
  )

  return (
    <div className="feis-card px-4 py-3">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <span className="text-sm font-medium">{label}</span>
      </label>
      {enabled && availableAgeGroups.length > 0 && (
        <div className="ml-6 mt-3 flex flex-wrap gap-2">
          {availableAgeGroups.map((ag) => (
            <ToggleChip
              key={ag.key}
              label={ag.key}
              enabled={selectedAgeGroups.includes(ag.key)}
              onClick={() => onToggleAgeGroup(ag.key)}
            />
          ))}
        </div>
      )}
      {enabled && availableAgeGroups.length === 0 && (
        <p className="ml-6 mt-2 text-xs text-muted-foreground">
          Enable age groups above first.
        </p>
      )}
    </div>
  )
}

function SummaryItem({ label, count }: { label: string; count: number }) {
  return (
    <div>
      <div className="font-mono text-lg font-bold text-foreground">{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
