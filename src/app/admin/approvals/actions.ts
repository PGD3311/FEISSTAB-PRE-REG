'use server'

import { after } from 'next/server'
import { adminDecisionError } from '@/lib/approval-gate'
import { listingApprovedEmail, listingSentBackEmail } from '@/lib/email/templates'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import {
  approvalEmailBaseUrl,
  organiserEmail,
  sendApprovalEmail
} from '@/app/_approvals/approval-email'

type DecisionResult = { success: true } | { error: string }

type UserClient = Awaited<ReturnType<typeof createClient>>

/** The decided feis, read back as the admin for the organiser's email */
async function decidedListing(supabase: UserClient, listingId: string) {
  const { data, error } = await supabase
    .from('feis_listings')
    .select('id, name, feis_date, created_by, updated_at')
    .eq('id', listingId)
    .single()
  if (error) {
    console.error(`[ADMIN_EMAIL_FAILED] could not read feis ${listingId}:`, error.message)
    return null
  }
  return data as {
    id: string
    name: string | null
    feis_date: string | null
    created_by: string | null
    updated_at: string
  }
}

/**
 * Approve a feis waiting for approval. approve_listing runs as the signed-in admin: it is
 * revoked from service_role and checks is_platform_admin() against auth.uid().
 */
export async function approveListing(listingId: string): Promise<DecisionResult> {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.rpc('approve_listing', { p_listing_id: listingId })
  if (error) {
    console.error(`Failed to approve feis ${listingId}:`, error.message)
    return { error: adminDecisionError(error.code, 'approve') }
  }

  // The feis is approved; the email to its organiser never undoes or blocks that
  const listing = await decidedListing(supabase, listingId)
  if (listing) {
    // Sent after the response, so the admin isn't kept waiting on the email service
    after(async () => {
      const to = await organiserEmail(listing.created_by)
      if (to) {
        await sendApprovalEmail(
          [to],
          listingApprovedEmail({ listing, baseUrl: approvalEmailBaseUrl() }),
          `listing-approved:${listingId}`
        )
      } else {
        console.error(`[ADMIN_EMAIL_FAILED] no organiser email for feis ${listingId}`)
      }
    })
  }
  return { success: true }
}

/** Send a feis back to its organiser as a draft, with a note saying what to fix */
export async function sendBackListing(listingId: string, note: string): Promise<DecisionResult> {
  const trimmed = note.trim()
  if (trimmed === '') return { error: adminDecisionError('22023', 'send_back') }

  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.rpc('send_back_listing', {
    p_listing_id: listingId,
    p_note: trimmed
  })
  if (error) {
    console.error(`Failed to send back feis ${listingId}:`, error.message)
    return { error: adminDecisionError(error.code, 'send_back') }
  }

  const listing = await decidedListing(supabase, listingId)
  if (listing) {
    after(async () => {
      const to = await organiserEmail(listing.created_by)
      if (to) {
        await sendApprovalEmail(
          [to],
          listingSentBackEmail({ listing, note: trimmed, baseUrl: approvalEmailBaseUrl() }),
          `listing-sent-back:${listingId}:${listing.updated_at}`
        )
      } else {
        console.error(`[ADMIN_EMAIL_FAILED] no organiser email for feis ${listingId}`)
      }
    })
  }
  return { success: true }
}
