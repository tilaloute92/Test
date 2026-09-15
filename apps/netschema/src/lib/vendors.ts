/**
 * Base de matériels constructeurs.
 *
 * Elle sert à remplir une fiche d'inventaire en deux clics : choisir « Dell — PowerEdge
 * R660 » renseigne le constructeur, le modèle, la hauteur en U et une consommation
 * indicative, et aligne le type d'équipement.
 *
 * Les hauteurs sont celles des châssis ; les puissances sont des ordres de grandeur en
 * fonctionnement, pas des valeurs de plaque — elles restent modifiables équipement par
 * équipement. La liste s'étend sans recompiler : un lot de catalogue (voir
 * `catalogSource.ts`) peut apporter ses propres modèles.
 */

export interface HardwareModel {
  vendor: string
  model: string
  /** Type d'équipement du catalogue (voir catalogData.ts). */
  kind: string
  /** Hauteur en baie, en U. */
  heightU?: number
  /** Consommation indicative en fonctionnement, en watts. */
  powerW?: number
  /** Description courte : ports, capacité, débit. */
  spec?: string
}

const m = (
  vendor: string,
  model: string,
  kind: string,
  heightU?: number,
  powerW?: number,
  spec?: string,
): HardwareModel => ({ vendor, model, kind, heightU, powerW, spec })

const BUILTIN: HardwareModel[] = [
  // ── Cisco ────────────────────────────────────────────────────────────────
  m('Cisco', 'Catalyst C9200-24P', 'access-switch', 1, 180, '24× 1G PoE+ · 4× 1G SFP'),
  m('Cisco', 'Catalyst C9200-48P', 'access-switch', 1, 260, '48× 1G PoE+ · 4× 10G SFP+'),
  m('Cisco', 'Catalyst C9300-24T', 'switch', 1, 210, '24× 1G · modules 10G/25G'),
  m('Cisco', 'Catalyst C9300-48P', 'switch', 1, 260, '48× 1G PoE+ · modules 10G/25G'),
  m('Cisco', 'Catalyst C9300X-24Y', 'switch', 1, 300, '24× 25G SFP28'),
  m('Cisco', 'Catalyst C9400 (châssis 4 slots)', 'core-switch', 6, 900, 'Châssis modulaire · supervision redondée'),
  m('Cisco', 'Catalyst C9500-24Y4C', 'core-switch', 1, 350, '24× 25G · 4× 100G'),
  m('Cisco', 'Catalyst C9500-48Y4C', 'core-switch', 1, 430, '48× 25G · 4× 100G'),
  m('Cisco', 'Catalyst C9600 (châssis 6 slots)', 'core-switch', 10, 1600, 'Châssis cœur modulaire'),
  m('Cisco', 'Nexus 93180YC-FX3', 'leaf', 1, 400, '48× 25G · 6× 100G · VXLAN/EVPN'),
  m('Cisco', 'Nexus 9336C-FX2', 'spine', 1, 500, '36× 100G · fabric spine'),
  m('Cisco', 'Nexus 9364C', 'spine', 2, 800, '64× 100G'),
  m('Cisco', 'ISR 4331', 'router', 1, 90, 'WAN modulaire · 3× 1G'),
  m('Cisco', 'ISR 4451', 'router', 2, 150, 'WAN modulaire · 4× 1G'),
  m('Cisco', 'Catalyst 8300-1N1S-4T2X', 'sdwan', 1, 120, 'SD-WAN · 4× 1G · 2× 10G'),
  m('Cisco', 'ASR 1001-HX', 'router', 1, 250, 'Routeur de périphérie haut débit'),
  m('Cisco', 'Firepower 1140', 'ngfw', 1, 120, 'NGFW · ~2 Gb/s inspection'),
  m('Cisco', 'Firepower 2130', 'ngfw', 1, 250, 'NGFW · ~5 Gb/s inspection'),
  m('Cisco', 'Secure Firewall 3120', 'ngfw', 1, 350, 'NGFW · ~20 Gb/s inspection'),
  m('Cisco', 'Meraki MS130-48', 'access-switch', 1, 200, '48× 1G PoE+ · pilotage cloud'),
  m('Cisco', 'Meraki MX95', 'ngfw', 1, 120, 'SD-WAN + pare-feu cloud'),
  m('Cisco', 'Meraki MR46', 'wifi7', undefined, 25, 'Borne Wi-Fi 6 · PoE+'),
  m('Cisco', 'Catalyst 9166 (CW9166I)', 'wifi7', undefined, 30, 'Borne Wi-Fi 6E · PoE+'),
  m('Cisco', 'IP Phone 8851', 'phone', undefined, 8, 'Téléphone IP · PoE'),
  m('Cisco', 'UCS C240 M7', 'server', 2, 700, 'Serveur rack 2U'),

  // ── Dell Technologies ────────────────────────────────────────────────────
  m('Dell', 'PowerEdge R360', 'server', 1, 350, 'Serveur rack 1U · 1 socket'),
  m('Dell', 'PowerEdge R660', 'server', 1, 650, 'Serveur rack 1U · 2 sockets'),
  m('Dell', 'PowerEdge R760', 'server', 2, 800, 'Serveur rack 2U · 2 sockets'),
  m('Dell', 'PowerEdge R760xa (GPU)', 'gpu-server', 2, 1600, '2U · jusqu’à 4 GPU'),
  m('Dell', 'PowerEdge R860', 'server', 2, 1100, 'Serveur rack 2U · 4 sockets'),
  m('Dell', 'PowerEdge R960', 'server', 4, 1600, 'Serveur rack 4U · 4 sockets'),
  m('Dell', 'PowerEdge T560 (tour)', 'server', 5, 700, 'Serveur tour convertible 5U'),
  m('Dell', 'PowerEdge XE9680 (IA)', 'gpu-server', 6, 10000, '6U · 8 GPU · calcul IA'),
  m('Dell', 'PowerStore 500T', 'storage', 2, 700, 'Baie unifiée NVMe'),
  m('Dell', 'PowerStore 1200T', 'storage', 2, 900, 'Baie unifiée NVMe'),
  m('Dell', 'PowerVault ME5024', 'storage', 2, 600, 'Baie SAN 24× 2,5"'),
  m('Dell', 'Unity XT 380F', 'storage', 2, 750, 'Baie unifiée full-flash'),
  m('Dell', 'PowerSwitch S5248F-ON', 'leaf', 1, 350, '48× 25G · 4× 100G'),
  m('Dell', 'PowerSwitch N3224P-ON', 'access-switch', 1, 200, '24× 1G PoE+'),

  // ── HPE ──────────────────────────────────────────────────────────────────
  m('HPE', 'ProLiant DL20 Gen11', 'server', 1, 250, 'Serveur rack 1U · 1 socket'),
  m('HPE', 'ProLiant DL360 Gen11', 'server', 1, 600, 'Serveur rack 1U · 2 sockets'),
  m('HPE', 'ProLiant DL380 Gen11', 'server', 2, 800, 'Serveur rack 2U · 2 sockets'),
  m('HPE', 'ProLiant DL580 Gen11', 'server', 4, 1500, 'Serveur rack 4U · 4 sockets'),
  m('HPE', 'Apollo 6500 Gen11 (IA)', 'gpu-server', 5, 6000, 'Calcul GPU'),
  m('HPE', 'Alletra MP', 'storage', 2, 900, 'Baie NVMe'),
  m('HPE', 'Nimble HF40', 'storage', 4, 800, 'Baie hybride'),
  m('HPE', 'MSA 2060', 'storage', 2, 550, 'Baie SAN d’entrée de gamme'),
  m('HPE', 'StoreOnce 3660', 'backup', 2, 700, 'Sauvegarde avec déduplication'),
  m('HPE', 'SimpliVity 380 Gen11', 'hci', 2, 850, 'Nœud hyperconvergé'),

  // ── Aruba (HPE Networking) ───────────────────────────────────────────────
  m('Aruba', 'CX 6100-48G', 'access-switch', 1, 180, '48× 1G · 4× 10G SFP+'),
  m('Aruba', 'CX 6300M-48G PoE', 'switch', 1, 260, '48× 1G PoE+ · 4× 50G'),
  m('Aruba', 'CX 6400 (châssis)', 'core-switch', 5, 1200, 'Châssis modulaire'),
  m('Aruba', 'CX 8325-48Y8C', 'leaf', 1, 380, '48× 25G · 8× 100G'),
  m('Aruba', 'CX 10000-48Y6C', 'leaf', 1, 450, '48× 25G · DPU Pensando'),
  m('Aruba', 'AP-635', 'wifi7', undefined, 25, 'Borne Wi-Fi 6E · PoE+'),
  m('Aruba', 'AP-735', 'wifi7', undefined, 30, 'Borne Wi-Fi 7 · PoE++'),
  m('Aruba', 'ClearPass C3010', 'nac', 1, 300, 'Contrôle d’accès NAC / RADIUS'),

  // ── Nutanix ──────────────────────────────────────────────────────────────
  m('Nutanix', 'NX-1065-G9', 'hci', 2, 700, 'Nœud hyperconvergé · 1 nœud/2U'),
  m('Nutanix', 'NX-3060-G9', 'hci', 2, 900, 'Nœud hyperconvergé polyvalent'),
  m('Nutanix', 'NX-3155G-G9', 'hci', 2, 1100, 'Nœud dense · GPU possible'),
  m('Nutanix', 'NX-8035-G9', 'hci', 2, 1000, 'Nœud orienté stockage'),
  m('Nutanix', 'NX-8155-G9', 'hci', 2, 1200, 'Nœud haute capacité'),

  // ── Palo Alto Networks ───────────────────────────────────────────────────
  m('Palo Alto Networks', 'PA-410', 'ngfw', 1, 30, 'NGFW agence · ~1,2 Gb/s'),
  m('Palo Alto Networks', 'PA-450', 'ngfw', 1, 60, 'NGFW agence · ~3 Gb/s'),
  m('Palo Alto Networks', 'PA-1410', 'ngfw', 1, 150, 'NGFW · ~9 Gb/s'),
  m('Palo Alto Networks', 'PA-3420', 'ngfw', 1, 300, 'NGFW · ~20 Gb/s'),
  m('Palo Alto Networks', 'PA-5420', 'ngfw', 2, 700, 'NGFW datacenter · ~60 Gb/s'),
  m('Palo Alto Networks', 'PA-7050', 'ngfw', 9, 2500, 'Châssis NGFW opérateur'),
  m('Palo Alto Networks', 'Panorama M-600', 'siem', 2, 500, 'Administration centralisée'),

  // ── Fortinet ─────────────────────────────────────────────────────────────
  m('Fortinet', 'FortiGate 40F', 'ngfw', 1, 20, 'NGFW agence'),
  m('Fortinet', 'FortiGate 60F', 'ngfw', 1, 25, 'NGFW agence · SD-WAN'),
  m('Fortinet', 'FortiGate 100F', 'ngfw', 1, 70, 'NGFW site moyen'),
  m('Fortinet', 'FortiGate 200F', 'ngfw', 1, 110, 'NGFW site moyen'),
  m('Fortinet', 'FortiGate 600F', 'ngfw', 1, 250, 'NGFW datacenter'),
  m('Fortinet', 'FortiGate 1800F', 'ngfw', 2, 500, 'NGFW datacenter haut débit'),
  m('Fortinet', 'FortiSwitch 248E-FPOE', 'access-switch', 1, 240, '48× 1G PoE+'),
  m('Fortinet', 'FortiSwitch 1048E', 'switch', 1, 350, '48× 10G SFP+'),
  m('Fortinet', 'FortiAP 431F', 'wifi7', undefined, 25, 'Borne Wi-Fi 6'),
  m('Fortinet', 'FortiAnalyzer 400G', 'siem', 1, 250, 'Journalisation et analyse'),

  // ── Juniper ──────────────────────────────────────────────────────────────
  m('Juniper', 'EX2300-48P', 'access-switch', 1, 200, '48× 1G PoE+'),
  m('Juniper', 'EX4400-48MP', 'switch', 1, 300, '48× multigigabit PoE++'),
  m('Juniper', 'QFX5120-48Y', 'leaf', 1, 380, '48× 25G · 8× 100G · EVPN/VXLAN'),
  m('Juniper', 'QFX5220-32CD', 'spine', 1, 550, '32× 400G'),
  m('Juniper', 'SRX345', 'ngfw', 1, 70, 'Pare-feu agence'),
  m('Juniper', 'SRX1600', 'ngfw', 1, 300, 'Pare-feu datacenter'),
  m('Juniper', 'MX204', 'router', 1, 400, 'Routeur opérateur compact'),
  m('Juniper', 'Mist AP45', 'wifi7', undefined, 30, 'Borne Wi-Fi 6E pilotée cloud'),

  // ── Arista / Extreme / Ubiquiti ──────────────────────────────────────────
  m('Arista', '7050SX3-48YC8', 'leaf', 1, 350, '48× 25G · 8× 100G'),
  m('Arista', '7280CR3-32P4', 'spine', 1, 600, '32× 100G · 4× 400G'),
  m('Arista', '720XP-48ZC2', 'switch', 1, 280, '48× multigigabit PoE'),
  m('Extreme Networks', 'X440-G2-48p', 'access-switch', 1, 190, '48× 1G PoE+'),
  m('Extreme Networks', 'X690-48x', 'core-switch', 1, 330, '48× 10G · 8× 100G'),
  m('Ubiquiti', 'UniFi USW-Pro-48-PoE', 'access-switch', 1, 180, '48× 1G PoE+ · 4× 10G'),
  m('Ubiquiti', 'UniFi Dream Machine Pro', 'router', 1, 50, 'Routeur + contrôleur'),
  m('Ubiquiti', 'UniFi U7 Pro', 'wifi7', undefined, 25, 'Borne Wi-Fi 7'),

  // ── Sécurité (autres éditeurs) ───────────────────────────────────────────
  m('Check Point', 'Quantum 3800', 'ngfw', 1, 150, 'NGFW site moyen'),
  m('Check Point', 'Quantum 6600', 'ngfw', 1, 250, 'NGFW datacenter'),
  m('Sophos', 'XGS 3300', 'ngfw', 1, 90, 'NGFW site moyen'),
  m('Sophos', 'XGS 5500', 'ngfw', 1, 180, 'NGFW datacenter'),
  m('Stormshield', 'SN-M-Series-720', 'ngfw', 1, 80, 'NGFW qualifié ANSSI'),
  m('Stormshield', 'SN-L-Series-2200', 'ngfw', 1, 200, 'NGFW datacenter'),
  m('WatchGuard', 'Firebox M590', 'ngfw', 1, 90, 'NGFW site moyen'),
  m('F5', 'BIG-IP i4800', 'loadbalancer', 1, 400, 'ADC / répartiteur applicatif'),
  m('F5', 'BIG-IP rSeries r5900', 'loadbalancer', 1, 650, 'ADC haute performance'),
  m('Citrix', 'ADC MPX 5900', 'loadbalancer', 1, 350, 'ADC / répartiteur'),
  m('Radware', 'Alteon 6420', 'loadbalancer', 1, 300, 'ADC'),

  // ── Stockage & sauvegarde ────────────────────────────────────────────────
  m('NetApp', 'AFF A150', 'storage', 2, 500, 'Baie full-flash d’entrée de gamme'),
  m('NetApp', 'AFF A250', 'storage', 2, 800, 'Baie full-flash'),
  m('NetApp', 'AFF A400', 'storage', 4, 1200, 'Baie full-flash datacenter'),
  m('NetApp', 'FAS2820', 'storage', 2, 700, 'Baie hybride'),
  m('Pure Storage', 'FlashArray //X20 R4', 'storage', 3, 900, 'Baie NVMe'),
  m('Pure Storage', 'FlashArray //X50 R4', 'storage', 3, 1200, 'Baie NVMe'),
  m('Pure Storage', 'FlashBlade //S200', 'object-storage', 5, 2000, 'Stockage fichier et objet'),
  m('Synology', 'RS2423RP+', 'storage', 2, 250, 'NAS rack 12 baies · alim redondée'),
  m('Synology', 'RS4021xs+', 'storage', 3, 350, 'NAS rack 16 baies'),
  m('QNAP', 'TS-h1290FX', 'storage', 2, 300, 'NAS full-flash'),
  m('Quantum', 'Scalar i3 (bandothèque)', 'tape-backup', 3, 400, 'Bandothèque LTO'),
  m('Dell', 'PowerVault TL1000 (LTO-9)', 'tape-backup', 1, 100, 'Chargeur automatique LTO-9'),
  m('Veritas', 'NetBackup 5250', 'backup', 2, 700, 'Appliance de sauvegarde'),
  m('Rubrik', 'R6410', 'backup', 2, 900, 'Sauvegarde immuable'),

  // ── Énergie & environnement ──────────────────────────────────────────────
  m('APC', 'Smart-UPS SRT 3000VA', 'ups', 2, undefined, 'Onduleur en ligne 3 kVA'),
  m('APC', 'Smart-UPS SRT 5000VA', 'ups', 3, undefined, 'Onduleur en ligne 5 kVA'),
  m('APC', 'Smart-UPS SRT 8000VA', 'ups', 6, undefined, 'Onduleur en ligne 8 kVA'),
  m('APC', 'Rack PDU AP8853', 'pdu', 1, undefined, 'PDU mesurée 16A · 21 prises'),
  m('APC', 'Rack PDU AP8959 (commutée)', 'pdu', 1, undefined, 'PDU commutée par prise'),
  m('Eaton', '9PX 6000i', 'ups', 3, undefined, 'Onduleur en ligne 6 kVA'),
  m('Eaton', '5PX G2 3000i', 'ups', 2, undefined, 'Onduleur line-interactive 3 kVA'),
  m('Eaton', 'ePDU G3 Managed', 'pdu', 1, undefined, 'PDU pilotable'),
  m('Legrand', 'Keor MOD 20 kVA', 'ups', 12, undefined, 'Onduleur modulaire'),
  m('Schneider Electric', 'Uniflair InRow RC', 'cooling', 42, undefined, 'Climatisation en rangée'),

  // ── Serveurs & divers ────────────────────────────────────────────────────
  m('Lenovo', 'ThinkSystem SR630 V3', 'server', 1, 600, 'Serveur rack 1U'),
  m('Lenovo', 'ThinkSystem SR650 V3', 'server', 2, 800, 'Serveur rack 2U'),
  m('Lenovo', 'ThinkAgile HX (Nutanix)', 'hci', 2, 900, 'Nœud hyperconvergé'),
  m('Supermicro', 'SYS-121H-TNR', 'server', 1, 650, 'Serveur rack 1U'),
  m('Supermicro', 'SYS-421GE-TNRT (IA)', 'gpu-server', 4, 5000, '4U · 8 GPU'),
  m('NVIDIA', 'DGX H200', 'gpu-server', 8, 10200, 'Serveur IA 8 GPU'),
  m('IBM', 'Power S1022', 'server', 2, 900, 'Serveur Power'),
  m('HP', 'LaserJet Enterprise M612dn', 'printer', undefined, 800, 'Imprimante A4 réseau'),
  m('Xerox', 'AltaLink C8145', 'printer', undefined, 1500, 'Multifonction A3'),
  m('Yealink', 'T46U', 'phone', undefined, 6, 'Téléphone IP · PoE'),
  m('Axis', 'P3268-LV', 'camera', undefined, 12, 'Caméra IP dôme · PoE'),
  m('Siemens', 'SIMATIC S7-1500', 'plc', undefined, 30, 'Automate industriel'),
  m('Schneider Electric', 'Modicon M340', 'plc', undefined, 25, 'Automate industriel'),
]

const registry: HardwareModel[] = [...BUILTIN]

/** Ajoute des modèles venus d'un lot de catalogue (mise à jour sans recompilation). */
export function registerModels(models: HardwareModel[]) {
  for (const model of models) {
    const index = registry.findIndex(
      (item) => item.vendor === model.vendor && item.model === model.model,
    )
    if (index >= 0) registry[index] = model
    else registry.push(model)
  }
}

export function allModels(): HardwareModel[] {
  return registry
}

export function vendors(): string[] {
  return [...new Set(registry.map((item) => item.vendor))].sort((a, b) => a.localeCompare(b))
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Recherche un matériel par constructeur, modèle ou caractéristique. Quand un type
 * d'équipement est fourni, les modèles de ce type passent devant sans masquer les autres :
 * un switch mal typé reste trouvable.
 */
export function searchModels(query: string, kind?: string, limit = 40): HardwareModel[] {
  const q = normalize(query.trim())
  const scored = registry
    .map((item) => {
      const haystack = normalize(`${item.vendor} ${item.model} ${item.spec ?? ''}`)
      let score = -1
      if (!q) score = 0
      else if (normalize(item.model).startsWith(q) || normalize(item.vendor).startsWith(q)) score = 80
      else if (haystack.includes(q)) score = 50
      if (score < 0) return null
      if (kind && item.kind === kind) score += 30
      return { item, score }
    })
    .filter((entry): entry is { item: HardwareModel; score: number } => entry !== null)

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.vendor.localeCompare(b.item.vendor) ||
        a.item.model.localeCompare(b.item.model),
    )
    .slice(0, limit)
    .map((entry) => entry.item)
}

/** Retrouve un matériel à partir d'un couple constructeur / modèle déjà saisi. */
export function findModel(vendor?: string, model?: string): HardwareModel | undefined {
  if (!model?.trim()) return undefined
  const wantedModel = normalize(model)
  const wantedVendor = vendor ? normalize(vendor) : null
  return registry.find(
    (item) =>
      normalize(item.model) === wantedModel && (!wantedVendor || normalize(item.vendor) === wantedVendor),
  )
}
