import type { DeviceKind } from '../types'

/**
 * Pictogrammes des équipements, dessinés dans un carré de 24×24 et tracés avec des
 * attributs de présentation explicites (pas de classes CSS) : c'est ce qui permet au SVG
 * exporté de rester fidèle à l'écran une fois sorti de l'application.
 */
export function DeviceIcon({ kind, color }: { kind: DeviceKind; color: string }) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }

  switch (kind) {
    case 'internet':
      return (
        <g {...stroke}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
        </g>
      )
    case 'cloud':
      return (
        <g {...stroke}>
          <path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.8 10.2 3.9 3.9 0 0 0 7 18Z" />
        </g>
      )
    case 'wan':
      return (
        <g {...stroke}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5v17M3.5 12h17M6 6.5c3.5 2 8.5 2 12 0M6 17.5c3.5-2 8.5-2 12 0" />
        </g>
      )
    case 'router':
      return (
        <g {...stroke}>
          <rect x="2.5" y="13" width="19" height="7" rx="2" />
          <path d="M6 16.5h3M12 16.5h6" />
          <path d="M8 9.5 8 4m0 0 2 2M8 4 6 6" />
          <path d="M16 4v5.5m0 0 2-2m-2 2-2-2" />
        </g>
      )
    case 'firewall':
      return (
        <g {...stroke}>
          <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
          <path d="M2.5 9.5h19M2.5 14.5h19M9 4.5v5M15 9.5v5M9 14.5v5" />
        </g>
      )
    case 'loadbalancer':
      return (
        <g {...stroke}>
          <rect x="2.5" y="9" width="19" height="6" rx="2" />
          <path d="M12 9V5M6 19v-4M18 19v-4M6 15h12" />
        </g>
      )
    case 'core-switch':
      return (
        <g {...stroke}>
          <rect x="2.5" y="8" width="19" height="9" rx="2" />
          <path d="M6 11.5h2.5M10.5 11.5H13M15 11.5h3M6 14h12" />
          <path d="M12 8V4.5M9.5 6.5 12 4l2.5 2.5" />
        </g>
      )
    case 'switch':
    case 'access-switch':
      return (
        <g {...stroke}>
          <rect x="2.5" y="9" width="19" height="7" rx="1.8" />
          <path d="M5.5 12.5h2M9 12.5h2M12.5 12.5h2M16 12.5h2.5" />
        </g>
      )
    case 'wifi':
      return (
        <g {...stroke}>
          <path d="M4 10.5a11 11 0 0 1 16 0M7 14a6.5 6.5 0 0 1 10 0" />
          <circle cx="12" cy="18" r="1.4" fill={color} stroke="none" />
        </g>
      )
    case 'server':
      return (
        <g {...stroke}>
          <rect x="4.5" y="3.5" width="15" height="7" rx="1.6" />
          <rect x="4.5" y="13.5" width="15" height="7" rx="1.6" />
          <path d="M7.5 7h1.5M7.5 17h1.5" />
          <circle cx="16" cy="7" r="0.9" fill={color} stroke="none" />
          <circle cx="16" cy="17" r="0.9" fill={color} stroke="none" />
        </g>
      )
    case 'storage':
      return (
        <g {...stroke}>
          <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
          <path d="M4.5 6v12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V6" />
          <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" />
        </g>
      )
    case 'workstation':
      return (
        <g {...stroke}>
          <rect x="3" y="4.5" width="18" height="11" rx="1.6" />
          <path d="M9 19.5h6M12 15.5v4" />
        </g>
      )
    case 'printer':
      return (
        <g {...stroke}>
          <path d="M7 8V3.5h10V8" />
          <rect x="3.5" y="8" width="17" height="8" rx="1.6" />
          <path d="M7 16v4.5h10V16" />
        </g>
      )
    case 'phone':
      return (
        <g {...stroke}>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
          <path d="M10 5.5h4M10.5 18.5h3" />
        </g>
      )
    case 'hypervisor':
      return (
        <g {...stroke}>
          <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
          <rect x="5.5" y="7.5" width="5" height="4" rx="0.8" />
          <rect x="13.5" y="7.5" width="5" height="4" rx="0.8" />
          <rect x="5.5" y="13.5" width="5" height="3" rx="0.8" />
          <rect x="13.5" y="13.5" width="5" height="3" rx="0.8" />
        </g>
      )
    case 'witness':
      return (
        <g {...stroke}>
          <path d="M12 4.5v15M7 19.5h10" />
          <path d="M4 9h16M4 9l-2.2 4.5a2.6 2.6 0 0 0 4.4 0Z" />
          <path d="M20 9l2.2 4.5a2.6 2.6 0 0 1-4.4 0Z" />
          <circle cx="12" cy="4.2" r="1.3" fill={color} stroke="none" />
        </g>
      )
    case 'backup':
      return (
        <g {...stroke}>
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <path d="M8.5 12a3.5 3.5 0 1 0 1.1-2.5" />
          <path d="M9.6 6.6v3h-3" />
        </g>
      )
    case 'ups':
      return (
        <g {...stroke}>
          <rect x="2.5" y="6.5" width="17" height="11" rx="2" />
          <path d="M19.5 10.5h2v3h-2" />
          <path d="M11.5 8.8 8.8 12.6h3l-.8 2.9 3.2-4h-3Z" fill={color} stroke="none" />
        </g>
      )
    case 'pdu':
      return (
        <g {...stroke}>
          <rect x="2.5" y="8.5" width="19" height="7" rx="1.8" />
          <circle cx="7" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="17" cy="12" r="1.5" />
        </g>
      )
    default:
      return (
        <g {...stroke}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </g>
      )
  }
}
