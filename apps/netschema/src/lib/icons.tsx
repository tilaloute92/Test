import type { ReactNode } from 'react'

/**
 * Registre de pictogrammes, dessinés dans un carré de 24×24.
 *
 * Les types d'équipement ne dessinent pas leur icône : ils désignent une entrée de ce
 * registre par son identifiant. Ajouter un équipement au catalogue ne demande donc aucun
 * dessin tant qu'un pictogramme existant convient — c'est ce qui rend le catalogue
 * extensible par simple fichier de données.
 *
 * Tout est tracé avec des attributs de présentation explicites (pas de classes CSS) :
 * c'est ce qui permet au SVG exporté de rester fidèle à l'écran.
 */
const ICONS: Record<string, (color: string) => ReactNode> = {
  generic: () => <rect x="4" y="4" width="16" height="16" rx="2" />,

  // ─── Extérieur, opérateurs, cloud ───────────────────────────────────────────
  globe: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
    </>
  ),
  'globe-grid': () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17M6 6.5c3.5 2 8.5 2 12 0M6 17.5c3.5-2 8.5-2 12 0" />
    </>
  ),
  'globe-arrows': (color) => (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <circle cx="12" cy="12" r="1.6" fill={color} stroke="none" />
    </>
  ),
  cloud: () => <path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.8 10.2 3.9 3.9 0 0 0 7 18Z" />,
  'cloud-shield': () => (
    <>
      <path d="M6.5 15.5h4A3.4 3.4 0 0 0 11 8.8 4.8 4.8 0 0 0 6.3 8 3.4 3.4 0 0 0 6.5 15.5Z" />
      <path d="M17 8.5l4 1.6v3.3c0 2.4-1.7 4.4-4 5.1-2.3-.7-4-2.7-4-5.1v-3.3Z" />
    </>
  ),
  'cloud-link': () => (
    <>
      <path d="M7 14h9a3.5 3.5 0 0 0 .5-6.95A4.9 4.9 0 0 0 6.8 6.5 3.7 3.7 0 0 0 7 14Z" />
      <path d="M8 18.5h8M10.5 17v3M13.5 17v3" />
    </>
  ),
  satellite: () => (
    <>
      <path d="M3 13.5 10.5 6l4 4L7 17.5Z" />
      <path d="M13 3.5a7.5 7.5 0 0 1 7.5 7.5M13.5 7.2a3.8 3.8 0 0 1 3.4 3.4" />
      <path d="M5 15.5 3 21l5.5-2" />
    </>
  ),
  antenna: (color) => (
    <>
      <path d="M12 9.5V21M8.5 21h7" />
      <path d="M7.5 9a5.5 5.5 0 0 1 9 0M4.5 6.5a9.5 9.5 0 0 1 15 0" />
      <circle cx="12" cy="8" r="1.4" fill={color} stroke="none" />
    </>
  ),
  prism: () => (
    <>
      <path d="M9 3.5 2.5 19h13Z" />
      <path d="M15.5 9.5h6M15.5 12.5h6M15.5 15.5h6" />
    </>
  ),

  // ─── Routage, commutation, fabric ───────────────────────────────────────────
  router: () => (
    <>
      <rect x="2.5" y="13" width="19" height="7" rx="2" />
      <path d="M6 16.5h3M12 16.5h6" />
      <path d="M8 9.5 8 4m0 0 2 2M8 4 6 6" />
      <path d="M16 4v5.5m0 0 2-2m-2 2-2-2" />
    </>
  ),
  'router-cloud': () => (
    <>
      <rect x="2.5" y="14" width="19" height="6.5" rx="2" />
      <path d="M6 17.2h3M12 17.2h6" />
      <path d="M8 10.5h8a3 3 0 0 0 .4-5.95A4.2 4.2 0 0 0 7.9 5 3.1 3.1 0 0 0 8 10.5Z" />
    </>
  ),
  switch: () => (
    <>
      <rect x="2.5" y="9" width="19" height="7" rx="1.8" />
      <path d="M5.5 12.5h2M9 12.5h2M12.5 12.5h2M16 12.5h2.5" />
    </>
  ),
  'switch-core': () => (
    <>
      <rect x="2.5" y="8" width="19" height="9" rx="2" />
      <path d="M6 11.5h2.5M10.5 11.5H13M15 11.5h3M6 14h12" />
      <path d="M12 8V4.5M9.5 6.5 12 4l2.5 2.5" />
    </>
  ),
  spine: () => (
    <>
      <rect x="2.5" y="4" width="19" height="6" rx="1.6" />
      <path d="M6 7h2.5M11 7h2M15.5 7h2.5" />
      <path d="M6 10v4M12 10v4M18 10v4M4 17.5h16" />
    </>
  ),
  leaf: () => (
    <>
      <rect x="2.5" y="14" width="19" height="6" rx="1.6" />
      <path d="M6 17h2.5M11 17h2M15.5 17h2.5" />
      <path d="M6 14v-4M12 14v-4M18 14v-4M4 6.5h16" />
    </>
  ),
  mesh: (color) => (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h10M7 18h10M5 8v8M19 8v8M6.5 7.5l11 9M17.5 7.5l-11 9" />
      <circle cx="12" cy="12" r="1.2" fill={color} stroke="none" />
    </>
  ),
  split: () => (
    <>
      <path d="M2.5 12h6M15.5 7h6M15.5 17h6" />
      <path d="M8.5 12 15.5 7M8.5 12l7 5" />
      <circle cx="10" cy="12" r="1.6" />
    </>
  ),
  wifi: (color) => (
    <>
      <path d="M4 10.5a11 11 0 0 1 16 0M7 14a6.5 6.5 0 0 1 10 0" />
      <circle cx="12" cy="18" r="1.4" fill={color} stroke="none" />
    </>
  ),
  'gateway-api': () => (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M9 3.5v17" />
      <path d="M12.5 12h5M15.5 9.5 18 12l-2.5 2.5" />
    </>
  ),

  // ─── Sécurité ───────────────────────────────────────────────────────────────
  firewall: () => (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M2.5 9.5h19M2.5 14.5h19M9 4.5v5M15 9.5v5M9 14.5v5" />
    </>
  ),
  'firewall-plus': (color) => (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M2.5 9.5h19M2.5 14.5h19M9 4.5v5M9 14.5v5" />
      <path d="M16.5 10.5v3.5M14.75 12.25h3.5" stroke={color} />
    </>
  ),
  shield: () => <path d="M12 2.8 20 6v6c0 4.4-3.3 8.1-8 9.2-4.7-1.1-8-4.8-8-9.2V6Z" />,
  'shield-check': () => (
    <>
      <path d="M12 2.8 20 6v6c0 4.4-3.3 8.1-8 9.2-4.7-1.1-8-4.8-8-9.2V6Z" />
      <path d="m8.5 11.8 2.5 2.5 4.5-4.8" />
    </>
  ),
  'shield-lock': () => (
    <>
      <path d="M12 2.8 20 6v6c0 4.4-3.3 8.1-8 9.2-4.7-1.1-8-4.8-8-9.2V6Z" />
      <rect x="9" y="11" width="6" height="5" rx="1.2" />
      <path d="M10.5 11V9.8a1.5 1.5 0 0 1 3 0V11" />
    </>
  ),
  radar: (color) => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18 6.5" />
      <circle cx="12" cy="12" r="1.2" fill={color} stroke="none" />
    </>
  ),
  eye: () => (
    <>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  robot: (color) => (
    <>
      <rect x="4" y="7.5" width="16" height="11" rx="2.4" />
      <path d="M12 7.5V4M9.5 21h5" />
      <circle cx="9" cy="12.5" r="1.3" fill={color} stroke="none" />
      <circle cx="15" cy="12.5" r="1.3" fill={color} stroke="none" />
    </>
  ),
  key: () => (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3.5M15.5 12v2.5" />
    </>
  ),
  'badge-user': () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
      <circle cx="12" cy="10.5" r="2.4" />
      <path d="M8 16.5a4.3 4.3 0 0 1 8 0" />
    </>
  ),
  'lock-user': () => (
    <>
      <circle cx="9.5" cy="8" r="3" />
      <path d="M3.5 19a6 6 0 0 1 8.7-5.4" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.4" />
      <path d="M15.3 14v-1.4a1.7 1.7 0 0 1 3.4 0V14" />
    </>
  ),
  'laptop-shield': () => (
    <>
      <path d="M4 5.5h10.5v9H4Z" />
      <path d="M2 17.5h14" />
      <path d="M18 8.5l3.5 1.3v2.9c0 2-1.4 3.7-3.5 4.3-2.1-.6-3.5-2.3-3.5-4.3V9.8Z" />
    </>
  ),
  'mail-shield': () => (
    <>
      <rect x="2.5" y="6" width="13" height="10" rx="1.8" />
      <path d="m2.5 7.5 6.5 4.5 6.5-4.5" />
      <path d="M18.5 9.5l3 1.1v2.6c0 1.8-1.3 3.3-3 3.9-1.7-.6-3-2.1-3-3.9v-2.6Z" />
    </>
  ),
  funnel: () => (
    <>
      <path d="M3 5h18l-7 8v6l-4 2v-8Z" />
    </>
  ),
  bug: () => (
    <>
      <rect x="7.5" y="7.5" width="9" height="11" rx="4.5" />
      <path d="M7.5 11H4M7.5 15H4M16.5 11H20M16.5 15H20M9.5 7.5 8 5M14.5 7.5 16 5" />
    </>
  ),
  'doc-lock': () => (
    <>
      <path d="M5.5 3.5h8l5 5v12h-13Z" />
      <path d="M13.5 3.5v5h5" />
      <rect x="8.5" y="12.5" width="7" height="5" rx="1.2" />
      <path d="M10.3 12.5v-1.2a1.7 1.7 0 0 1 3.4 0v1.2" />
    </>
  ),
  'port-badge': () => (
    <>
      <rect x="2.5" y="8" width="12" height="8" rx="1.6" />
      <path d="M5.5 11.5h1.5M9 11.5h1.5M5.5 14h5" />
      <circle cx="18.5" cy="12" r="3.5" />
      <path d="M17 12l1.2 1.2 2.1-2.4" />
    </>
  ),
  'phone-shield': () => (
    <>
      <rect x="5" y="2.5" width="9" height="19" rx="2" />
      <path d="M8 5h3" />
      <path d="M18 9l3.2 1.2v2.9c0 2-1.3 3.7-3.2 4.3-1.9-.6-3.2-2.3-3.2-4.3v-2.9Z" />
    </>
  ),

  // ─── Serveurs, conteneurs, données ──────────────────────────────────────────
  server: (color) => (
    <>
      <rect x="4.5" y="3.5" width="15" height="7" rx="1.6" />
      <rect x="4.5" y="13.5" width="15" height="7" rx="1.6" />
      <path d="M7.5 7h1.5M7.5 17h1.5" />
      <circle cx="16" cy="7" r="0.9" fill={color} stroke="none" />
      <circle cx="16" cy="17" r="0.9" fill={color} stroke="none" />
    </>
  ),
  hypervisor: () => (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <rect x="5.5" y="7.5" width="5" height="4" rx="0.8" />
      <rect x="13.5" y="7.5" width="5" height="4" rx="0.8" />
      <rect x="5.5" y="13.5" width="5" height="3" rx="0.8" />
      <rect x="13.5" y="13.5" width="5" height="3" rx="0.8" />
    </>
  ),
  cube: () => (
    <>
      <path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7Z" />
      <path d="m3.5 7 8.5 4.6L20.5 7M12 11.6v9.6" />
    </>
  ),
  cubes: () => (
    <>
      <path d="M8 2.8 14 6v6l-6 3.2L2 12V6Z" />
      <path d="m2 6 6 3.2L14 6M8 9.2V15" />
      <path d="M16 10.5 22 13.7v5.6L16 22l-6-2.7v-5.6Z" />
    </>
  ),
  'cubes-control': (color) => (
    <>
      <path d="M12 2.5 19.5 6v7L12 16.5 4.5 13V6Z" />
      <path d="m4.5 6 7.5 3.5L19.5 6M12 9.5v7" />
      <circle cx="12" cy="20" r="2" fill={color} stroke="none" />
    </>
  ),
  registry: () => (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.4" />
      <rect x="3" y="13" width="18" height="6" rx="1.4" />
      <path d="M9 7h6M9 16h6" />
    </>
  ),
  lambda: () => <path d="M5.5 20.5 12.5 9 9 3.5M11 12.5l4.5 8" />,
  queue: () => (
    <>
      <rect x="2.5" y="8" width="5" height="8" rx="1.2" />
      <rect x="9.5" y="8" width="5" height="8" rx="1.2" />
      <rect x="16.5" y="8" width="5" height="8" rx="1.2" />
    </>
  ),
  database: () => (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V6" />
      <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" />
    </>
  ),
  bucket: () => (
    <>
      <path d="M4 6h16l-1.6 14.5H5.6Z" />
      <path d="M4 6a8 3 0 0 1 16 0" />
    </>
  ),
  tape: (color) => (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8.5" cy="11" r="2.6" />
      <circle cx="15.5" cy="11" r="2.6" />
      <path d="M6 16.5h12" stroke={color} />
    </>
  ),
  gpu: (color) => (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="1.8" />
      <rect x="5.5" y="10" width="5" height="4" rx="0.8" />
      <circle cx="16" cy="12" r="2.4" />
      <path d="M6 17v3M18 17v3" stroke={color} />
    </>
  ),
  chip: () => (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 6V3.5M15 6V3.5M9 18v2.5M15 18v2.5M6 9H3.5M6 15H3.5M18 9h2.5M18 15h2.5" />
    </>
  ),
  rack: () => (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="1.8" />
      <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" />
      <path d="M7 5h3M7 9.8h3M7 14.2h3M7 19h3" />
    </>
  ),
  balance: (color) => (
    <>
      <path d="M12 4.5v15M7 19.5h10" />
      <path d="M4 9h16M4 9l-2.2 4.5a2.6 2.6 0 0 0 4.4 0Z" />
      <path d="M20 9l2.2 4.5a2.6 2.6 0 0 1-4.4 0Z" />
      <circle cx="12" cy="4.2" r="1.3" fill={color} stroke="none" />
    </>
  ),
  'load-balancer': () => (
    <>
      <rect x="2.5" y="9" width="19" height="6" rx="2" />
      <path d="M12 9V5M6 19v-4M18 19v-4M6 15h12" />
    </>
  ),
  backup: () => (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M8.5 12a3.5 3.5 0 1 0 1.1-2.5" />
      <path d="M9.6 6.6v3h-3" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  'address-book': () => (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M2.5 8h2.5M2.5 12h2.5M2.5 16h2.5" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M8.8 16a3.6 3.6 0 0 1 6.4 0" />
    </>
  ),
  gauge: (color) => (
    <>
      <path d="M3.5 17a9 9 0 1 1 17 0" />
      <path d="M12 17 16 9" />
      <circle cx="12" cy="17" r="1.4" fill={color} stroke="none" />
    </>
  ),

  // ─── Utilisateurs & périphériques ───────────────────────────────────────────
  workstation: () => (
    <>
      <rect x="3" y="4.5" width="18" height="11" rx="1.6" />
      <path d="M9 19.5h6M12 15.5v4" />
    </>
  ),
  printer: () => (
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="3.5" y="8" width="17" height="8" rx="1.6" />
      <path d="M7 16v4.5h10V16" />
    </>
  ),
  phone: () => (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
      <path d="M10 5.5h4M10.5 18.5h3" />
    </>
  ),
  camera: () => (
    <>
      <path d="M3 8.5h9.5v7H3Z" />
      <path d="m12.5 11 5-2.5v7l-5-2.5" />
      <path d="M5 15.5v4" />
    </>
  ),

  // ─── Énergie & environnement ────────────────────────────────────────────────
  ups: (color) => (
    <>
      <rect x="2.5" y="6.5" width="17" height="11" rx="2" />
      <path d="M19.5 10.5h2v3h-2" />
      <path d="M11.5 8.8 8.8 12.6h3l-.8 2.9 3.2-4h-3Z" fill={color} stroke="none" />
    </>
  ),
  pdu: () => (
    <>
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.8" />
      <circle cx="7" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="17" cy="12" r="1.5" />
    </>
  ),
  generator: (color) => (
    <>
      <rect x="2.5" y="8" width="19" height="10" rx="2" />
      <path d="M6 8V5.5h5V8" />
      <path d="M13.5 10.5 11 14h2.5l-.7 2.6 3-3.6h-2.4Z" fill={color} stroke="none" />
    </>
  ),
  snowflake: () => (
    <>
      <path d="M12 2.5v19M3.5 7.2l17 9.6M20.5 7.2l-17 9.6" />
      <path d="M12 6.5 9.8 4.6M12 6.5l2.2-1.9M12 17.5l-2.2 1.9M12 17.5l2.2 1.9" />
    </>
  ),
  // ─── Sans fil piloté, voix, brassage, industriel ────────────────────────────
  'wlan-controller': () => (
    <>
      <rect x="2.5" y="12.5" width="19" height="8" rx="1.8" />
      <path d="M6 16.5h3M15 16.5h3" />
      <path d="M6.5 8.5a7.5 7.5 0 0 1 11 0M9 11a4 4 0 0 1 6 0" />
    </>
  ),
  'net-controller': () => (
    <>
      <rect x="3" y="3" width="18" height="9.5" rx="2" />
      <circle cx="12" cy="7.75" r="2" />
      <path d="M12 12.5v3.5M6 21v-3.5h12V21" />
    </>
  ),
  'san-switch': () => (
    <>
      <rect x="2.5" y="8" width="19" height="8.5" rx="2" />
      <path d="m8.5 10.3-2.2 1.95 2.2 1.95M15.5 10.3l2.2 1.95-2.2 1.95" />
      <path d="M11 12.25h2" />
    </>
  ),
  'din-switch': () => (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.4" />
      <path d="M7 8.5h10M7 12h6" />
      <path d="M2.5 19.5h19M8 16v3.5M16 16v3.5" />
    </>
  ),
  'patch-panel': () => (
    <>
      <rect x="2" y="7.5" width="20" height="9" rx="1.5" />
      <path d="M4.8 10.8h2.6v2.4H4.8ZM9 10.8h2.6v2.4H9ZM13.2 10.8h2.6v2.4h-2.6ZM17.4 10.8H20v2.4h-2.6Z" />
    </>
  ),
  fiber: (color) => (
    <>
      <path d="M2.5 12h5M16.5 12h5" />
      <rect x="7.5" y="8" width="9" height="8" rx="1.6" />
      <circle cx="12" cy="12" r="1.3" fill={color} stroke="none" />
    </>
  ),
  console: () => (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="m6.5 9.5 3 2.5-3 2.5M12 15h5" />
    </>
  ),
  modem: (color) => (
    <>
      <rect x="2.5" y="12" width="19" height="7.5" rx="2" />
      <path d="M6 15.8h1.5M10 15.8h1.5" />
      <circle cx="18" cy="15.8" r="1.2" fill={color} stroke="none" />
      <path d="M8.5 9a5.5 5.5 0 0 1 7 0M5.5 6a10 10 0 0 1 13 0" />
    </>
  ),
  'dish-link': (color) => (
    <>
      <path d="M3 8.5v7L7.5 12Z" />
      <path d="M21 8.5v7L16.5 12Z" />
      <path d="M9.6 12h1.2M13.2 12h1.2" />
      <circle cx="12" cy="12" r="0.9" fill={color} stroke="none" />
    </>
  ),
  tunnel: () => (
    <>
      <path d="M4 18.5v-4.5a8 8 0 0 1 16 0v4.5" />
      <path d="M9 18.5V14a3 3 0 0 1 6 0v4.5" />
      <path d="M2.5 18.5h19" />
    </>
  ),
  pbx: () => (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M8 9.5c0 3.4 2.8 6.2 6.2 6.2l1.3-1.8-2.3-1.4-1 .9a6 6 0 0 1-1.9-1.9l.9-1L9.8 8.2Z" />
    </>
  ),
  'voice-gateway': () => (
    <>
      <rect x="2.5" y="8.5" width="19" height="8" rx="2" />
      <path d="M6.5 11c0 2.4 1.9 4.3 4.3 4.3l.9-1.3-1.6-1-.7.6a4 4 0 0 1-1.3-1.3l.6-.7-1-1.6Z" />
      <path d="M14.5 12.5h5M17.5 10.5l2 2-2 2" />
    </>
  ),
  visio: () => (
    <>
      <rect x="2.5" y="4" width="19" height="12" rx="2" />
      <circle cx="12" cy="8.5" r="1.8" />
      <path d="M8.5 13.5c.7-1.7 2-2.6 3.5-2.6s2.8.9 3.5 2.6" />
      <path d="M8 19.5h8M12 16v3.5" />
    </>
  ),
}

export interface DeviceIconProps {
  icon: string
  color: string
}

export function DeviceIcon({ icon, color }: DeviceIconProps) {
  const draw = ICONS[icon] ?? ICONS.generic
  return (
    <g stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {draw(color)}
    </g>
  )
}

export function hasIcon(icon: string): boolean {
  return icon in ICONS
}

export function iconIds(): string[] {
  return Object.keys(ICONS).sort()
}
