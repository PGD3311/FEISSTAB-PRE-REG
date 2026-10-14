// RunFeis logo, drawn from the brand sheet (Logo 1A, Oct 2026).
// "color" sits on cream/white; "onGreen" is the main app banner: cream wordmark, tricolour shoes.

const BRAND = {
  green: '#2F7A52',
  orange: '#D0802F',
  black: '#17191B',
  cream: '#FBF9F4'
}

// dark: black shoe (on cream). light: cream shoe (reversed, dark backgrounds).
// tricolor: green/white/orange shoe with a cream outline (on the green app banner).
type Tone = 'dark' | 'light' | 'tricolor'

const SHOE_OUTLINE =
  'M8 34 C6 22 14 12 26 14 C34 16 40 22 46 26 L64 34 C84 40 104 44 114 52 C120 58 116 64 106 64 L26 64 C12 64 8 52 8 34 Z'
const LACE_HOLES: Array<[number, number]> = [
  [50, 32.5],
  [58, 36],
  [66, 39.5],
  [75, 42.5],
  [84, 45],
  [93, 47.5]
]

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
  const body = tone === 'dark' ? BRAND.black : tone === 'light' ? BRAND.cream : 'url(#runfeis-tri)'
  const outline = tone === 'dark' ? BRAND.black : BRAND.cream
  const detail = tone === 'dark' ? '#F3EAD6' : BRAND.black
  const hole = tone === 'tricolor' ? BRAND.cream : detail
  return (
    <svg
      viewBox="-3 -3 126 78"
      width={width}
      height={(width * 78) / 126}
      aria-hidden="true"
      style={{ flexShrink: 0, transform: `rotate(${rotate}deg) translateY(${nudgeY}px)` }}
    >
      {tone === 'tricolor' && (
        <defs>
          <linearGradient id="runfeis-tri" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={BRAND.green} />
            <stop offset=".36" stopColor={BRAND.green} />
            <stop offset=".36" stopColor={BRAND.cream} />
            <stop offset=".64" stopColor={BRAND.cream} />
            <stop offset=".64" stopColor={BRAND.orange} />
            <stop offset="1" stopColor={BRAND.orange} />
          </linearGradient>
        </defs>
      )}
      <path
        fill={body}
        stroke={outline}
        strokeWidth={3.5}
        strokeLinejoin="round"
        d={SHOE_OUTLINE}
      />
      <path fill={detail} d="M13 23 C19 15 31 15 40 23 C31 20 21 21 13 28 Z" />
      <path
        fill="none"
        stroke={detail}
        strokeWidth={3.5}
        strokeLinecap="round"
        d="M15 32 C18 46 32 56 64 59"
      />
      {LACE_HOLES.map(([cx, cy]) => (
        <ellipse
          key={cx}
          cx={cx}
          cy={cy}
          rx={5.2}
          ry={2.7}
          transform={`rotate(-58 ${cx} ${cy})`}
          fill={hole}
          stroke={tone === 'tricolor' ? BRAND.black : 'none'}
          strokeWidth={1.4}
        />
      ))}
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
        d="M54 4 C32 4 14 14 8 32 M54 17 C40 17 28 23 24 34"
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
  const tone: Tone = variant === 'color' ? 'dark' : 'tricolor'
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
        <span
          className="inline-flex items-center"
          style={{ transform: `translateY(${text * 0.25}px)` }}
        >
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
