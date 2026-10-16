'use client'

/** Opens the browser's print dialog for the number cards. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="feis-btn feis-btn-primary">
      Print number cards
    </button>
  )
}
