'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { hasReviewStep, sentBackMessage } from '@/lib/approval-gate'
import type {
  FeisListing,
  FeeSchedule,
  ListingTransitionContext
} from '@/lib/types/feis-listing'
import { FeisWizardStep1 } from '@/components/organiser/feis-wizard-step1'
import { FeisWizardStep2 } from '@/components/organiser/feis-wizard-step2'
import { FeisWizardStep3 } from '@/components/organiser/feis-wizard-step3'
import { FeisWizardStep4 } from '@/components/organiser/feis-wizard-step4'
import { FeisWizardStep5 } from '@/components/organiser/feis-wizard-step5'
import { PageTitle } from '@/components/page-title'

const STEPS = [
  { number: 1, label: 'Details' },
  { number: 2, label: 'Syllabus' },
  { number: 3, label: 'Fees' },
  { number: 4, label: 'Deadlines' },
  { number: 5, label: 'Review' }
] as const

const STEP_HINT = 'You can go back to any step you have reached.'

/** What setup needs of each competition: its type, for the Review step's counts and checks */
export type SetupCompetition = ListingTransitionContext['enabledCompetitions'][number]

interface FeisWizardProps {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  competitions: SetupCompetition[]
}

function getCompletedStep(
  listing: FeisListing,
  feeSchedule: FeeSchedule | null,
  competitionsCount: number
): number {
  // Step 1 is complete if basic details are filled
  if (!listing.name || !listing.feis_date || !listing.venue_name) {
    return 0
  }

  // Step 2 is complete if there are competitions
  if (competitionsCount === 0) {
    return 1
  }

  // Step 3 is complete if fee schedule exists
  if (!feeSchedule) {
    return 2
  }

  // Step 4 is complete if registration dates are set
  if (!listing.reg_opens_at || !listing.reg_closes_at) {
    return 3
  }

  return 4
}

export function FeisWizard({ listing, feeSchedule, competitions }: FeisWizardProps) {
  const router = useRouter()
  const competitionsCount = competitions.length
  // Review holds "Submit for approval"; once RunFeis has approved the feis, setup ends at Deadlines
  const reviewStep = hasReviewStep(listing.status)
  const steps = reviewStep ? STEPS : STEPS.filter((step) => step.number !== 5)
  const lastStep = steps.length
  const completedStep = getCompletedStep(listing, feeSchedule, competitionsCount)
  const sentBack = sentBackMessage(listing)
  const [currentStep, setCurrentStep] = useState(Math.min(completedStep + 1, lastStep))

  function handleStepClick(stepNumber: number) {
    if (stepNumber <= completedStep + 1) {
      setCurrentStep(stepNumber)
    }
  }

  function handleNext() {
    if (currentStep < lastStep) {
      setCurrentStep(currentStep + 1)
    } else {
      router.push(`/organiser/feiseanna/${listing.id}`)
    }
  }

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  return (
    <div>
      <Link
        href="/organiser/feiseanna"
        className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Back to your feiseanna
      </Link>
      <div className="mt-3">
        <PageTitle
          title={listing.name || 'New feis'}
          intro={`Set up your feis in ${reviewStep ? 'five' : 'four'} steps. ${STEP_HINT}`}
        />
      </div>

      {sentBack && (
        <p
          role="status"
          className="mb-6 max-w-3xl border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-3 text-sm whitespace-pre-line text-[var(--color-feis-orange-ink)]"
        >
          {sentBack}
        </p>
      )}

      {/* Step indicator */}
      <nav aria-label="Setup steps" className="mb-8">
        <ol
          className={`grid border-b-[1.5px] border-[var(--color-feis-charcoal)] ${
            reviewStep ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {steps.map((step) => {
            const isAccessible = step.number <= completedStep + 1
            const isActive = step.number === currentStep
            const isDone = step.number <= completedStep && !isActive

            let marker =
              'border-[var(--color-feis-charcoal)] bg-white text-[var(--color-feis-charcoal)]'
            if (isActive) {
              marker =
                'border-[var(--color-feis-charcoal)] bg-[var(--color-feis-charcoal)] text-white'
            } else if (isDone) {
              marker = 'border-[var(--color-feis-green)] bg-[var(--color-feis-green)] text-white'
            } else if (!isAccessible) {
              marker = 'border-[#CFC6B2] bg-transparent text-[#B5AC98]'
            }

            return (
              <li key={step.number} className="min-w-0">
                <button
                  type="button"
                  onClick={() => handleStepClick(step.number)}
                  disabled={!isAccessible}
                  aria-current={isActive ? 'step' : undefined}
                  className={`-mb-[1.5px] flex w-full flex-col items-start gap-1.5 border-b-[3px] px-1 pt-1 pb-2.5 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)] sm:flex-row sm:items-center sm:gap-2.5 ${
                    isActive ? 'border-[var(--color-feis-green)]' : 'border-transparent'
                  } ${isAccessible ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                >
                  <span
                    className={`feis-narrow grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border-[1.5px] text-[19px] leading-none ${marker}`}
                  >
                    {step.number}
                  </span>
                  <span
                    className={`truncate text-xs sm:text-sm ${
                      isActive
                        ? 'font-bold text-foreground'
                        : isAccessible
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {step.label}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Step content */}
      <div className="min-h-[400px]">
        {currentStep === 1 && <FeisWizardStep1 listing={listing} onNext={handleNext} />}
        {currentStep === 2 && (
          <FeisWizardStep2
            listingId={listing.id}
            existingTemplateId={listing.syllabus_template_id}
            existingSnapshot={listing.syllabus_snapshot}
            existingCompetitionsCount={competitionsCount}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {currentStep === 3 && (
          <FeisWizardStep3
            listingId={listing.id}
            feeSchedule={feeSchedule}
            timeZone={listing.timezone ?? 'America/New_York'}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {currentStep === 4 && (
          <FeisWizardStep4 listing={listing} onNext={handleNext} onBack={handleBack} />
        )}
        {reviewStep && currentStep === 5 && (
          <FeisWizardStep5
            listing={listing}
            feeSchedule={feeSchedule}
            competitions={competitions}
            onBack={handleBack}
          />
        )}
      </div>

      {/* Navigation is handled by each step component's own Back/Save buttons */}
    </div>
  )
}
