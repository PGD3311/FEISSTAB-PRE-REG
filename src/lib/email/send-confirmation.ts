import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCents, formatDate } from '@/lib/format'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

export async function sendConfirmationEmail(
  registrationId: string,
  supabase: SupabaseClient
) {
  const { data: reg, error } = await supabase
    .from('registrations')
    .select(`
      *,
      feis_listings(name, feis_date, venue_name, venue_address, contact_email),
      households(user_id)
    `)
    .eq('id', registrationId)
    .single()

  if (error || !reg) {
    console.error('Failed to fetch registration for email:', error)
    return
  }

  const { data: { user } } = await supabase.auth.admin.getUserById(reg.households.user_id)
  if (!user?.email) {
    console.error('No email found for user')
    return
  }

  const { data: entries } = await supabase
    .from('registration_entries')
    .select(`
      *,
      dancers(first_name, last_name),
      feis_competitions(display_name)
    `)
    .eq('registration_id', registrationId)

  const feis = reg.feis_listings
  const feisDate = formatDate(feis.feis_date, { weekday: 'long', fallback: 'TBD' })

  // Group entries by dancer
  const dancerEntries: Record<string, { name: string; competitions: string[] }> = {}
  for (const entry of entries ?? []) {
    const dancerName = `${entry.dancers.first_name} ${entry.dancers.last_name}`
    if (!dancerEntries[entry.dancer_id]) {
      dancerEntries[entry.dancer_id] = { name: dancerName, competitions: [] }
    }
    dancerEntries[entry.dancer_id].competitions.push(entry.feis_competitions.display_name)
  }

  const dancerSections = Object.values(dancerEntries)
    .map(d => `
      <div style="margin-bottom: 16px;">
        <strong>${d.name}</strong>
        <ul style="margin: 4px 0 0; padding-left: 20px;">
          ${d.competitions.map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>
    `)
    .join('')

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #0B4D2C; margin-bottom: 4px;">You're registered!</h1>
      <h2 style="color: #666; font-weight: normal; margin-top: 0;">${feis.name}</h2>

      <div style="background: #EBF4EF; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
        <div style="color: #666; font-size: 14px;">Confirmation Number</div>
        <div style="font-size: 28px; font-weight: bold; color: #0B4D2C; font-family: monospace;">${reg.confirmation_number}</div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Date</td>
          <td style="padding: 8px 0; text-align: right;">${feisDate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Venue</td>
          <td style="padding: 8px 0; text-align: right;">${feis.venue_name}${feis.venue_address ? `, ${feis.venue_address}` : ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Total Paid</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formatCents(reg.total_cents)}</td>
        </tr>
      </table>

      <h3>Dancers & Competitions</h3>
      ${dancerSections}

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="color: #666; font-size: 14px;">
        <strong>What's next?</strong> We'll email your schedule closer to the feis date.
      </p>

      ${feis.contact_email ? `<p style="color: #666; font-size: 14px;">Questions? Contact the organiser: <a href="mailto:${feis.contact_email}">${feis.contact_email}</a></p>` : ''}

      <p style="color: #999; font-size: 12px; margin-top: 20px;">
        Sent by FeisTab — <a href="${process.env.NEXT_PUBLIC_BASE_URL}/dashboard">View your registrations</a>
      </p>
    </div>
  `

  if (!resend) {
    console.log('Resend not configured — logging email instead:')
    console.log(`To: ${user.email}`)
    console.log(`Subject: You're registered for ${feis.name}`)
    console.log('HTML length:', html.length)
    return
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'FeisTab <noreply@feistab.com>',
      to: user.email,
      subject: `You're registered for ${feis.name}`,
      html,
    })
  } catch (err) {
    console.error('Failed to send email via Resend:', err)
  }
}
