import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageTitle } from '@/components/page-title'
import { NumberCardSheet } from '@/components/registration/number-card-sheet'
import { PrintButton } from '@/components/registration/print-button'
import { loadEnteredFeiseanna } from '../../dancers/entered-feiseanna'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ feisId: string }>
}

/**
 * The family's competitor number cards for one feis, ready to print: one sheet per dancer with
 * the card on top and the competition sticker underneath to cut out and stick on the back.
 */
export default async function NumberCardsPage({ params }: Props) {
  const { feisId } = await params
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!household) redirect('/auth/onboarding')

  const { data: dancers, error } = await supabase
    .from('dancers')
    .select('id, first_name, last_name, school_name')
    .eq('household_id', household.id)
  if (error) console.error('Failed to load dancers for number cards:', error)

  const entered = await loadEnteredFeiseanna(
    supabase,
    (dancers ?? []).map((d) => d.id)
  )
  const cards = (dancers ?? [])
    .map((d) => ({ dancer: d, entry: (entered[d.id] ?? []).find((e) => e.feisId === feisId) }))
    .filter((c) => c.entry !== undefined && c.entry.number !== null)
    .sort((a, b) => (a.entry?.number ?? 0) - (b.entry?.number ?? 0))

  const feisName = cards[0]?.entry?.feisName ?? 'this feis'
  const feisDate = cards[0]?.entry?.feisDate ?? null

  return (
    <div>
      <div className="print:hidden">
        <PageTitle
          title="Number cards"
          intro={
            cards.length > 0
              ? `${feisName}. Print one sheet per dancer. Cut out the sticker and put it on the back of the card, so side-stage can check your dances.`
              : undefined
          }
          action={cards.length > 0 ? <PrintButton /> : undefined}
        />
      </div>

      {cards.length === 0 ? (
        <div className="feis-sticker max-w-3xl rounded px-5 py-5">
          <p className="font-bold">No number cards for this feis yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Competitor numbers are given out as soon as your entry is paid.
          </p>
          <Link href="/dashboard" className="feis-btn feis-btn-ink mt-4">
            Back to my entries
          </Link>
        </div>
      ) : (
        <div className="grid gap-10 print:block">
          {cards.map(({ dancer, entry }) => (
            <NumberCardSheet
              key={dancer.id}
              feisName={entry?.feisName ?? ''}
              feisDate={feisDate}
              number={entry?.number ?? null}
              dancerName={`${dancer.first_name} ${dancer.last_name}`}
              schoolName={dancer.school_name}
              competitions={entry?.competitions ?? []}
            />
          ))}
        </div>
      )}
    </div>
  )
}
