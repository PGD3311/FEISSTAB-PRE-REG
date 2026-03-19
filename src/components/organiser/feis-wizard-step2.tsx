'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import type {
  TemplateData,
  SyllabusSelection,
} from '@/lib/types/feis-listing'
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
  }
}

/** Estimate total competition count from template data (all enabled). */
function estimateCount(td: TemplateData): number {
  const solos = td.age_groups.length * td.levels.length * td.dances.length
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
  onBack,
}: FeisWizardStep2Props) {
  const router = useRouter()
  const supabase = useSupabase()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Template picker state
  const [templates, setTemplates] = useState<SyllabusTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  // Selected template + editor state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    existingTemplateId
  )
  const [templateData, setTemplateData] = useState<TemplateData | null>(
    existingSnapshot
  )
  const [selection, setSelection] = useState<SyllabusSelection | null>(null)

  // If we already have a snapshot, build selection from it
  useEffect(() => {
    if (existingSnapshot && existingTemplateId && !selection) {
      setSelection(buildDefaultSelection(existingSnapshot))
    }
  }, [existingSnapshot, existingTemplateId, selection])

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

  // Loading state
  if (loadingTemplates) {
    return (
      <div className="feis-card flex items-center justify-center px-6 py-16 text-center text-muted-foreground">
        Loading syllabus templates...
      </div>
    )
  }

  // Show template picker if no template selected yet
  if (!selectedTemplateId || !templateData || !selection) {
    return (
      <div>
        {error && (
          <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-lg font-semibold">Choose a Syllabus Template</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start from a template, then customise which competitions to offer.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => handleSelectTemplate(template)}
              className="feis-card cursor-pointer px-5 py-4 text-left transition-colors hover:border-primary"
            >
              <h3 className="font-semibold">{template.name}</h3>
              {template.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {template.description}
                </p>
              )}
              <div className="mt-3 text-xs text-muted-foreground">
                ~{estimateCount(template.template_data)} competitions
              </div>
            </button>
          ))}
        </div>

        {templates.length === 0 && (
          <div className="feis-card flex items-center justify-center px-6 py-16 text-center text-muted-foreground">
            No syllabus templates available.
          </div>
        )}
      </div>
    )
  }

  // Show syllabus editor
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)

  return (
    <div>
      {error && (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Template header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {selectedTemplate?.name ?? 'Syllabus Editor'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Toggle competitions on or off. Changes preview instantly.
          </p>
        </div>
        <button
          type="button"
          onClick={handleChangeTemplate}
          className="self-start text-sm text-primary hover:underline"
        >
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
      <div className="mt-8">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Saving...' : 'Save & Continue'}
        </button>

        {existingCompetitionsCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Saving will replace the existing {existingCompetitionsCount}{' '}
            competitions.
          </p>
        )}
      </div>
    </div>
  )
}
