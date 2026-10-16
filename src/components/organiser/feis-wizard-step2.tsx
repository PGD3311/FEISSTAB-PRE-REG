'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import type { TemplateData, SyllabusSelection } from '@/lib/types/feis-listing'
import { useSupabase } from '@/hooks/use-supabase'
import { expandAndSaveSyllabus } from '@/app/organiser/feiseanna/actions'
import { SyllabusToggle } from '@/components/organiser/syllabus-toggle'

interface SyllabusTemplate {
  id: string
  name: string
  description: string | null
  template_data: TemplateData
  is_system: boolean
}

interface FeisWizardStep2Props {
  listingId: string
  existingTemplateId: string | null
  existingSnapshot: TemplateData | null
  existingCompetitionsCount: number
  onNext: () => void
  onBack: () => void
}

/** Build a default "everything enabled" selection from template data. */
function buildDefaultSelection(td: TemplateData): SyllabusSelection {
  return {
    enabled_age_groups: td.age_groups.map((a) => a.key),
    enabled_levels: td.levels.map((l) => l.key),
    enabled_dances: td.dances.map((d) => d.key),
    enable_prelim: td.championship_types.some((c) => c.key === 'prelim'),
    prelim_age_groups: td.championship_types.some((c) => c.key === 'prelim')
      ? td.age_groups.map((a) => a.key)
      : [],
    enable_open: td.championship_types.some((c) => c.key === 'open'),
    open_age_groups: td.championship_types.some((c) => c.key === 'open')
      ? td.age_groups.map((a) => a.key)
      : [],
    enable_specials: td.specials.map((s) => s.key),
    level_dances: td.default_level_dances
  }
}

/** Estimate total competition count from template data (all enabled). */
function estimateCount(td: TemplateData): number {
  const dancesPerAge = td.default_level_dances
    ? Object.values(td.default_level_dances).reduce((sum, dances) => sum + dances.length, 0)
    : td.levels.length * td.dances.length
  const solos = td.age_groups.length * dancesPerAge
  const champs = td.championship_types.length * td.age_groups.length
  const specials = td.specials.length
  return solos + champs + specials
}

export function FeisWizardStep2({
  listingId,
  existingTemplateId,
  existingSnapshot,
  existingCompetitionsCount,
  onNext,
  onBack: _onBack
}: FeisWizardStep2Props) {
  const router = useRouter()
  const supabase = useSupabase()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // When competitions already exist, default to summary view
  const [showReconfigure, setShowReconfigure] = useState(false)

  // Template picker state
  const [templates, setTemplates] = useState<SyllabusTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  // Selected template + editor state — do NOT auto-init selection when competitions exist
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    existingCompetitionsCount > 0 ? null : existingTemplateId
  )
  const [templateData, setTemplateData] = useState<TemplateData | null>(
    existingCompetitionsCount > 0 ? null : existingSnapshot
  )
  const [selection, setSelection] = useState<SyllabusSelection | null>(() => {
    if (existingCompetitionsCount > 0) return null
    if (existingSnapshot && existingTemplateId) {
      return buildDefaultSelection(existingSnapshot)
    }
    return null
  })

  // Fetch templates on mount
  useEffect(() => {
    async function fetchTemplates() {
      const { data, error: fetchError } = await supabase
        .from('syllabus_templates')
        .select('id, name, description, template_data, is_system')
        .eq('is_system', true)
        .order('name')

      if (fetchError) {
        console.error('Failed to fetch templates:', fetchError)
        setError('Failed to load syllabus templates.')
      } else if (data) {
        setTemplates(data as SyllabusTemplate[])
      }
      setLoadingTemplates(false)
    }
    fetchTemplates()
  }, [supabase])

  function handleSelectTemplate(template: SyllabusTemplate) {
    setSelectedTemplateId(template.id)
    setTemplateData(template.template_data)
    setSelection(buildDefaultSelection(template.template_data))
    setError(null)
  }

  function handleChangeTemplate() {
    setSelectedTemplateId(null)
    setTemplateData(null)
    setSelection(null)
    setError(null)
  }

  const handleSelectionChange = useCallback((newSelection: SyllabusSelection) => {
    setSelection(newSelection)
  }, [])

  function handleSave() {
    if (!selectedTemplateId || !templateData || !selection) return

    setError(null)
    startTransition(async () => {
      try {
        const result = await expandAndSaveSyllabus(
          listingId,
          selectedTemplateId,
          templateData,
          selection,
          templateData
        )

        if ('error' in result) {
          setError(result.error as string)
          return
        }

        router.refresh()
        onNext()
      } catch (err) {
        console.error('Failed to save syllabus:', err)
        setError('An unexpected error occurred while saving.')
      }
    })
  }

  const errorPanel = error && (
    <p
      role="alert"
      className="mb-6 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
    >
      {error}
    </p>
  )

  // Loading state
  if (loadingTemplates) {
    return (
      <p
        role="status"
        className="feis-entry-form px-6 py-16 text-center text-sm text-muted-foreground"
      >
        Loading syllabus templates…
      </p>
    )
  }

  // Show summary view when competitions already exist and user hasn't clicked "Reconfigure"
  if (existingCompetitionsCount > 0 && !showReconfigure) {
    return (
      <div className="feis-card max-w-xl px-5 py-5 sm:px-6">
        <h2 className="feis-display text-[22px]">Syllabus is set up</h2>
        <p className="mt-2 text-[15px]">
          This feis has <span className="feis-narrow text-[19px]">{existingCompetitionsCount}</span>{' '}
          competitions.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Choosing a new syllabus replaces all of them.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={onNext} className="feis-btn feis-btn-primary">
            Keep and continue
          </button>
          <button
            type="button"
            onClick={() => setShowReconfigure(true)}
            className="feis-btn feis-btn-outline"
          >
            Choose a new syllabus
          </button>
        </div>
      </div>
    )
  }

  // Show template picker if no template selected yet
  if (!selectedTemplateId || !templateData || !selection) {
    return (
      <div className="max-w-3xl">
        {errorPanel}

        <div className="mb-4">
          <h2 className="feis-display text-[22px]">Choose a syllabus template</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start from a template, then choose which competitions to offer.
          </p>
        </div>

        {templates.length > 0 && (
          <ul className="feis-entry-form">
            {templates.map((template, i) => (
              <li key={template.id} className={i > 0 ? 'border-t border-[#E2DCCD]' : ''}>
                <button
                  type="button"
                  onClick={() => handleSelectTemplate(template)}
                  className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 text-left hover:bg-[var(--color-feis-green-light)] focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-[var(--color-feis-gold)]"
                >
                  <span className="min-w-0">
                    <span className="block font-bold">{template.name}</span>
                    {template.description && (
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {template.description}
                      </span>
                    )}
                  </span>
                  <span className="text-right text-sm text-muted-foreground">
                    About{' '}
                    <span className="feis-narrow text-[19px] text-foreground">
                      {estimateCount(template.template_data)}
                    </span>
                    <span className="block text-xs">competitions</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {templates.length === 0 && (
          <p className="feis-sticker rounded-[3px] px-4 py-3 text-sm">
            No syllabus templates are available yet.
          </p>
        )}
      </div>
    )
  }

  // Show syllabus editor
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)

  return (
    <div>
      {errorPanel}

      {/* Template header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="feis-display text-[22px]">{selectedTemplate?.name ?? 'Your syllabus'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick the competitions you want to offer. The count updates as you go.
          </p>
        </div>
        <button type="button" onClick={handleChangeTemplate} className="feis-link text-sm">
          Change template
        </button>
      </div>

      {/* Syllabus toggle grid */}
      <SyllabusToggle
        templateData={templateData}
        selection={selection}
        onChange={handleSelectionChange}
      />

      {/* Save button */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="feis-btn feis-btn-primary"
        >
          {isPending ? 'Saving…' : 'Save and continue'}
        </button>

        {existingCompetitionsCount > 0 && (
          <button type="button" onClick={onNext} className="feis-btn feis-btn-outline">
            Keep current competitions
          </button>
        )}
      </div>
      {existingCompetitionsCount > 0 && (
        <p className="mt-2 max-w-[62ch] text-xs text-muted-foreground">
          This feis already has {existingCompetitionsCount} competitions. &ldquo;Save and
          continue&rdquo; replaces them with the ones ticked above. &ldquo;Keep current
          competitions&rdquo; leaves them as they are.
        </p>
      )}
    </div>
  )
}
