import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { createOrderStore } from '@/app/_payments/order-store'
import { supabaseRpc } from '@/app/_payments/rpc'
import { createStripeGateway } from '@/app/_payments/stripe-gateway'
import { handleStripeEvent } from '@/app/_payments/webhook-handler'

export async function POST(request: Request) {
  const body = await request.text() // RAW body: signature verification needs it unparsed
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_CONNECT_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const outcome = await handleStripeEvent(
    {
      store: createOrderStore(supabaseRpc(createServiceClient())),
      stripe: createStripeGateway(stripe),
      log: (line) => console.log(line)
    },
    event
  )
  return NextResponse.json(outcome.body, { status: outcome.status })
}
