import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// Use service_role for webhook handler (no user auth context)
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function generateConfirmationNumber(): string {
  const year = new Date().getFullYear()
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // No 0/O, 1/I/L
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `FT-${year}-${code}`
}

export async function POST(request: Request) {
  const body = await request.text() // RAW body — not .json()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_CONNECT_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const registrationId = session.metadata?.registration_id

    if (!registrationId) {
      console.error('No registration_id in checkout session metadata')
      return NextResponse.json({ error: 'Missing registration_id' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Idempotency: check if already processed
    const { data: registration, error: fetchError } = await supabase
      .from('registrations')
      .select('status')
      .eq('id', registrationId)
      .single()

    if (fetchError || !registration) {
      console.error('Registration not found:', registrationId)
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (registration.status === 'paid') {
      return NextResponse.json({ received: true, already_processed: true })
    }

    // Extract charge ID
    let chargeId: string | null = null
    if (session.payment_intent) {
      try {
        const stripe = getStripe()
        const paymentIntent = await stripe.paymentIntents.retrieve(
          session.payment_intent as string,
          { stripeAccount: event.account ?? undefined }
        )
        chargeId = (paymentIntent.latest_charge as string) ?? null
      } catch (err) {
        console.error('Failed to retrieve payment intent:', err)
      }
    }

    // Generate confirmation number with retry for uniqueness
    let confirmationNumber: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateConfirmationNumber()
      const { data: existing, error: checkErr } = await supabase
        .from('registrations')
        .select('id')
        .eq('confirmation_number', candidate)
        .single()

      // PGRST116 = "no rows found" = candidate is available
      if (checkErr && checkErr.code !== 'PGRST116') {
        console.error(`Confirmation number check failed (attempt ${attempt + 1}):`, checkErr)
        continue
      }

      if (!existing) {
        confirmationNumber = candidate
        break
      }
    }

    if (!confirmationNumber) {
      console.error(`CRITICAL: Failed to generate unique confirmation number after 5 attempts for registration ${registrationId}`)
      confirmationNumber = `FT-${Date.now()}`
    }

    // Update registration to paid
    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        status: 'paid',
        stripe_payment_intent_id: session.payment_intent as string | null,
        stripe_charge_id: chargeId,
        total_cents: session.amount_total ?? 0,
        confirmation_number: confirmationNumber,
        hold_expires_at: null,
      })
      .eq('id', registrationId)

    if (updateError) {
      console.error('Failed to update registration:', updateError)
      return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 })
    }

    // Create registration snapshot
    const { data: fullReg, error: snapFetchError } = await supabase
      .from('registrations')
      .select(
        '*, registration_entries(*, dancers(first_name, last_name, date_of_birth, championship_status), feis_competitions(display_name, age_group_key, level_key, dance_key, competition_type)), feis_listings(name, feis_date)'
      )
      .eq('id', registrationId)
      .single()

    if (snapFetchError) {
      console.error(`Failed to fetch registration ${registrationId} for snapshot:`, snapFetchError)
    } else if (fullReg) {
      const { error: snapInsertError } = await supabase
        .from('registration_snapshots')
        .insert({
          registration_id: registrationId,
          snapshot_data: fullReg,
        })

      if (snapInsertError) {
        console.error(`Failed to create snapshot for registration ${registrationId}:`, snapInsertError)
      }
    }

    // Send confirmation email (async, don't block webhook response)
    try {
      const { sendConfirmationEmail } = await import('@/lib/email/send-confirmation')
      await sendConfirmationEmail(registrationId, supabase)
    } catch (err) {
      console.error('Failed to send confirmation email:', err)
    }
  }

  return NextResponse.json({ received: true })
}
