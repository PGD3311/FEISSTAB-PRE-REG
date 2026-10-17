import { Resend } from 'resend'
import type { ServiceClient } from '@/lib/supabase/service'
import { formatCents, formatDate } from '@/lib/format'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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
    baseUrl
  } = data
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>You're entered</title></head>
<body style="margin:0;padding:0;background-color:#FBF9F4;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your competitor numbers for ${escapeHtml(feisName)}.</div>
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
          Here are your competitor numbers and dances. Keep this email; you'll need the numbers on the day.
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

export async function sendConfirmationEmail(registrationId: string, supabase: ServiceClient) {
  const { data: reg, error } = await supabase
    .from('registrations')
    .select(
      `
      *,
      feis_listings(name, feis_date, venue_name, venue_address, contact_email),
      households(user_id)
    `
    )
    .eq('id', registrationId)
    .single()

  if (error || !reg) {
    console.error('Failed to fetch registration for email:', error)
    return
  }

  const {
    data: { user }
  } = await supabase.auth.admin.getUserById(reg.households.user_id)
  if (!user?.email) {
    console.error('No email found for user')
    return
  }

  const entriesResult = await supabase
    .from('registration_entries')
    .select(
      `
        *,
        dancers(first_name, last_name),
        feis_competitions(display_name, display_code, dance_label, competition_type)
      `
    )
    .eq('registration_id', registrationId)

  // A dancer added to in a later order keeps the number from their first order
  const dancerIds = [...new Set((entriesResult.data ?? []).map((e) => e.dancer_id as string))]
  const numbersResult = await supabase
    .from('competitor_numbers')
    .select('dancer_id, competitor_number')
    .eq('feis_listing_id', reg.feis_listing_id)
    .in('dancer_id', dancerIds)

  if (entriesResult.error) console.error('Failed to fetch entries for email:', entriesResult.error)
  if (numbersResult.error) console.error('Failed to fetch numbers for email:', numbersResult.error)

  const numbers = new Map<string, number>(
    (numbersResult.data ?? []).map((n) => [n.dancer_id as string, n.competitor_number as number])
  )

  const feis = reg.feis_listings
  const feisDate = formatDate(feis.feis_date, { weekday: 'long', fallback: 'Date to be announced' })
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? ''

  // Group entries by dancer
  const dancers = new Map<string, DancerBlock>()
  for (const entry of entriesResult.data ?? []) {
    const comp = entry.feis_competitions
    const block = dancers.get(entry.dancer_id) ?? {
      name: `${entry.dancers.first_name} ${entry.dancers.last_name}`,
      number: numbers.get(entry.dancer_id) ?? null,
      competitions: []
    }
    block.competitions.push({
      code: comp.display_code,
      name:
        comp.competition_type === 'solo' && comp.dance_label ? comp.dance_label : comp.display_name
    })
    dancers.set(entry.dancer_id, block)
  }

  const html = renderConfirmationEmail({
    feisName: feis.name,
    feisDate,
    venue: [feis.venue_name, feis.venue_address].filter(Boolean).join(', '),
    dancers: [...dancers.values()],
    totalCents: reg.total_cents,
    confirmationNumber: reg.confirmation_number,
    contactEmail: feis.contact_email,
    baseUrl
  })

  if (!resend) {
    console.log('Resend not configured — logging email instead:')
    console.log(`To: ${user.email}`)
    console.log(`Subject: You're entered: ${feis.name}`)
    console.log('HTML length:', html.length)
    return
  }

  try {
    const { error: sendError } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'RunFeis <noreply@feistab.com>',
      to: user.email,
      subject: `You're entered: ${feis.name}`,
      html
    })
    if (sendError) console.error('Resend rejected the confirmation email:', sendError)
  } catch (err) {
    console.error('Failed to send email via Resend:', err)
  }
}
