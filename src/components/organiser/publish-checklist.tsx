'use client'

interface PublishChecklistProps {
  blocks: string[]
  warnings: string[]
}

export function PublishChecklist({ blocks, warnings }: PublishChecklistProps) {
  if (blocks.length === 0 && warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm">
        <svg
          className="h-5 w-5 flex-shrink-0 text-green-600"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
        <span className="font-medium text-green-700">Ready to publish</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blocks.map((block) => (
        <div
          key={block}
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm"
        >
          <svg
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-destructive">{block}</span>
        </div>
      ))}

      {warnings.map((warning) => (
        <div
          key={warning}
          className="flex items-start gap-2 rounded-md border border-feis-orange/20 bg-feis-orange/5 px-4 py-3 text-sm"
        >
          <svg
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-feis-orange"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.345 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-feis-orange">{warning}</span>
        </div>
      ))}
    </div>
  )
}
