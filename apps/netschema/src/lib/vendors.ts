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
  // ── Contrôleurs Wi-Fi & pilotage réseau ──────────────────────────────────
  m('Cisco', 'Catalyst 9800-L-C', 'wlan-controller', 1, 130, 'Contrôleur Wi-Fi · jusqu’à 250 bornes'),
  m('Cisco', 'Catalyst 9800-40', 'wlan-controller', 1, 250, 'Contrôleur Wi-Fi · jusqu’à 2 000 bornes'),
  m('Cisco', 'Catalyst 9800-80', 'wlan-controller', 2, 500, 'Contrôleur Wi-Fi · jusqu’à 6 000 bornes'),
  m('Cisco', 'Catalyst 9800-CL (virtuel)', 'wlan-controller', undefined, undefined, 'Contrôleur Wi-Fi virtualisé'),
  m('Cisco', 'Catalyst Center DN2-HW-APL', 'net-controller', 1, 700, 'Pilotage et automatisation du réseau'),
  m('Cisco', 'APIC-M4 (ACI)', 'net-controller', 1, 650, 'Contrôleur de fabric ACI'),
  m('Cisco', 'Meraki MR57', 'wifi7', undefined, 30, 'Borne Wi-Fi 6E pilotée cloud'),
  m('Aruba', '7030 (contrôleur)', 'wlan-controller', 1, 90, 'Contrôleur Wi-Fi · 64 bornes'),
  m('Aruba', '7210 (contrôleur)', 'wlan-controller', 1, 180, 'Contrôleur Wi-Fi · 512 bornes'),
  m('Aruba', '9012 (passerelle)', 'wlan-controller', 1, 120, 'Passerelle Wi-Fi et SD-Branch'),
  m('Aruba', 'Mobility Conductor (virtuel)', 'net-controller', undefined, undefined, 'Pilotage centralisé des contrôleurs'),
  m('Ruckus', 'SmartZone 144', 'wlan-controller', 1, 150, 'Contrôleur Wi-Fi · 1 024 bornes'),
  m('Ruckus', 'ZoneDirector 1200', 'wlan-controller', 1, 60, 'Contrôleur Wi-Fi site moyen'),
  m('Ruckus', 'R770', 'wifi7', undefined, 30, 'Borne Wi-Fi 7 · PoE++'),
  m('Juniper', 'Mist Edge X10', 'wlan-controller', 1, 150, 'Terminaison des tunnels Wi-Fi Mist'),
  m('Juniper', 'Mist AP47', 'wifi7', undefined, 30, 'Borne Wi-Fi 7 pilotée cloud'),
  m('Huawei', 'AC6508', 'wlan-controller', 1, 60, 'Contrôleur Wi-Fi · 256 bornes'),
  m('Huawei', 'AC6805', 'wlan-controller', 1, 180, 'Contrôleur Wi-Fi · 6 144 bornes'),
  m('Huawei', 'AirEngine 8771-X1T', 'wifi7', undefined, 40, 'Borne Wi-Fi 7 haute densité'),
  m('Fortinet', 'FortiWLC-500D', 'wlan-controller', 1, 100, 'Contrôleur Wi-Fi'),
  m('Fortinet', 'FortiAP 441K', 'wifi7', undefined, 30, 'Borne Wi-Fi 7'),
  m('Extreme Networks', 'ExtremeCloud IQ Controller E3120', 'wlan-controller', 1, 150, 'Contrôleur Wi-Fi · 2 000 bornes'),
  m('Extreme Networks', 'AP4000', 'wifi7', undefined, 25, 'Borne Wi-Fi 6E universelle'),
  m('Ubiquiti', 'UniFi Cloud Key Gen2 Plus', 'net-controller', undefined, 10, 'Contrôleur UniFi embarqué'),
  m('Ubiquiti', 'UniFi Dream Machine SE', 'net-controller', 1, 60, 'Passerelle et contrôleur UniFi'),
  m('Ubiquiti', 'UniFi U7 Pro Max', 'wifi7', undefined, 30, 'Borne Wi-Fi 7'),
  m('TP-Link', 'Omada OC300', 'net-controller', 1, 12, 'Contrôleur Omada · 500 équipements'),
  m('TP-Link', 'Omada EAP783', 'wifi7', undefined, 25, 'Borne Wi-Fi 7 · PoE+'),
  m('Alcatel-Lucent', 'OmniAccess Stellar AP1451', 'wifi7', undefined, 25, 'Borne Wi-Fi 6E'),
  m('Cambium Networks', 'XV3-8', 'wifi7', undefined, 30, 'Borne Wi-Fi 6 haute densité'),
  m('Nutanix', 'Prism Central (virtuel)', 'net-controller', undefined, undefined, 'Pilotage centralisé des clusters'),
  m('VMware', 'NSX Manager (virtuel)', 'net-controller', undefined, undefined, 'Pilotage du réseau virtualisé'),

  // ── Hyperconvergé, virtualisation & serveurs ─────────────────────────────
  m('Nutanix', 'NX-1175S-G9', 'hci', 1, 600, 'Nœud hyperconvergé mono-socket 1U'),
  m('Nutanix', 'NX-3170-G9', 'hci', 2, 1000, 'Nœud hyperconvergé bi-socket'),
  m('Nutanix', 'NX-8170-G9', 'hci', 2, 1300, 'Nœud haute performance NVMe'),
  m('Nutanix', 'NX-9151-G9', 'hci', 2, 1200, 'Nœud full-NVMe · bases de données'),
  m('Dell', 'VxRail VE-660', 'hci', 1, 700, 'Nœud hyperconvergé VMware'),
  m('Dell', 'VxRail VP-760', 'hci', 2, 1100, 'Nœud hyperconvergé VMware performance'),
  m('Dell', 'XC Core XC660 (Nutanix)', 'hci', 1, 700, 'Nœud Nutanix sur PowerEdge'),
  m('Dell', 'AX-650 (Azure Local)', 'hci', 1, 700, 'Nœud Azure Local / Stack HCI'),
  m('Dell', 'PowerEdge R6625', 'server', 1, 700, 'Serveur rack 1U · AMD EPYC'),
  m('Dell', 'PowerEdge R7625', 'server', 2, 900, 'Serveur rack 2U · AMD EPYC'),
  m('Dell', 'PowerEdge MX7000 (châssis)', 'server', 7, 3000, 'Châssis modulaire 8 lames'),
  m('HPE', 'ProLiant DL325 Gen11', 'server', 1, 500, 'Serveur rack 1U · AMD EPYC'),
  m('HPE', 'DX360 Gen11 (Nutanix)', 'hci', 1, 650, 'Nœud Nutanix sur ProLiant'),
  m('HPE', 'Alletra dHCI', 'hci', 2, 900, 'Infrastructure convergée calcul + baie'),
  m('HPE', 'Synergy 12000 (châssis)', 'server', 10, 4000, 'Châssis composable'),
  m('Cisco', 'UCS C220 M7', 'server', 1, 600, 'Serveur rack 1U'),
  m('Cisco', 'UCS X9508 (châssis)', 'server', 7, 3500, 'Châssis modulaire 8 nœuds'),
  m('Cisco', 'HyperFlex HX220c M6', 'hci', 1, 700, 'Nœud hyperconvergé'),
  m('Lenovo', 'ThinkSystem SR665 V3', 'server', 2, 850, 'Serveur rack 2U · AMD EPYC'),
  m('Lenovo', 'ThinkAgile VX650 V3', 'hci', 2, 900, 'Nœud hyperconvergé vSAN'),
  m('Fujitsu', 'PRIMERGY RX2540 M7', 'server', 2, 800, 'Serveur rack 2U'),
  m('Supermicro', 'SYS-221H-TNR', 'server', 2, 800, 'Serveur rack 2U'),
  m('Scale Computing', 'HE1150', 'hci', 1, 450, 'Nœud hyperconvergé site distant'),
  m('Scale Computing', 'HC5250D', 'hci', 2, 800, 'Nœud hyperconvergé NVMe'),
  m('NVIDIA', 'DGX B200', 'gpu-server', 10, 14300, 'Serveur IA 8 GPU'),

  // ── Stockage, SAN & sauvegarde ───────────────────────────────────────────
  m('Dell', 'PowerStore 3200T', 'storage', 2, 1100, 'Baie unifiée NVMe milieu de gamme'),
  m('Dell', 'PowerScale F210', 'object-storage', 1, 700, 'Stockage fichier scale-out'),
  m('Dell', 'PowerProtect DD6400', 'backup', 3, 900, 'Sauvegarde avec déduplication'),
  m('NetApp', 'AFF A70', 'storage', 4, 1200, 'Baie full-flash NVMe'),
  m('NetApp', 'AFF A800', 'storage', 4, 1800, 'Baie full-flash haute performance'),
  m('Pure Storage', 'FlashArray //XL170', 'storage', 5, 2200, 'Baie NVMe datacenter'),
  m('Pure Storage', 'FlashArray //E', 'storage', 3, 1000, 'Baie flash capacitive'),
  m('HPE', 'Alletra Storage MP B10000', 'storage', 2, 1000, 'Baie NVMe désagrégée'),
  m('Huawei', 'OceanStor Dorado 5000 V6', 'storage', 2, 1100, 'Baie full-flash'),
  m('IBM', 'FlashSystem 5300', 'storage', 1, 700, 'Baie full-flash NVMe'),
  m('Synology', 'SA3610', 'storage', 2, 400, 'NAS rack 12 baies · double contrôleur'),
  m('QNAP', 'TS-h2490FU', 'storage', 2, 400, 'NAS full-flash 24 baies U.2'),
  m('Brocade', 'G620', 'san-switch', 1, 150, '48 ports Fibre Channel 32G'),
  m('Brocade', 'G730', 'san-switch', 1, 200, '64 ports Fibre Channel 64G'),
  m('Brocade', 'X7-4 (directeur)', 'san-switch', 8, 1500, 'Directeur SAN modulaire'),
  m('Cisco', 'MDS 9148V', 'san-switch', 1, 180, '48 ports Fibre Channel 64G'),
  m('Cisco', 'MDS 9396V', 'san-switch', 2, 400, '96 ports Fibre Channel 64G'),
  m('HPE', 'SN6700B', 'san-switch', 1, 200, 'Switch SAN 64G'),
  m('Cohesity', 'C4100', 'backup', 2, 900, 'Sauvegarde scale-out'),
  m('ExaGrid', 'EX54', 'backup', 2, 700, 'Sauvegarde avec zone de dépôt'),
  m('Commvault', 'HyperScale X HS4300', 'backup', 2, 800, 'Nœud de sauvegarde scale-out'),
  m('Veeam', 'Backup & Replication (virtuel)', 'backup', undefined, undefined, 'Serveur de sauvegarde virtualisé'),
  m('Quantum', 'DXi4800', 'backup', 2, 600, 'Appliance de déduplication'),

  // ── Routage, SD-WAN & accès opérateur ────────────────────────────────────
  m('Cisco', 'Catalyst 8200-1N-4T', 'sdwan', 1, 70, 'SD-WAN agence'),
  m('Cisco', 'Catalyst 8500-12X', 'sdwan', 1, 350, 'Agrégation SD-WAN datacenter'),
  m('Cisco', 'ISR 1111X-8P', 'router', 1, 50, 'Routeur agence · 8 ports'),
  m('Juniper', 'SRX380', 'ngfw', 1, 100, 'Pare-feu agence · SD-WAN'),
  m('Juniper', 'MX304', 'router', 2, 700, 'Routeur opérateur compact'),
  m('Fortinet', 'FortiGate 90G', 'ngfw', 1, 35, 'NGFW agence · SD-WAN'),
  m('Fortinet', 'FortiGate 120G', 'ngfw', 1, 60, 'NGFW site moyen · SD-WAN'),
  m('Fortinet', 'FortiGate 3000F', 'ngfw', 2, 800, 'NGFW datacenter haut débit'),
  m('Fortinet', 'FortiExtender 511F', 'router-5g', 1, 30, 'Routeur 5G de secours'),
  m('VMware', 'VeloCloud Edge 640', 'sdwan', 1, 60, 'SD-WAN site moyen'),
  m('Aruba', 'EdgeConnect EC-L', 'sdwan', 1, 90, 'SD-WAN (ex-Silver Peak)'),
  m('Versa Networks', 'CSG1300', 'sdwan', 1, 60, 'SD-WAN et SASE agence'),
  m('Peplink', 'Balance 580', 'sdwan', 1, 40, 'Agrégation multi-WAN'),
  m('Cradlepoint', 'E3000', 'router-5g', 1, 45, 'Routeur 5G d’entreprise'),
  m('Teltonika', 'RUTX50', 'router-5g', undefined, 20, 'Routeur 5G industriel'),
  m('MikroTik', 'CCR2004-1G-12S+2XS', 'router', 1, 60, 'Routeur 10G / 25G'),
  m('MikroTik', 'CRS326-24S+2Q+RM', 'switch', 1, 70, '24× 10G SFP+ · 2× 40G'),
  m('Huawei', 'NetEngine AR6300', 'router', 1, 150, 'Routeur agence haut débit'),
  m('Stormshield', 'SN-S-Series-320', 'ngfw', 1, 40, 'NGFW agence qualifié ANSSI'),
  m('Nokia', '1830 PSS-8', 'dwdm', 3, 600, 'Transport optique DWDM'),
  m('Ciena', '5171', 'dwdm', 1, 300, 'Transport paquet-optique'),
  m('Smartoptics', 'DCP-M40', 'dwdm', 1, 120, 'Multiplexeur DWDM 40 canaux'),
  m('Orange', 'Livebox Pro 4', 'modem', undefined, 20, 'Terminaison fibre professionnelle'),
  m('SFR', 'Business Box', 'modem', undefined, 20, 'Terminaison fibre professionnelle'),
  m('Nokia', 'G-010G-A (ONT)', 'modem', undefined, 8, 'Terminaison optique GPON'),
  m('Ubiquiti', 'airFiber AF60-LR', 'wifi-bridge', undefined, 20, 'Pont hertzien 60 GHz · ~2 Gb/s'),
  m('Cambium Networks', 'PTP 550', 'wifi-bridge', undefined, 25, 'Pont hertzien 5 GHz'),
  m('Cisco', 'ASA 5555-X (VPN)', 'vpn-concentrator', 1, 200, 'Concentrateur VPN nomade et site à site'),
  m('Aruba', 'VPNC 9240', 'vpn-concentrator', 1, 200, 'Concentrateur VPN SD-Branch'),

  // ── Commutation (compléments) ────────────────────────────────────────────
  m('Cisco', 'Catalyst C9200CX-12P-2X2G', 'access-switch', 1, 110, '12× 1G PoE+ · format compact'),
  m('Cisco', 'Catalyst C9500X-28C8D', 'core-switch', 1, 700, '28× 100G · 8× 400G'),
  m('Cisco', 'Nexus 93600CD-GX', 'leaf', 1, 550, '28× 100G · 8× 400G'),
  m('Cisco', 'Nexus 9408', 'spine', 4, 1800, 'Châssis spine 400G'),
  m('Aruba', 'CX 6200F-48G', 'access-switch', 1, 170, '48× 1G · 4× 10G SFP+'),
  m('Aruba', 'CX 8360-48Y6C', 'leaf', 1, 400, '48× 25G · 6× 100G'),
  m('Aruba', 'CX 9300-32D', 'spine', 1, 600, '32× 400G'),
  m('Juniper', 'EX4100-48P', 'access-switch', 1, 220, '48× 1G PoE+ · 4× 10G'),
  m('Juniper', 'QFX5130-32CD', 'spine', 1, 550, '32× 400G'),
  m('Arista', '7010TX-48', 'access-switch', 1, 120, '48× 1G · faible consommation'),
  m('Arista', '7060X5-64S', 'spine', 1, 700, '64× 400G'),
  m('Extreme Networks', '5420F-48P-4XE', 'access-switch', 1, 210, '48× 1G PoE+ · 4× 10G'),
  m('Extreme Networks', '7520-48Y-8C', 'leaf', 1, 380, '48× 25G · 8× 100G'),
  m('Huawei', 'CloudEngine S5732-H48UM2CC', 'switch', 1, 300, '48× multigigabit · 2× 100G'),
  m('H3C', 'S5560X-54C-PWR-EI', 'access-switch', 1, 250, '48× 1G PoE+ · 4× 10G · Comware'),
  m('H3C', 'S12500G-AF (châssis)', 'core-switch', 10, 1500, 'Châssis cœur Comware · IRF'),
  m('Alcatel-Lucent', 'OmniSwitch 6860N-P48M', 'access-switch', 1, 230, '48× multigigabit PoE'),
  m('Alcatel-Lucent', 'OmniSwitch 6900-V72', 'core-switch', 1, 400, '72× 25G · liaisons 100G'),
  m('Netgear', 'M4350-48X4C', 'switch', 1, 250, '48× 10G · 4× 100G'),
  m('D-Link', 'DGS-3130-52TS', 'access-switch', 1, 160, '48× 1G · 4× 10G SFP+'),
  m('Zyxel', 'XGS2220-54FP', 'access-switch', 1, 250, '48× 1G PoE++ · 6× 10G'),
  m('Allied Telesis', 'x530-52GPXm', 'access-switch', 1, 220, '48× multigigabit PoE+'),

  // ── Brassage, hors bande & conversion ────────────────────────────────────
  m('Legrand', 'LCS3 panneau 24 ports RJ45', 'patch-panel', 1, undefined, 'Brassage cuivre catégorie 6A'),
  m('Panduit', 'Panneau modulaire 48 ports', 'patch-panel', 2, undefined, 'Brassage cuivre haute densité'),
  m('Nexans', 'LANmark tiroir optique 24 LC', 'patch-panel', 1, undefined, 'Tiroir optique monomode'),
  m('Opengear', 'OM2248', 'console-server', 1, 40, '48 ports console série · accès 4G'),
  m('Opengear', 'CM8148', 'console-server', 1, 35, '48 ports console série'),
  m('Lantronix', 'SLC 8000 (32 ports)', 'console-server', 1, 30, 'Console série modulaire'),
  m('Vertiv', 'Avocent ACS8048', 'console-server', 1, 35, '48 ports console série'),
  m('Raritan', 'Dominion KX IV-101', 'console-server', 1, 15, 'KVM sur IP · 1 port'),
  m('Moxa', 'NPort 5650-16', 'console-server', 1, 20, 'Serveur de ports série industriel'),
  m('TP-Link', 'MC220L', 'media-converter', undefined, 5, 'Convertisseur 1G cuivre / fibre'),
  m('D-Link', 'DMC-1910R', 'media-converter', undefined, 8, 'Convertisseur 1G monomode 15 km'),

  // ── Voix & collaboration ─────────────────────────────────────────────────
  m('Alcatel-Lucent', 'OmniPCX Enterprise', 'ipbx', 2, 300, 'IPBX d’entreprise'),
  m('Mitel', 'MiVoice Business MXe', 'ipbx', 2, 250, 'IPBX d’entreprise'),
  m('Cisco', 'Unified CM sur UCS C240', 'ipbx', 2, 700, 'Téléphonie unifiée'),
  m('3CX', 'Serveur 3CX (virtuel)', 'ipbx', undefined, undefined, 'IPBX logiciel'),
  m('Sangoma', 'Switchvox 6000', 'ipbx', 1, 150, 'IPBX pour PME'),
  m('AudioCodes', 'Mediant 1000B', 'voice-gateway', 1, 100, 'Passerelle voix et SBC'),
  m('AudioCodes', 'Mediant 500Li', 'voice-gateway', 1, 40, 'Passerelle voix agence'),
  m('Sangoma', 'Vega 3000G', 'voice-gateway', 1, 60, 'Passerelle analogique / SIP'),
  m('Cisco', 'VG450', 'voice-gateway', 1, 120, 'Passerelle voix analogique'),
  m('Oracle', 'Acme Packet 3950', 'sbc', 1, 300, 'Contrôleur de session (SBC)'),
  m('AudioCodes', 'Mediant 4000 SBC', 'sbc', 1, 200, 'Contrôleur de session (SBC)'),
  m('Spectralink', 'IP-DECT Server 400', 'dect', undefined, 15, 'Serveur et borne IP-DECT'),
  m('Yealink', 'W90DM', 'dect', undefined, 12, 'Base DECT multicellulaire'),
  m('Poly', 'Studio X70', 'visio', undefined, 60, 'Barre de visioconférence grande salle'),
  m('Logitech', 'Rally Bar', 'visio', undefined, 55, 'Barre de visioconférence'),
  m('Yealink', 'MeetingBar A30', 'visio', undefined, 50, 'Barre de visioconférence'),

  // ── Services réseau, visibilité & industriel ─────────────────────────────
  m('Infoblox', 'Trinzic 1425', 'ddi', 1, 200, 'DNS / DHCP / IPAM'),
  m('EfficientIP', 'SOLIDserver DNS Guardian 850', 'ddi', 1, 180, 'DNS / DHCP / IPAM'),
  m('Cisco', 'ISE 3615', 'nac', 1, 500, 'Contrôle d’accès NAC / RADIUS'),
  m('Fortinet', 'FortiNAC-F 1000C', 'nac', 1, 300, 'Contrôle d’accès NAC'),
  m('Meinberg', 'LANTIME M300/GPS', 'ntp', 1, 30, 'Serveur de temps NTP/PTP · GPS'),
  m('Gigamon', 'GigaVUE-HC1', 'network-tap', 1, 200, 'Packet broker · visibilité'),
  m('Keysight', 'Vision E40', 'network-tap', 1, 250, 'Packet broker 40G'),
  m('Profitap', 'ProfiShark 10G', 'network-tap', undefined, 10, 'TAP portable 10G'),
  m('Siemens', 'SCALANCE XC216-4C', 'industrial-switch', undefined, 25, 'Switch industriel managé 16 ports'),
  m('Siemens', 'SCALANCE XM408-8C', 'industrial-switch', undefined, 45, 'Switch industriel modulaire L3'),
  m('Siemens', 'SCALANCE SC636-2C', 'ngfw', undefined, 30, 'Pare-feu industriel'),
  m('Moxa', 'EDS-G4012-8P', 'industrial-switch', undefined, 40, 'Switch industriel PoE 12 ports'),
  m('Hirschmann', 'RSP20', 'industrial-switch', undefined, 30, 'Switch industriel · anneau redondant'),
  m('Phoenix Contact', 'FL SWITCH 2408', 'industrial-switch', undefined, 20, 'Switch industriel 8 ports'),
  m('Siemens', 'SIMATIC S7-1200', 'plc', undefined, 15, 'Automate compact'),
  m('Schneider Electric', 'Modicon M580', 'plc', undefined, 40, 'Automate process et sécurité'),
  m('Siemens', 'SIMATIC HMI TP1500', 'scada', undefined, 25, 'Pupitre de supervision'),
  m('Cisco', 'IR1101', 'ot-gateway', undefined, 40, 'Routeur industriel durci'),
  m('Kerlink', 'Wirnet iStation', 'ot-gateway', undefined, 15, 'Passerelle LoRaWAN extérieure'),
  m('Milesight', 'UG65', 'ot-gateway', undefined, 12, 'Passerelle LoRaWAN intérieure'),
  m('APC', 'NetBotz 250', 'iot-sensor', undefined, 10, 'Surveillance température et humidité'),
  m('Eaton', 'EMP002', 'iot-sensor', undefined, 2, 'Sonde température / humidité'),
  m('Vertiv', 'Liebert EXM2 60 kVA', 'ups', 12, undefined, 'Onduleur triphasé'),
  m('Schneider Electric', 'Galaxy VS 60 kVA', 'ups', 10, undefined, 'Onduleur triphasé modulaire'),
  m('Vertiv', 'Liebert PDX 60 kW', 'cooling', 42, undefined, 'Climatisation de salle'),
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
