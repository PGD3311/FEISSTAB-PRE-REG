# Stripe Connect Implementation Guide

*Research completed 2026-03-19*

## Key Architectural Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Account Type | **Express** | Organizers need "connect bank, get paid" — not a full Stripe dashboard. Stripe-hosted onboarding, simplified dashboard, prevents platform bypass. |
| Charge Type | **Direct Charges** | Organizer is merchant of record. Parent's bank statement shows feis name. Refunds from organizer's balance. Legally cleaner. |
| Payment UI | **Stripe Checkout (Hosted)** | Zero PCI surface area. Supports Apple Pay, Google Pay, Link. Mobile-optimized. |
| Platform Revenue | **Application fee** (flat % per registration) | Automatic. `application_fee_amount` on each charge. |
| Currency | **Organizer's local currency** | If feis is in Ireland, charge EUR. Parent's bank handles conversion. |
| Webhooks | **Two endpoints** | Platform events + Connect events (separate Stripe config). |

## Onboarding Flow (Account Links)

```
1. Organizer clicks "Connect Stripe"
2. Server: stripe.accounts.create({ type: 'express' })
3. Store acct_xxx linked to organizer
4. Server: stripe.accountLinks.create({
     account: 'acct_xxx',
     refresh_url: '.../stripe/refresh',
     return_url: '.../stripe/return',
     type: 'account_onboarding',
   })
5. Redirect organizer to Account Link URL
6. Organizer completes Stripe-hosted onboarding
7. Stripe redirects to return_url
8. Server: stripe.accounts.retrieve('acct_xxx') to check status
```

**Critical:** Account Links expire in ~5 minutes. Generate on-demand.
**Critical:** return_url does NOT mean onboarding is complete. Always check `charges_enabled` and `payouts_enabled`.

## Status Display

| State | Display |
|-------|---------|
| No account linked | "Connect your bank account to receive payments" + CTA |
| Created but not submitted | "Complete your Stripe setup" + yellow warning |
| Submitted, awaiting verification | "Being verified — usually 1-2 business days" |
| Fully verified | Green checkmark + "Payments active" |
| Requires additional info | "Stripe needs additional information" + CTA |
| Payouts disabled | Red warning + explanation + CTA |

## Essential Webhooks

| Event | Purpose |
|-------|---------|
| `payment_intent.succeeded` | Mark registration as paid |
| `payment_intent.payment_failed` | Show error to parent |
| `charge.refunded` | Update registration status |
| `charge.dispute.created` | Alert organizer, freeze registration |
| `account.updated` | Check organizer account status changes |
| `payout.paid` | Optionally notify organizer |
| `payout.failed` | Alert organizer of bank issues |

## Webhook Implementation (Next.js App Router)

```javascript
export async function POST(request: Request) {
  const body = await request.text(); // RAW body, not .json()
  const sig = request.headers.get('stripe-signature');
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  // Deduplicate by event.id, return 200 quickly, process async
}
```

## Common Pitfalls

1. **Assuming return_url = onboarding complete** — always check `charges_enabled`
2. **Parsing body before webhook verification** — must use `request.text()`
3. **Not setting up separate Connect webhook endpoint**
4. **Forgetting `stripeAccount` header** — creates charge on YOUR account
5. **Currency mismatch** — use connected account's default currency
6. **Refund on zero balance** — organizer's balance goes negative
7. **Not handling account deauthorization** — listen for `account.updated`
8. **No idempotency keys** — risk of duplicate charges
9. **Not storing Stripe IDs** — store payment_intent_id, charge_id, connected_account_id
10. **Skipping capability check in production** — test mode is lenient

## Fee Structure

Parent pays $50 for registration:
```
Total charge:                 $50.00
Stripe processing (2.9%+30c): -$1.75
Net to organizer + platform:  $48.25
Application fee (your cut):   -$2.50  (5% example)
Net to organizer:             $45.75
```

## Refund Handling

- Stripe keeps processing fee on refunds (default)
- Store refund policies per-event in database
- `refund_application_fee: true` to also refund platform fee
- Warn organizer if balance is low before processing refund

## Testing

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

Test cards: `4242424242424242` (success), `4000000000003220` (3DS), `4000000000009995` (decline)

## Environment Variables
```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx
```

## Multi-Currency (International)

Each connected account has a country and default currency. Irish dance is global:
- US organizers: USD
- Ireland organizers: EUR
- UK organizers: GBP
- Australia organizers: AUD
- Canada organizers: CAD

Cross-border fee: ~1% additional when card country differs from merchant country. Platform account can be in any country and have connected accounts internationally.
