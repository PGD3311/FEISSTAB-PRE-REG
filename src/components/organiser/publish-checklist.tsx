'use client'

import Link from 'next/link'

interface PublishChecklistProps {
  blocks: string[]
  warnings: string[]
  passed?: string[]
  /** A link beside a failed check that is fixed on another page */
  linkFor?: (block: string) => { href: string; label: string } | null
}

type CheckKind = 'passed' | 'block' | 'warning'

const MARKS: Record<CheckKind, { glyph: string; srLabel: string; box: string; text: string }> = {
  passed: {
    glyph: '✓',
    srLabel: 'Done:',
    box: 'border-[var(--color-feis-charcoal)] text-[var(--color-feis-green)]',
    text: 'text-foreground'
  },
  block: {
    glyph: '✗',
    srLabel: 'Needs fixing:',
    box: 'border-destructive text-destructive',
    text: 'font-semibold text-destructive'
  },
  warning: {
    glyph: '!',
    srLabel: 'Worth checking:',
    box: 'border-[var(--color-feis-orange-ink)] text-[var(--color-feis-orange-ink)]',
    text: 'text-[var(--color-feis-orange-ink)]'
  }
}

function CheckRow({
  kind,
  children,
  link
}: {
  kind: CheckKind
  children: string
  link?: { href: string; label: string } | null
}) {
  const mark = MARKS[kind]
  return (
    <li className="flex items-start gap-3 border-t border-[#E2DCCD] py-2.5 text-sm first:border-t-0">
      <span
        aria-hidden="true"
        className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[2px] border-[1.5px] bg-white text-[13px] leading-none font-black ${mark.box}`}
      >
        {mark.glyph}
      </span>
      <span className={mark.text}>
        <span className="sr-only">{mark.srLabel} </span>
        {children}
        {link && (
          <>
            {' '}
            <Link href={link.href} className="feis-link font-semibold">
              {link.label}
            </Link>
          </>
        )}
      </span>
    </li>
  )
}

export function PublishChecklist({
  blocks,
  warnings,
  passed = [],
  linkFor
}: PublishChecklistProps) {
  const allClear = blocks.length === 0 && warnings.length === 0

  if (allClear && passed.length === 0) return null

  return (
    <div className="space-y-3">
      <ul className="border-y-[1.5px] border-[var(--color-feis-charcoal)]">
        {blocks.map((block) => (
          <CheckRow key={block} kind="block" link={linkFor?.(block)}>
            {block}
          </CheckRow>
        ))}
        {warnings.map((warning) => (
          <CheckRow key={warning} kind="warning">
            {warning}
          </CheckRow>
        ))}
        {passed.map((item) => (
          <CheckRow key={item} kind="passed">
            {item}
          </CheckRow>
        ))}
      </ul>

      {allClear && passed.length > 0 && (
        <p className="border-l-4 border-[var(--color-feis-green)] bg-[var(--color-feis-green-light)] px-4 py-2.5 text-sm font-bold text-[var(--color-feis-green-700)]">
          Ready to submit
        </p>
      )}
    </div>
  )
}
