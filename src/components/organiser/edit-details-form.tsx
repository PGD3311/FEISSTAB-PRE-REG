'use client'

import { useRouter } from 'next/navigation'

import type { FeisListing } from '@/lib/types/feis-listing'
import { FeisWizardStep1 } from '@/components/organiser/feis-wizard-step1'

interface EditDetailsFormProps {
  listing: FeisListing
}

export function EditDetailsForm({ listing }: EditDetailsFormProps) {
  const router = useRouter()

  function handleSaved() {
    router.push(`/organiser/feiseanna/${listing.id}`)
  }

  return <FeisWizardStep1 listing={listing} onNext={handleSaved} />
}
