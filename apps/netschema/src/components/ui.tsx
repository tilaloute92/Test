import { useEffect, useRef, useState, type ReactNode } from 'react'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'active'

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  primary: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-500',
  ghost: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
  danger: 'border-red-200 bg-white text-red-600 hover:bg-red-50',
  active: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500',
}

export function Btn({
  children,
  onClick,
  variant = 'default',
  title,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]}`}
    >
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      className={INPUT_CLASS}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select className={INPUT_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
      />
      {label}
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full accent-blue-600"
    />
  )
}

/**
 * Menu déroulant pour une famille de commandes.
 *
 * La barre d'outils accumulait dix boutons de bout de ligne : charger l'exemple, repartir à
 * vide, enregistrer, ouvrir, puis trois formats d'export. Ils tenaient toute la largeur et
 * faisaient passer la barre à la ligne — cent soixante-dix-huit pixels pris au plan avant
 * qu'il commence. Ce sont pourtant des commandes qu'on emploie une fois par séance, pas une
 * fois par minute : elles méritent un repli, là où « Relier » ou « Supprimer » méritent
 * d'être sous la main.
 *
 * Le menu se ferme au clic ailleurs, à Échap, et après le choix.
 */
export function Menu({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: (fermer: () => void) => ReactNode
}) {
  const [ouvert, setOuvert] = useState(false)
  const cadre = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ouvert) return
    const dehors = (event: MouseEvent) => {
      if (!cadre.current?.contains(event.target as Node)) setOuvert(false)
    }
    const echap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    document.addEventListener('keydown', echap)
    return () => {
      document.removeEventListener('mousedown', dehors)
      document.removeEventListener('keydown', echap)
    }
  }, [ouvert])

  return (
    <div ref={cadre} className="relative">
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition ${
          ouvert ? 'border-slate-300 bg-slate-100 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        {label}
        <span className="text-[9px] text-slate-400">▾</span>
      </button>
      {ouvert && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[200px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {children(() => setOuvert(false))}
        </div>
      )}
    </div>
  )
}

/** Une entrée de menu : pleine largeur, avec sa ligne d'explication. */
export function MenuItem({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-[13px] font-medium text-slate-800">{label}</span>
      {hint && <span className="text-[11px] leading-snug text-slate-500">{hint}</span>}
    </button>
  )
}

/** Trait de séparation entre deux groupes d'un menu. */
export function MenuSeparator() {
  return <div className="my-1 h-px bg-slate-100" />
}
