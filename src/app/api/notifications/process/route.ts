import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { notificationDeps } from '@/app/_payments/notification-deps'
import { processNotifications } from '@/app/_payments/notification-worker'

function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// Called every 5 minutes by pg_cron through pg_net (docs/runbooks/payment-exceptions.md, "Emails")
export async function POST(request: Request) {
  if (!authorised(request.headers.get('authorization'), process.env.NOTIFICATIONS_CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await processNotifications(notificationDeps(), { limit: 20 })
  return NextResponse.json(result)
}
