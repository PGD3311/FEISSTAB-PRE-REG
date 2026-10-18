import { isAddOnOrder } from '@/lib/entry-display'
import { formatCents, formatDate } from '@/lib/format'
import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

export interface EmailContent {
  subject: string
  html: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const text = (value: string | null | undefined) => escapeHtml(value ?? '')

// ─── The family's confirmation ───
// main's "You're entered" email, moved here from its old sender file unchanged, except that it uses the
// shared escapeHtml above (which also escapes single quotes). tests/email-confirmation.test.ts keeps
// testing it.

export interface DancerBlock {
  name: string
  number: number | null
  competitions: { code: string | null; name: string }[]
}

/** One dancer drawn like their number card, with the competition codes beside it. */
function dancerBlock(d: DancerBlock): string {
  const codes = d.competitions
    .map(
      (c) => `
        <tr>
          <td style="padding:5px 0;border-top:1px solid #E2DCCD;font-size:15px;font-weight:bold;color:#17191B;width:72px;vertical-align:top;">${escapeHtml(c.code ?? '')}</td>
          <td style="padding:5px 0;border-top:1px solid #E2DCCD;font-size:14px;color:#3F4441;vertical-align:top;">${escapeHtml(c.name)}</td>
        </tr>`
    )
    .join('')

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:2px solid #17191B;background:#FFFFFF;">
      <tr>
        <td style="padding:16px 18px;width:120px;vertical-align:top;border-right:1px solid #E2DCCD;text-align:center;">
          <div style="font-size:11px;color:#615D55;">Competitor number</div>
          <div style="font-size:44px;line-height:1.05;font-weight:bold;color:#17191B;letter-spacing:-1px;">${d.number ?? '&ndash;'}</div>
        </td>
        <td style="padding:14px 18px;vertical-align:top;">
          <div style="font-size:17px;font-weight:bold;color:#17191B;margin-bottom:6px;">${escapeHtml(d.name)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${codes}</table>
        </td>
      </tr>
    </table>`
}

export interface ConfirmationEmailData {
  feisName: string
  feisDate: string
  venue: string
  dancers: DancerBlock[]
  totalCents: number
  confirmationNumber: string | null
  contactEmail: string | null
  baseUrl: string
  /** An add-on: these dances were added to the family's entry, and its dancers keep their numbers */
  addedToEntry?: boolean
}

/** The "you're entered" email: each dancer's competitor number and dances, and what was paid. */
export function renderConfirmationEmail(data: ConfirmationEmailData): string {
  const {
    feisName,
    feisDate,
    venue,
    dancers,
    totalCents,
    confirmationNumber,
    contactEmail,
    baseUrl,
    addedToEntry = false
  } = data
  const intro = addedToEntry
    ? "These dances were added to your entry. Dancers who were already entered keep their competitor numbers. Keep this email with your first one; you'll need the numbers on the day."
    : "Here are your competitor numbers and dances. Keep this email; you'll need the numbers on the day."
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>You're entered</title></head>
<body style="margin:0;padding:0;background-color:#FBF9F4;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${addedToEntry ? 'Dances added to your entry for' : 'Your competitor numbers for'} ${escapeHtml(feisName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF9F4;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr>
      <td style="background-color:#1F5538;padding:20px 28px 22px;border-bottom:6px double #C59D5F;">
        <div style="font-size:15px;font-weight:bold;font-style:italic;color:#FFFFFF;opacity:0.85;">RunFeis</div>
        <div style="font-size:28px;line-height:1.1;font-weight:bold;color:#FFFFFF;margin-top:10px;">You're entered</div>
        <div style="font-size:15px;color:#FFFFFF;opacity:0.85;margin-top:4px;">${escapeHtml(feisName)}, ${escapeHtml(feisDate)}${venue ? `, ${escapeHtml(venue)}` : ''}</div>
      </td>
    </tr>
    <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr>
      <td>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3F4441;">
          ${intro}
        </p>
        ${dancers.map(dancerBlock).join('')}
      </td>
    </tr>
    <tr>
      <td style="background:#FFFFFF;border:2px solid #17191B;padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:14px;color:#615D55;">Paid</td>
            <td style="font-size:22px;font-weight:bold;color:#17191B;text-align:right;">${formatCents(totalCents)}</td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#615D55;padding-top:6px;">Confirmation</td>
            <td style="font-size:15px;font-weight:bold;color:#17191B;text-align:right;padding-top:6px;">${escapeHtml(confirmationNumber ?? '')}</td>
          </tr>
        </table>
      </td>
    </tr>
    ${
      baseUrl
        ? `<tr><td style="padding-top:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td style="background-color:#2F7A52;border-radius:3px;text-align:center;">
            <a href="${baseUrl}/dashboard" target="_blank" style="display:block;padding:14px 20px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">See your entries</a>
          </td>
        </tr></table>
      </td></tr>`
        : ''
    }
    <tr>
      <td style="padding:20px 2px 0;font-size:13px;line-height:1.6;color:#615D55;">
        To add or drop a dance, contact the organiser${contactEmail ? ` at <a href="mailto:${escapeHtml(contactEmail)}" style="color:#2F7A52;">${escapeHtml(contactEmail)}</a>` : ''}. Entry fees aren't refundable.
      </td>
    </tr>
    <tr>
      <td style="padding:12px 2px 0;font-size:12px;color:#615D55;">RunFeis runs Irish dance feiseanna, from entries to results.</td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

/** What the worker has for a confirmation (get_notification_context) */
export interface ConfirmationEmailContext {
  order: { confirmation_number: string | null; total_cents: number }
  listing: {
    name: string | null
    feis_date: string | null
    venue_name: string | null
    venue_address: string | null
    contact_email: string | null
  }
  purchase: PurchaseSnapshot | null
  /** Each of the order's dancers' competitor numbers at this feis */
  numbers: { dancer_id: string; competitor_number: number }[]
  baseUrl: string
}

/**
 * The confirmation for a paid order: main's email, filled from what the family bought (the frozen
 * purchase) and their competitor numbers, not from the dancer's profile today.
 */
export function confirmationEmail(ctx: ConfirmationEmailContext): EmailContent {
  const dancers = new Map((ctx.purchase?.dancers ?? []).map((d) => [d.id, d]))
  const competitions = new Map((ctx.purchase?.competitions ?? []).map((c) => [c.id, c]))
  const numbers = new Map(ctx.numbers.map((n) => [n.dancer_id, n.competitor_number]))

  // One block per dancer, in entry order, as main's sender built them
  const blocks = new Map<string, DancerBlock>()
  for (const entry of ctx.purchase?.entries ?? []) {
    const dancer = dancers.get(entry.dancer_id)
    const competition = competitions.get(entry.competition_id)
    const block = blocks.get(entry.dancer_id) ?? {
      name: dancer ? `${dancer.first_name} ${dancer.last_name}` : 'Dancer',
      number: numbers.get(entry.dancer_id) ?? null,
      competitions: []
    }
    block.competitions.push({
      code: competition?.display_code ?? null,
      // A solo shows its dance; anything else its full name
      name:
        competition?.competition_type === 'solo' && competition.dance_label
          ? competition.dance_label
          : (competition?.display_name ?? 'Competition')
    })
    blocks.set(entry.dancer_id, block)
  }

  const feisName = ctx.listing.name ?? 'your feis'
  // An add-on's email lists only its own dances (the purchase is this order's), and says they were added
  const addedToEntry = isAddOnOrder({ purchase_snapshot: ctx.purchase })
  return {
    subject: addedToEntry ? `Dances added: ${feisName}` : `You're entered: ${feisName}`,
    html: renderConfirmationEmail({
      feisName,
      feisDate: formatDate(ctx.listing.feis_date, {
        weekday: 'long',
        fallback: 'Date to be announced'
      }),
      venue: [ctx.listing.venue_name, ctx.listing.venue_address].filter(Boolean).join(', '),
      dancers: [...blocks.values()],
      totalCents: ctx.order.total_cents,
      confirmationNumber: ctx.order.confirmation_number,
      contactEmail: ctx.listing.contact_email,
      baseUrl: ctx.baseUrl,
      addedToEntry
    })
  }
}

interface FamilyContact {
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
}

export interface PaymentAlertContext {
  exception: {
    support_ref: string
    severity: string
    reason: string
    amount_cents: number | null
    currency: string | null
    stripe_account_id: string | null
    stripe_checkout_session_id: string | null
    stripe_payment_intent_id: string | null
    created_at: string
  }
  listing: { name: string | null } | null
  family: FamilyContact | null
  order: { id: string; status: string } | null
}

function rows(pairs: [string, string | null | undefined][]): string {
  return pairs
    .map(
      ([label, value]) =>
        `<tr><td style="padding: 4px 12px 4px 0; color: #666;">${text(label)}</td><td>${text(value ?? '—')}</td></tr>`
    )
    .join('')
}

/** For the payments contacts: everything needed to find the payment in Stripe and follow the runbook */
export function renderPaymentAlertEmail(ctx: PaymentAlertContext): EmailContent {
  const e = ctx.exception
  const label = e.severity === 'notice' ? 'Payment notice' : 'Payment case'
  const family = ctx.family
    ? [ctx.family.first_name, ctx.family.last_name].filter(Boolean).join(' ')
    : null
  const amount =
    e.amount_cents === null
      ? null
      : `${formatCents(e.amount_cents)} ${(e.currency ?? '').toUpperCase()}`
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; padding: 20px;">
      <h2>${text(label)} ${text(e.support_ref)}: ${text(e.reason)}</h2>
      <table style="border-collapse: collapse;">
        ${rows([
          ['Feis', ctx.listing?.name],
          ['Family', family],
          ['Family email', ctx.family?.email],
          ['Family phone', ctx.family?.phone],
          ['Order', ctx.order ? `${ctx.order.id} (${ctx.order.status})` : null],
          ['Amount', amount],
          ['Stripe account', e.stripe_account_id],
          ['Checkout session', e.stripe_checkout_session_id],
          ['Payment intent', e.stripe_payment_intent_id],
          ['Recorded', e.created_at]
        ])}
      </table>
      <p>Follow docs/runbooks/payment-exceptions.md for "${text(e.reason)}".</p>
    </div>`
  return { subject: `[RunFeis] ${label} ${e.support_ref}: ${e.reason}`, html }
}

export interface DeliveryFailureContext {
  failed: {
    kind: string
    dedupe_key: string
    status: string
    last_error: string | null
    attempts: number
  }
  order: { id: string; status: string } | null
  family: FamilyContact | null
}

/** For the payments contacts: an email RunFeis could not deliver, or could not tell whether it delivered */
export function renderDeliveryFailureAlertEmail(ctx: DeliveryFailureContext): EmailContent {
  const f = ctx.failed
  const headline = f.status === 'needs_check' ? 'needs checking' : 'not delivered'
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; padding: 20px;">
      <h2>Email ${headline}: ${text(f.kind)}</h2>
      <table style="border-collapse: collapse;">
        ${rows([
          ['Notification', f.dedupe_key],
          ['Status', f.status],
          ['Attempts', String(f.attempts)],
          ['Last error', f.last_error],
          ['Order', ctx.order?.id],
          ['Family email', ctx.family?.email]
        ])}
      </table>
      <p>Check the Resend logs before resending by hand: docs/runbooks/payment-exceptions.md, "Emails".</p>
    </div>`
  return { subject: `[RunFeis] Email ${headline}: ${f.dedupe_key}`, html }
}
