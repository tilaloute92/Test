/**
 * Marques constructeurs : un monogramme coloré par fabricant.
 *
 * Volontairement des **initiales dessinées par l'application**, et non les logos officiels :
 * un logo est une marque déposée, que l'on n'a pas le droit de redistribuer dans un logiciel
 * — et un schéma exporté vers un client ou un appel d'offres circule. Le monogramme, lui,
 * donne l'essentiel en un coup d'œil (« ce switch est un Cisco, celui-là un Aruba ») sans rien
 * emprunter à personne.
 *
 * Si vous tenez aux logos officiels, ils se posent en image dans le catalogue d'équipements —
 * c'est alors votre licence d'utilisation qui s'applique, pas celle de l'application.
 */

export interface VendorMark {
  /** Monogramme affiché sur la boîte : deux à quatre caractères. */
  code: string
  /** Couleur de la marque, reprise du constructeur. */
  color: string
  /** Nom complet, pour l'info-bulle. */
  label: string
}

/** Table des constructeurs connus, clé normalisée (sans accents, en minuscules). */
const MARKS: Record<string, VendorMark> = {
  cisco: { code: 'CIS', color: '#049fd9', label: 'Cisco' },
  meraki: { code: 'MER', color: '#00a4a6', label: 'Cisco Meraki' },
  dell: { code: 'DELL', color: '#007db8', label: 'Dell' },
  'dell emc': { code: 'DELL', color: '#007db8', label: 'Dell EMC' },
  hpe: { code: 'HPE', color: '#01a982', label: 'Hewlett Packard Enterprise' },
  hp: { code: 'HP', color: '#0096d6', label: 'HP' },
  aruba: { code: 'ARU', color: '#ff8300', label: 'Aruba (HPE)' },
  nutanix: { code: 'NTX', color: '#024da1', label: 'Nutanix' },
  'palo alto networks': { code: 'PAN', color: '#fa582d', label: 'Palo Alto Networks' },
  'palo alto': { code: 'PAN', color: '#fa582d', label: 'Palo Alto Networks' },
  fortinet: { code: 'FTN', color: '#da291c', label: 'Fortinet' },
  juniper: { code: 'JNP', color: '#84b135', label: 'Juniper Networks' },
  arista: { code: 'ARI', color: '#1f4f9c', label: 'Arista Networks' },
  'extreme networks': { code: 'EXT', color: '#5a2a82', label: 'Extreme Networks' },
  ubiquiti: { code: 'UBQ', color: '#0559c9', label: 'Ubiquiti' },
  'check point': { code: 'CKP', color: '#e6006e', label: 'Check Point' },
  sophos: { code: 'SPH', color: '#0083c7', label: 'Sophos' },
  stormshield: { code: 'STS', color: '#e2001a', label: 'Stormshield' },
  watchguard: { code: 'WG', color: '#d31245', label: 'WatchGuard' },
  sonicwall: { code: 'SNW', color: '#ff5e1a', label: 'SonicWall' },
  barracuda: { code: 'BAR', color: '#0072c6', label: 'Barracuda' },
  f5: { code: 'F5', color: '#e4002b', label: 'F5' },
  citrix: { code: 'CTX', color: '#452170', label: 'Citrix' },
  radware: { code: 'RDW', color: '#e2001a', label: 'Radware' },
  netapp: { code: 'NTA', color: '#0067c5', label: 'NetApp' },
  'pure storage': { code: 'PURE', color: '#fe5000', label: 'Pure Storage' },
  synology: { code: 'SYN', color: '#4c8fbd', label: 'Synology' },
  qnap: { code: 'QNAP', color: '#00a0e9', label: 'QNAP' },
  quantum: { code: 'QTM', color: '#00539b', label: 'Quantum' },
  veritas: { code: 'VRT', color: '#b1131b', label: 'Veritas' },
  rubrik: { code: 'RBK', color: '#00b2a9', label: 'Rubrik' },
  veeam: { code: 'VEE', color: '#00b336', label: 'Veeam' },
  apc: { code: 'APC', color: '#3dcd58', label: 'APC by Schneider Electric' },
  eaton: { code: 'EAT', color: '#005eb8', label: 'Eaton' },
  legrand: { code: 'LEG', color: '#e2001a', label: 'Legrand' },
  'schneider electric': { code: 'SE', color: '#3dcd58', label: 'Schneider Electric' },
  lenovo: { code: 'LNV', color: '#e2231a', label: 'Lenovo' },
  supermicro: { code: 'SMC', color: '#1b5faa', label: 'Supermicro' },
  nvidia: { code: 'NVDA', color: '#76b900', label: 'NVIDIA' },
  ibm: { code: 'IBM', color: '#0f62fe', label: 'IBM' },
  oracle: { code: 'ORA', color: '#c74634', label: 'Oracle' },
  xerox: { code: 'XRX', color: '#cf0a2c', label: 'Xerox' },
  yealink: { code: 'YEA', color: '#0072c6', label: 'Yealink' },
  axis: { code: 'AXIS', color: '#b39700', label: 'Axis Communications' },
  siemens: { code: 'SIE', color: '#009999', label: 'Siemens' },
  vmware: { code: 'VMW', color: '#607078', label: 'VMware' },
  microsoft: { code: 'MS', color: '#0078d4', label: 'Microsoft' },
  proxmox: { code: 'PVE', color: '#e57000', label: 'Proxmox' },
  mikrotik: { code: 'MT', color: '#293239', label: 'MikroTik' },
  'tp-link': { code: 'TPL', color: '#4acbd6', label: 'TP-Link' },
  netgear: { code: 'NTG', color: '#f47b20', label: 'Netgear' },
  zyxel: { code: 'ZYX', color: '#e2001a', label: 'Zyxel' },
  huawei: { code: 'HUA', color: '#cf0a2c', label: 'Huawei' },
  nokia: { code: 'NOK', color: '#124191', label: 'Nokia' },
  'alcatel-lucent': { code: 'ALE', color: '#0d4f8b', label: 'Alcatel-Lucent Enterprise' },
  'd-link': { code: 'DLK', color: '#006db7', label: 'D-Link' },
  'allied telesis': { code: 'AT', color: '#0b3c8c', label: 'Allied Telesis' },
  cloudflare: { code: 'CF', color: '#f38020', label: 'Cloudflare' },
  akamai: { code: 'AKA', color: '#0099cc', label: 'Akamai' },
  ovh: { code: 'OVH', color: '#123f6d', label: 'OVHcloud' },
  orange: { code: 'ORG', color: '#ff7900', label: 'Orange' },
  sfr: { code: 'SFR', color: '#e2001a', label: 'SFR' },
  bouygues: { code: 'BYT', color: '#0099d8', label: 'Bouygues Telecom' },
  free: { code: 'FREE', color: '#cd1e25', label: 'Free' },
}

function normalise(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Marque d'un équipement, à partir du constructeur ou, à défaut, du modèle.
 *
 * Beaucoup de parcs ne renseignent que le modèle (« Catalyst C9300-48P ») : on y retrouve
 * quand même le constructeur quand son nom y figure, sinon on reconnaît quelques gammes
 * suffisamment caractéristiques.
 */
export function vendorMark(vendor?: string, model?: string): VendorMark | null {
  const direct = vendor ? MARKS[normalise(vendor)] : undefined
  if (direct) return direct

  const texte = normalise([vendor, model].filter(Boolean).join(' '))
  if (!texte) return null

  for (const [cle, marque] of Object.entries(MARKS)) {
    if (texte.includes(cle)) return marque
  }

  // Gammes reconnaissables sans le nom du constructeur.
  const gammes: [RegExp, string][] = [
    [/\b(catalyst|nexus|isr |asr |firepower)\b/, 'cisco'],
    [/\b(fortigate|fortiswitch|fortiap|fortianalyzer)\b/, 'fortinet'],
    [/\b(procurve|aruba cx|instant on)\b/, 'aruba'],
    [/\b(poweredge|powerswitch|powerstore|powervault)\b/, 'dell'],
    [/\b(proliant|synergy|alletra|nimble)\b/, 'hpe'],
    [/\b(ex\d{4}|qfx|srx|mx\d{2,3})\b/, 'juniper'],
    [/\b(unifi|edgerouter|edgeswitch)\b/, 'ubiquiti'],
    [/\b(big-ip)\b/, 'f5'],
    [/\b(sns-|sn\d{3})\b/, 'stormshield'],
    [/\b(vsphere|esxi|vcenter|nsx)\b/, 'vmware'],
    [/\b(smart-ups|symmetra|galaxy vs)\b/, 'apc'],
    [/\b(9px|9sx|5px|ups eaton)\b/, 'eaton'],
  ]
  for (const [motif, cle] of gammes) {
    if (motif.test(texte)) return MARKS[cle]
  }
  return null
}

/** Liste des constructeurs reconnus, pour la documentation et les tests. */
export function knownVendors(): string[] {
  return [...new Set(Object.values(MARKS).map((marque) => marque.label))].sort((a, b) => a.localeCompare(b, 'fr'))
}
