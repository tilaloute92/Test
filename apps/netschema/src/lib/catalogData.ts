/**
 * Catalogue d'équipements, décrit en données et non en code.
 *
 * Un type d'équipement = une ligne de données qui désigne un pictogramme du registre
 * (`icons.tsx`), une couche, une famille et des synonymes de recherche. Ajouter une
 * technologie ne demande donc ni composant React ni recompilation : il suffit d'ajouter
 * une entrée ici, de déposer un fichier de lot dans `public/catalog/`, ou d'importer un
 * lot depuis l'application.
 */

export interface DeviceDef {
  /** Identifiant stable, stocké dans les fichiers de schéma. Ne jamais le renommer. */
  id: string
  label: string
  /** Couche par défaut (0 = Internet/WAN … 8 = énergie). */
  rank: number
  /** Identifiant de pictogramme dans le registre d'icônes. */
  icon: string
  family: string
  /** Couleur : par défaut celle de la couche, sinon celle d'une autre couche. */
  palette?: number
  /** Synonymes pour la recherche (français, anglais, sigles). */
  aliases?: string[]
  /** Équipement d'infrastructure : entre dans l'analyse de haute disponibilité. */
  infrastructure?: boolean
  /** Équipement dont la panne coupe le service s'il n'a pas de pair. */
  critical?: boolean
}

export interface CatalogPack {
  id: string
  title: string
  version: string
  description: string
  devices: DeviceDef[]
}

export const FAMILY_ORDER = [
  'Extérieur & opérateurs',
  'Périmètre & routage',
  'Sécurité',
  'Commutation & fabric',
  'Sans fil & accès',
  'Calcul & virtualisation',
  'Conteneurs & cloud',
  'Données & sauvegarde',
  'Identité & supervision',
  'Utilisateurs & périphériques',
  'Énergie & environnement',
]

const EXT = 'Extérieur & opérateurs'
const EDGE = 'Périmètre & routage'
const SEC = 'Sécurité'
const SW = 'Commutation & fabric'
const ACCESS = 'Sans fil & accès'
const COMPUTE = 'Calcul & virtualisation'
const CLOUD = 'Conteneurs & cloud'
const DATA = 'Données & sauvegarde'
const OPS = 'Identité & supervision'
const USERS = 'Utilisateurs & périphériques'
const POWER = 'Énergie & environnement'

/** Socle historique : ces identifiants sont ceux des schémas déjà enregistrés. */
const BASE: CatalogPack = {
  id: 'base',
  title: 'Socle réseau',
  version: '2.0.0',
  description: 'Équipements de base présents dans toute infrastructure.',
  devices: [
    { id: 'internet', label: 'Internet', rank: 0, icon: 'globe', family: EXT, infrastructure: true, aliases: ['web', 'wan'] },
    { id: 'cloud', label: 'Cloud / SaaS', rank: 0, icon: 'cloud', family: EXT, infrastructure: true, aliases: ['saas', 'office 365', 'azure', 'aws'] },
    { id: 'wan', label: 'Lien opérateur', rank: 0, icon: 'globe-grid', family: EXT, infrastructure: true, critical: true, aliases: ['fai', 'isp', 'mpls', 'opérateur', 'adduction'] },
    { id: 'router', label: 'Routeur', rank: 1, icon: 'router', family: EDGE, infrastructure: true, critical: true, aliases: ['routeur', 'rtr', 'edge', 'cpe'] },
    { id: 'firewall', label: 'Pare-feu', rank: 2, icon: 'firewall', family: SEC, infrastructure: true, critical: true, aliases: ['firewall', 'fw', 'filtrage'] },
    { id: 'loadbalancer', label: 'Répartiteur de charge', rank: 2, icon: 'load-balancer', family: SEC, infrastructure: true, critical: true, aliases: ['load balancer', 'lb', 'adc', 'répartition'] },
    { id: 'core-switch', label: 'Switch cœur', rank: 3, icon: 'switch-core', family: SW, infrastructure: true, critical: true, aliases: ['core', 'cœur', 'commutateur'] },
    { id: 'switch', label: 'Switch distribution', rank: 4, icon: 'switch', family: SW, infrastructure: true, critical: true, aliases: ['distribution', 'commutateur'] },
    { id: 'access-switch', label: 'Switch accès', rank: 5, icon: 'switch', family: ACCESS, infrastructure: true, aliases: ['accès', 'access', 'poe'] },
    { id: 'wifi', label: 'Borne Wi-Fi', rank: 5, icon: 'wifi', family: ACCESS, infrastructure: true, aliases: ['ap', 'borne', 'wlan', 'sans fil'] },
    { id: 'server', label: 'Serveur', rank: 6, icon: 'server', family: COMPUTE, aliases: ['srv', 'vm', 'machine'] },
    { id: 'hypervisor', label: 'Nœud hyperviseur', rank: 6, icon: 'hypervisor', family: COMPUTE, critical: true, aliases: ['esxi', 'vmware', 'proxmox', 'hyper-v', 'kvm'] },
    { id: 'storage', label: 'Baie de stockage', rank: 6, icon: 'database', family: DATA, critical: true, aliases: ['san', 'nas', 'baie', 'storage'] },
    { id: 'backup', label: 'Serveur de sauvegarde', rank: 6, icon: 'backup', family: DATA, aliases: ['veeam', 'sauvegarde', 'backup'] },
    { id: 'witness', label: 'Témoin de quorum', rank: 6, icon: 'balance', family: COMPUTE, aliases: ['quorum', 'witness', 'arbitre', 'split-brain'] },
    { id: 'workstation', label: 'Poste de travail', rank: 7, icon: 'workstation', family: USERS, aliases: ['pc', 'poste', 'client'] },
    { id: 'printer', label: 'Imprimante', rank: 7, icon: 'printer', family: USERS, aliases: ['impression', 'copieur'] },
    { id: 'phone', label: 'Téléphone IP', rank: 7, icon: 'phone', family: USERS, aliases: ['voip', 'toip', 'téléphonie'] },
    { id: 'ups', label: 'Onduleur', rank: 8, icon: 'ups', family: POWER, critical: true, aliases: ['ups', 'asi', 'secours'] },
    { id: 'pdu', label: 'Bandeau PDU', rank: 8, icon: 'pdu', family: POWER, aliases: ['pdu', 'prises', 'bandeau'] },
  ],
}

/** Réseau moderne : SD-WAN, SASE, fabric spine/leaf, Wi-Fi 7, 5G, services réseau. */
const NETWORK: CatalogPack = {
  id: 'reseau-moderne',
  title: 'Réseau moderne',
  version: '2026.1',
  description: 'SD-WAN, SASE/SSE, fabric spine-leaf VXLAN/EVPN, Wi-Fi 7, 5G, services réseau.',
  devices: [
    { id: 'sdwan', label: 'Boîtier SD-WAN', rank: 1, icon: 'router-cloud', family: EDGE, infrastructure: true, critical: true, aliases: ['sd-wan', 'sdwan', 'overlay', 'velocloud', 'viptela'] },
    { id: 'sase-pop', label: 'Point de présence SASE', rank: 0, icon: 'cloud-shield', family: EXT, infrastructure: true, aliases: ['sase', 'sse', 'zscaler', 'cloud sécurité'] },
    { id: 'cdn', label: 'CDN / edge', rank: 0, icon: 'globe-arrows', family: EXT, infrastructure: true, aliases: ['cdn', 'cache', 'cloudflare', 'akamai', 'edge'] },
    { id: 'ddos-scrubbing', label: 'Filtrage anti-DDoS', rank: 0, icon: 'shield', family: EXT, palette: 2, infrastructure: true, aliases: ['ddos', 'scrubbing', 'anti-ddos'] },
    { id: 'router-5g', label: 'Routeur 5G / LTE', rank: 1, icon: 'antenna', family: EDGE, infrastructure: true, aliases: ['5g', '4g', 'lte', 'secours', 'backup'] },
    { id: 'satellite', label: 'Liaison satellite', rank: 0, icon: 'satellite', family: EXT, infrastructure: true, aliases: ['satellite', 'vsat', 'starlink'] },
    { id: 'dwdm', label: 'Multiplexeur optique DWDM', rank: 1, icon: 'prism', family: EDGE, infrastructure: true, critical: true, aliases: ['dwdm', 'cwdm', 'optique', 'transport'] },
    { id: 'spine', label: 'Switch spine (fabric)', rank: 3, icon: 'spine', family: SW, infrastructure: true, critical: true, aliases: ['spine', 'fabric', 'vxlan', 'evpn', '800g'] },
    { id: 'leaf', label: 'Switch leaf (fabric)', rank: 4, icon: 'leaf', family: SW, infrastructure: true, critical: true, aliases: ['leaf', 'tor', 'top of rack', 'fabric'] },
    { id: 'network-tap', label: 'TAP / packet broker', rank: 4, icon: 'split', family: SW, infrastructure: true, aliases: ['tap', 'spn', 'packet broker', 'capture', 'npb'] },
    { id: 'wifi7', label: 'Borne Wi-Fi 7', rank: 5, icon: 'wifi', family: ACCESS, infrastructure: true, aliases: ['wifi 7', 'wi-fi 7', '802.11be', 'ap', 'borne'] },
    { id: 'api-gateway', label: 'Passerelle API', rank: 2, icon: 'gateway-api', family: SEC, infrastructure: true, aliases: ['api', 'gateway', 'apim', 'kong'] },
    { id: 'service-mesh', label: 'Maillage de services', rank: 6, icon: 'mesh', family: CLOUD, aliases: ['service mesh', 'istio', 'linkerd', 'sidecar'] },
    { id: 'ddi', label: 'DNS / DHCP / IPAM', rank: 6, icon: 'address-book', family: OPS, critical: true, aliases: ['dns', 'dhcp', 'ipam', 'ddi', 'infoblox'] },
    { id: 'ntp', label: 'Serveur de temps NTP/PTP', rank: 6, icon: 'clock', family: OPS, aliases: ['ntp', 'ptp', 'temps', 'horloge', 'gps'] },
  ],
}

/** Sécurité : pile Zero Trust, détection, identité, secrets. */
const SECURITY: CatalogPack = {
  id: 'securite',
  title: 'Sécurité & Zero Trust',
  version: '2026.1',
  description: 'NGFW, WAF, ZTNA, SSE, EDR/XDR, SIEM/SOAR, identité, PAM, HSM/PKI, NAC.',
  devices: [
    { id: 'ngfw', label: 'Pare-feu nouvelle génération', rank: 2, icon: 'firewall-plus', family: SEC, infrastructure: true, critical: true, aliases: ['ngfw', 'utm', 'palo alto', 'fortigate', 'inspection'] },
    { id: 'waf', label: 'Pare-feu applicatif (WAF)', rank: 2, icon: 'shield-lock', family: SEC, infrastructure: true, critical: true, aliases: ['waf', 'applicatif', 'owasp'] },
    { id: 'ips', label: 'Sonde IDS / IPS', rank: 2, icon: 'radar', family: SEC, infrastructure: true, aliases: ['ids', 'ips', 'sonde', 'détection', 'suricata'] },
    { id: 'ztna', label: 'Accès Zero Trust (ZTNA)', rank: 2, icon: 'shield-check', family: SEC, infrastructure: true, critical: true, aliases: ['ztna', 'zero trust', 'sdp', 'accès distant'] },
    { id: 'swg', label: 'Passerelle SSE (SWG / CASB)', rank: 2, icon: 'funnel', family: SEC, infrastructure: true, aliases: ['proxy', 'swg', 'casb', 'sse', 'filtrage web'] },
    { id: 'email-security', label: 'Sécurité de la messagerie', rank: 2, icon: 'mail-shield', family: SEC, aliases: ['messagerie', 'antispam', 'phishing', 'mail'] },
    { id: 'nac', label: 'Contrôle d’accès NAC / 802.1X', rank: 5, icon: 'port-badge', family: ACCESS, palette: 2, infrastructure: true, aliases: ['nac', '802.1x', 'radius', 'ise', 'posture'] },
    { id: 'bastion', label: 'Rebond / bastion', rank: 6, icon: 'lock-user', family: OPS, palette: 2, aliases: ['bastion', 'jump host', 'rebond', 'ssh'] },
    { id: 'pam', label: 'Coffre-fort PAM', rank: 6, icon: 'key', family: OPS, palette: 2, aliases: ['pam', 'secrets', 'coffre', 'cyberark', 'vault'] },
    { id: 'idp', label: 'Identité / SSO / MFA', rank: 6, icon: 'badge-user', family: OPS, palette: 2, critical: true, aliases: ['idp', 'sso', 'mfa', 'entra', 'okta', 'annuaire', 'ad'] },
    { id: 'siem', label: 'SIEM (journalisation)', rank: 6, icon: 'eye', family: OPS, palette: 2, aliases: ['siem', 'logs', 'splunk', 'sentinel', 'journalisation'] },
    { id: 'soar', label: 'SOAR (réponse automatisée)', rank: 6, icon: 'robot', family: OPS, palette: 2, aliases: ['soar', 'automatisation', 'playbook', 'réponse'] },
    { id: 'xdr', label: 'EDR / XDR', rank: 6, icon: 'laptop-shield', family: OPS, palette: 2, aliases: ['edr', 'xdr', 'antivirus', 'crowdstrike', 'poste'] },
    { id: 'hsm', label: 'HSM / gestion de clés', rank: 6, icon: 'key', family: OPS, palette: 2, aliases: ['hsm', 'kms', 'chiffrement', 'clés'] },
    { id: 'pki', label: 'Autorité de certification', rank: 6, icon: 'shield-check', family: OPS, palette: 2, aliases: ['pki', 'ca', 'certificats', 'tls'] },
    { id: 'vuln-scanner', label: 'Scanner de vulnérabilités', rank: 6, icon: 'bug', family: OPS, palette: 2, aliases: ['vulnérabilités', 'scanner', 'nessus', 'qualys'] },
    { id: 'dlp', label: 'Protection des données (DLP)', rank: 6, icon: 'doc-lock', family: OPS, palette: 2, aliases: ['dlp', 'fuite', 'données', 'classification'] },
    { id: 'mdm', label: 'Gestion de flotte (MDM/UEM)', rank: 6, icon: 'phone-shield', family: OPS, palette: 2, aliases: ['mdm', 'uem', 'intune', 'mobiles', 'flotte'] },
    { id: 'honeypot', label: 'Leurre (honeypot)', rank: 6, icon: 'bug', family: OPS, palette: 2, aliases: ['honeypot', 'leurre', 'deception'] },
  ],
}

/** Cloud, conteneurs et plateformes applicatives. */
const CLOUD_PACK: CatalogPack = {
  id: 'cloud-conteneurs',
  title: 'Cloud & conteneurs',
  version: '2026.1',
  description: 'Régions et VPC, interconnexion cloud, Kubernetes, serverless, données managées, GPU.',
  devices: [
    { id: 'cloud-region', label: 'Région cloud', rank: 0, icon: 'cloud', family: CLOUD, palette: 0, infrastructure: true, aliases: ['région', 'aws', 'azure', 'gcp', 'ovh'] },
    { id: 'vpc', label: 'Réseau virtuel (VPC)', rank: 0, icon: 'cloud-shield', family: CLOUD, palette: 0, infrastructure: true, aliases: ['vpc', 'vnet', 'réseau virtuel', 'subnet'] },
    { id: 'cloud-interconnect', label: 'Interconnexion cloud', rank: 0, icon: 'cloud-link', family: CLOUD, palette: 0, infrastructure: true, critical: true, aliases: ['expressroute', 'direct connect', 'interconnexion', 'peering'] },
    { id: 'k8s-cluster', label: 'Cluster Kubernetes', rank: 6, icon: 'cubes', family: CLOUD, critical: true, aliases: ['kubernetes', 'k8s', 'cluster', 'openshift', 'aks', 'eks'] },
    { id: 'k8s-control-plane', label: 'Plan de contrôle K8s', rank: 6, icon: 'cubes-control', family: CLOUD, critical: true, aliases: ['control plane', 'master', 'etcd', 'api server'] },
    { id: 'k8s-node', label: 'Nœud de travail K8s', rank: 6, icon: 'cube', family: CLOUD, aliases: ['worker', 'node', 'nœud', 'pod'] },
    { id: 'registry', label: 'Registre d’images', rank: 6, icon: 'registry', family: CLOUD, aliases: ['registry', 'harbor', 'images', 'conteneurs'] },
    { id: 'serverless', label: 'Fonction serverless', rank: 6, icon: 'lambda', family: CLOUD, aliases: ['serverless', 'lambda', 'function', 'faas'] },
    { id: 'message-queue', label: 'File de messages', rank: 6, icon: 'queue', family: CLOUD, aliases: ['kafka', 'rabbitmq', 'file', 'bus', 'événements'] },
    { id: 'managed-db', label: 'Base de données managée', rank: 6, icon: 'database', family: DATA, critical: true, aliases: ['base', 'sql', 'postgres', 'oracle', 'rds'] },
    { id: 'object-storage', label: 'Stockage objet (S3)', rank: 6, icon: 'bucket', family: DATA, aliases: ['s3', 'objet', 'bucket', 'blob'] },
    { id: 'gpu-server', label: 'Serveur GPU / IA', rank: 6, icon: 'gpu', family: COMPUTE, critical: true, aliases: ['gpu', 'ia', 'ai', 'nvidia', 'calcul', 'llm'] },
    { id: 'ci-runner', label: 'Agent CI/CD', rank: 6, icon: 'robot', family: CLOUD, aliases: ['ci', 'cd', 'runner', 'jenkins', 'gitlab', 'pipeline'] },
  ],
}

/** Datacenter physique : calcul, stockage, salle. */
const DATACENTER: CatalogPack = {
  id: 'datacenter',
  title: 'Datacenter & salle',
  version: '2026.1',
  description: 'Hyperconvergé, bare metal, NVMe, sauvegarde immuable, baies, supervision, énergie.',
  devices: [
    { id: 'hci', label: 'Nœud hyperconvergé', rank: 6, icon: 'rack', family: COMPUTE, critical: true, aliases: ['hci', 'nutanix', 'vsan', 'hyperconvergé'] },
    { id: 'baremetal', label: 'Serveur bare metal', rank: 6, icon: 'chip', family: COMPUTE, aliases: ['bare metal', 'physique', 'dédié'] },
    { id: 'nvme-storage', label: 'Baie NVMe / NVMe-oF', rank: 6, icon: 'chip', family: DATA, palette: 6, critical: true, aliases: ['nvme', 'flash', 'nvme-of', 'ssd'] },
    { id: 'tape-backup', label: 'Sauvegarde immuable / bande', rank: 6, icon: 'tape', family: DATA, aliases: ['bande', 'lto', 'immuable', 'air gap', 'coffre'] },
    { id: 'rack', label: 'Baie / rack', rank: 6, icon: 'rack', family: COMPUTE, aliases: ['baie', 'rack', 'armoire'] },
    { id: 'nms', label: 'Supervision (NMS)', rank: 6, icon: 'gauge', family: OPS, aliases: ['supervision', 'monitoring', 'zabbix', 'centreon', 'prtg', 'nagios'] },
    { id: 'camera', label: 'Caméra IP', rank: 7, icon: 'camera', family: USERS, aliases: ['vidéo', 'caméra', 'vidéosurveillance'] },
    { id: 'generator', label: 'Groupe électrogène', rank: 8, icon: 'generator', family: POWER, aliases: ['groupe', 'électrogène', 'diesel'] },
    { id: 'cooling', label: 'Climatisation', rank: 8, icon: 'snowflake', family: POWER, aliases: ['clim', 'crac', 'refroidissement', 'froid'] },
  ],
}

export const BUILTIN_PACKS: CatalogPack[] = [BASE, NETWORK, SECURITY, CLOUD_PACK, DATACENTER]

/** Version du catalogue embarqué, affichée dans l'application. */
export const BUILTIN_CATALOG_VERSION = '2026.1'
