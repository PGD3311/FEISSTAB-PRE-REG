'use client'

import { useState } from 'react'
import Link from 'next/link'

import type { FeisListing, FeeSchedule } from '@/lib/types/feis-listing'
import { FeisWizardStep1 } from '@/components/organiser/feis-wizard-step1'

const STEPS = [
  { number: 1, label: 'Details' },
  { number: 2, label: 'Syllabus' },
  { number: 3, label: 'Fees' },
  { number: 4, label: 'Deadlines' },
  { number: 5, label: 'Review' },
] as const

interface FeisWizardProps {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  competitionsCount: number
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

export function FeisWizard({
  listing,
  feeSchedule,
  competitionsCount,
}: FeisWizardProps) {
  const completedStep = getCompletedStep(
    listing,
    feeSchedule,
    competitionsCount
  )
  const [currentStep, setCurrentStep] = useState(
    Math.min(completedStep + 1, 5)
  )

  function handleStepClick(stepNumber: number) {
    if (stepNumber <= completedStep + 1) {
      setCurrentStep(stepNumber)
    }
  }

  function handleNext() {
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1)
    }
  }

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/organiser/feiseanna"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Feiseanna
        </Link>
        <h1 className="mt-3 text-2xl">
          {listing.name || 'New Feis'} — Setup
        </h1>
      </div>

      {/* Step indicator */}
      <div className="feis-segmented-bar mb-8">
        {STEPS.map((step) => {
          const isAccessible = step.number <= completedStep + 1
          const isActive = step.number === currentStep

          return (
            <button
              key={step.number}
              type="button"
              onClick={() => handleStepClick(step.number)}
              disabled={!isAccessible}
              className={`feis-segmented-tab ${
                isActive ? 'feis-segmented-tab-active' : ''
              } ${
                !isAccessible
                  ? 'cursor-not-allowed opacity-40'
                  : 'cursor-pointer'
              }`}
            >
              <span className="mr-1.5 text-xs opacity-60">
                {step.number}.
              </span>
              {step.label}
            </button>
          )
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {currentStep === 1 && (
          <FeisWizardStep1 listing={listing} onNext={handleNext} />
        )}
        {currentStep === 2 && (
          <PlaceholderStep step={2} label="Syllabus" />
        )}
        {currentStep === 3 && (
          <PlaceholderStep step={3} label="Fees" />
        )}
        {currentStep === 4 && (
          <PlaceholderStep step={4} label="Deadlines" />
        )}
        {currentStep === 5 && (
          <PlaceholderStep step={5} label="Review" />
        )}
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
        <button
          type="button"
          onClick={handleBack}
          disabled={currentStep === 1}
          className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back
        </button>
        {currentStep < 5 && (
          <button
            type="button"
            onClick={handleNext}
            disabled={currentStep > completedStep}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}

function PlaceholderStep({
  step,
  label,
}: {
  step: number
  label: string
}) {
  return (
    <div className="feis-card flex items-center justify-center px-6 py-16 text-center text-muted-foreground">
      Step {step}: {label} — coming soon
    </div>
  )
}
