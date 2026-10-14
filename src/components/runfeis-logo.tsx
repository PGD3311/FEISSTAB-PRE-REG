// RunFeis logo, drawn from the brand sheet (Logo 1A, Oct 2026).
// "color" sits on cream/white; "onGreen" is the all-cream version for green headers.

const BRAND = {
  green: '#2F7A52',
  orange: '#D0802F',
  black: '#17191B',
  cream: '#FBF9F4'
}

type Tone = 'dark' | 'light'

function Shoe({
  tone,
  width,
  rotate,
  nudgeY = 0
}: {
  tone: Tone
  width: number
  rotate: number
  nudgeY?: number
}) {
  const fill = tone === 'dark' ? BRAND.black : BRAND.cream
  const line = tone === 'dark' ? '#F6F3EC' : BRAND.black
  return (
    <svg
      viewBox="0 0 120 72"
      width={width}
      height={(width * 72) / 120}
      aria-hidden="true"
      style={{ flexShrink: 0, transform: `rotate(${rotate}deg) translateY(${nudgeY}px)` }}
    >
      <path
        fill={fill}
        d="M12 22 C20 15 33 17 41 23 L58 30 C78 34 100 38 110 46 C117 51 116 58 108 58 L38 58 C33 58 31 54 27 54 L27 67 L9 67 L9 54 C7 45 7 30 12 22 Z"
      />
      <path fill="none" stroke={line} strokeWidth={2.5} strokeLinecap="round" d="M40 54.5 L106 54.5" />
      <path fill="none" stroke={line} strokeWidth={2.5} strokeLinecap="round" d="M43 25 C45 33 47 41 50 49" />
      <rect x={40} y={31} width={10} height={9} rx={1.5} fill={fill} stroke={line} strokeWidth={2} />
      <path fill="none" stroke={line} strokeWidth={2} strokeLinecap="round" d="M11 61 L25 61" />
    </svg>
  )
}

function SpeedLines({ tone, width }: { tone: Tone; width: number }) {
  return (
    <svg
      viewBox="0 0 60 40"
      width={width}
      height={(width * 40) / 60}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="none"
        stroke={tone === 'dark' ? BRAND.black : BRAND.cream}
        strokeWidth={4}
        strokeLinecap="round"
        d="M8 8 L52 8 M20 20 L52 20 M30 32 L52 32"
      />
    </svg>
  )
}

const SIZES = {
  sm: { text: 20, shoe: 30 },
  md: { text: 34, shoe: 50 },
  lg: { text: 52, shoe: 76 }
}

export function RunFeisLogo({
  variant = 'color',
  size = 'md',
  full = false,
  className
}: {
  variant?: 'color' | 'onGreen'
  size?: keyof typeof SIZES
  /** Full lockup: speed lines and a shoe either side, as on the brand sheet */
  full?: boolean
  className?: string
}) {
  const { text, shoe } = SIZES[size]
  const tone: Tone = variant === 'color' ? 'dark' : 'light'
  const run = variant === 'color' ? BRAND.green : BRAND.cream
  const feis = variant === 'color' ? BRAND.orange : BRAND.cream

  return (
    <span
      role="img"
      aria-label="RunFeis"
      className={`inline-flex items-center ${className ?? ''}`}
      style={{ gap: text * 0.12 }}
    >
      {full && (
        <span className="inline-flex items-center" style={{ transform: `translateY(${text * 0.25}px)` }}>
          <SpeedLines tone={tone} width={shoe * 0.43} />
          <Shoe tone={tone} width={shoe} rotate={18} />
        </span>
      )}
      <span
        aria-hidden="true"
        style={{
          fontSize: text,
          fontWeight: 900,
          fontStyle: 'italic',
          letterSpacing: '-0.03em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          paddingRight: '0.08em',
        }}
      >
        <span style={{ color: run }}>Run</span>
        <span style={{ color: feis }}>Feis</span>
      </span>
      <Shoe tone={tone} width={shoe} rotate={-14} nudgeY={-text * 0.3} />
    </span>
  )
}
