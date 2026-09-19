import type { Diagram, DeviceKind, HaRole, LinkKind, NetLink, NetNode } from '../types'

function node(
  id: string,
  kind: DeviceKind,
  name: string,
  extra: Partial<NetNode> = {},
): NetNode {
  return { id, kind, name, x: 0, y: 0, ...extra }
}

function link(from: string, to: string, kind: LinkKind, extra: Partial<NetLink> = {}): NetLink {
  return { id: `l_${from}_${to}_${kind}`, from, to, kind, ...extra }
}

const SIEGE = 'Siège'
const PRA = 'Site de secours'
const ACTIVE: HaRole = 'active'
const PASSIVE: HaRole = 'passive'
const AA: HaRole = 'active-active'

/**
 * Exemple de référence : une architecture haute disponibilité complète — double adduction
 * opérateur, routeurs VRRP, pare-feu actif/passif, cœur MLAG, distribution en double
 * attachement, cluster d'hyperviseurs avec témoin de quorum, réplication vers un site de
 * secours et double chaîne électrique.
 * Les coordonnées sont laissées à zéro : le placement automatique s'en charge au chargement.
 */
/**
 * Implantation physique et fiche d'inventaire des équipements de l'exemple : c'est la même
 * base d'objets que le schéma, vue depuis la salle machine et depuis le parc.
 */
const ASSETS: Record<string, Partial<NetNode>> = {
  rtr1: { rack: 'rack-a1', rackUnit: 10, heightU: 1, vendor: 'Cisco', model: 'ISR 4331', serial: 'FDO2401R001', purchaseDate: '2023-06-14', warrantyEnd: '2028-06-13', status: 'production', owner: 'Infrastructure', powerW: 90 },
  rtr2: { rack: 'rack-a2', rackUnit: 10, heightU: 1, vendor: 'Cisco', model: 'ISR 4331', serial: 'FDO2401R002', purchaseDate: '2023-06-14', warrantyEnd: '2028-06-13', status: 'production', owner: 'Infrastructure', powerW: 90 },
  fw1: { rack: 'rack-a1', rackUnit: 9, heightU: 1, vendor: 'Fortinet', serial: 'FGT100F0001', purchaseDate: '2024-01-09', warrantyEnd: '2027-01-08', status: 'production', owner: 'Sécurité', powerW: 70 },
  fw2: { rack: 'rack-a2', rackUnit: 9, heightU: 1, vendor: 'Fortinet', serial: 'FGT100F0002', purchaseDate: '2024-01-09', warrantyEnd: '2027-01-08', status: 'production', owner: 'Sécurité', powerW: 70 },
  core1: { rack: 'rack-a1', rackUnit: 6, heightU: 2, vendor: 'Cisco', model: 'C9500-24Y4C', serial: 'FOC2312C001', purchaseDate: '2024-02-20', warrantyEnd: '2029-02-19', status: 'production', owner: 'Infrastructure', powerW: 350 },
  core2: { rack: 'rack-a2', rackUnit: 6, heightU: 2, vendor: 'Cisco', model: 'C9500-24Y4C', serial: 'FOC2312C002', purchaseDate: '2024-02-20', warrantyEnd: '2029-02-19', status: 'production', owner: 'Infrastructure', powerW: 350 },
  hv1: { rack: 'rack-a1', rackUnit: 12, heightU: 2, vendor: 'Dell', model: 'PowerEdge R660', serial: 'DL7X1Q1', purchaseDate: '2025-04-02', warrantyEnd: '2030-04-01', status: 'production', owner: 'Production', powerW: 650 },
  hv2: { rack: 'rack-a1', rackUnit: 15, heightU: 2, vendor: 'Dell', model: 'PowerEdge R660', serial: 'DL7X1Q2', purchaseDate: '2025-04-02', warrantyEnd: '2030-04-01', status: 'production', owner: 'Production', powerW: 650 },
  hv3: { rack: 'rack-a2', rackUnit: 12, heightU: 2, vendor: 'Dell', model: 'PowerEdge R660', serial: 'DL7X1Q3', purchaseDate: '2025-04-02', warrantyEnd: '2030-04-01', status: 'production', owner: 'Production', powerW: 650 },
  san: { rack: 'rack-a1', rackUnit: 18, heightU: 4, vendor: 'NetApp', model: 'AFF A250', serial: 'NA250-0007', purchaseDate: '2024-09-30', warrantyEnd: '2029-09-29', status: 'production', owner: 'Production', powerW: 800 },
  bkp: { rack: 'rack-a1', rackUnit: 23, heightU: 2, vendor: 'HPE', model: 'ProLiant DL380', serial: 'HP380-0012', purchaseDate: '2022-11-15', warrantyEnd: '2026-11-14', status: 'production', owner: 'Production', powerW: 450 },
  upsA: { rack: 'rack-a1', rackUnit: 1, heightU: 3, vendor: 'APC', model: 'Smart-UPS SRT 5000', serial: 'APC-SRT-A', purchaseDate: '2021-05-04', warrantyEnd: '2026-05-03', status: 'production', owner: 'Services généraux' },
  upsB: { rack: 'rack-a2', rackUnit: 1, heightU: 3, vendor: 'APC', model: 'Smart-UPS SRT 5000', serial: 'APC-SRT-B', purchaseDate: '2021-05-04', warrantyEnd: '2026-05-03', status: 'production', owner: 'Services généraux' },
  pduA: { rack: 'rack-a1', rackUnit: 4, heightU: 1, vendor: 'APC', model: 'AP8853', status: 'production' },
  pduB: { rack: 'rack-a2', rackUnit: 4, heightU: 1, vendor: 'APC', model: 'AP8853', status: 'production' },
  coreB: { rack: 'rack-pra', rackUnit: 6, heightU: 2, vendor: 'Cisco', model: 'C9300-24T', serial: 'FOC2401P001', purchaseDate: '2024-02-20', warrantyEnd: '2029-02-19', status: 'production', owner: 'Infrastructure', powerW: 210 },
  sanB: { rack: 'rack-pra', rackUnit: 10, heightU: 4, vendor: 'NetApp', model: 'AFF A150', serial: 'NA150-0003', purchaseDate: '2024-09-30', warrantyEnd: '2029-09-29', status: 'production', owner: 'Production', powerW: 500 },
  distA: { vendor: 'Cisco', model: 'C9300-48P', serial: 'FOC2405D001', status: 'production', owner: 'Infrastructure', powerW: 260 },
  distB: { vendor: 'Cisco', model: 'C9300-48P', serial: 'FOC2405D002', status: 'production', owner: 'Infrastructure', powerW: 260 },
  accA: { vendor: 'Cisco', model: 'C9200-24P', serial: 'FOC2409A001', status: 'production', owner: 'Infrastructure', powerW: 180 },
  accB: { vendor: 'Cisco', model: 'C9200-24P', serial: 'FOC2409A002', status: 'production', owner: 'Infrastructure', powerW: 180 },
  wifiA: { vendor: 'Aruba', model: 'AP-635', status: 'production', owner: 'Infrastructure', powerW: 25 },
  wit: { status: 'production', owner: 'Production' },
}

export function sampleDiagram(): Diagram {
  return {
    title: 'Architecture haute disponibilité — siège + site de secours',
    racks: [
      { id: 'rack-a1', name: 'Baie A1', site: SIEGE, room: 'Salle serveurs', units: 42 },
      { id: 'rack-a2', name: 'Baie A2', site: SIEGE, room: 'Salle serveurs', units: 42 },
      { id: 'rack-pra', name: 'Baie PRA', site: PRA, room: 'Local technique', units: 24 },
    ],
    nodes: [
      node('net', 'internet', 'Internet'),
      node('isp1', 'wan', 'Opérateur A', { zone: 'WAN', notes: 'Fibre 1 Gb/s, chemin nord' }),
      node('isp2', 'wan', 'Opérateur B', { zone: 'WAN', notes: 'Fibre 1 Gb/s, chemin sud' }),

      node('rtr1', 'router', 'RTR-EDGE-01', { site: SIEGE, zone: 'DMZ', ip: '192.168.0.1', cluster: 'EDGE-VRRP', role: ACTIVE, vip: '192.168.0.254', dualPower: true }),
      node('rtr2', 'router', 'RTR-EDGE-02', { site: SIEGE, zone: 'DMZ', ip: '192.168.0.2', cluster: 'EDGE-VRRP', role: PASSIVE, vip: '192.168.0.254', dualPower: true }),

      node('fw1', 'firewall', 'FW-01', { site: SIEGE, zone: 'DMZ', model: 'FortiGate 100F', ip: '10.0.0.2', cluster: 'FW-HA', role: ACTIVE, vip: '10.0.0.254', dualPower: true }),
      node('fw2', 'firewall', 'FW-02', { site: SIEGE, zone: 'DMZ', model: 'FortiGate 100F', ip: '10.0.0.3', cluster: 'FW-HA', role: PASSIVE, vip: '10.0.0.254', dualPower: true }),

      node('core1', 'core-switch', 'SW-CORE-01', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.11', cluster: 'CORE-MLAG', role: AA, vip: '10.10.0.10', dualPower: true }),
      node('core2', 'core-switch', 'SW-CORE-02', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.12', cluster: 'CORE-MLAG', role: AA, vip: '10.10.0.10', dualPower: true }),

      node('distA', 'switch', 'SW-DIST-BATA', { site: SIEGE, zone: 'Bâtiment A', ip: '10.10.1.1' }),
      node('distB', 'switch', 'SW-DIST-BATB', { site: SIEGE, zone: 'Bâtiment B', ip: '10.10.2.1' }),
      node('accA', 'access-switch', 'SW-ACC-A1', { site: SIEGE, zone: 'Bâtiment A', vlan: 'VLAN 20' }),
      node('accB', 'access-switch', 'SW-ACC-B1', { site: SIEGE, zone: 'Bâtiment B', vlan: 'VLAN 30' }),
      node('wifiA', 'wifi', 'Bornes Wi-Fi A', { site: SIEGE, zone: 'Bâtiment A', vlan: 'VLAN 40' }),

      node('hv1', 'hypervisor', 'ESXi-01', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.21', cluster: 'CLUSTER-VM', role: AA, dualPower: true }),
      node('hv2', 'hypervisor', 'ESXi-02', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.22', cluster: 'CLUSTER-VM', role: AA, dualPower: true }),
      node('hv3', 'hypervisor', 'ESXi-03', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.23', cluster: 'CLUSTER-VM', role: AA, dualPower: true }),
      node('wit', 'witness', 'Témoin quorum', { site: 'Site tiers', cluster: 'CLUSTER-VM', role: 'witness', ip: '10.90.0.5', vlan: 'VLAN 90' }),
      node('san', 'storage', 'SAN Siège', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.30', vlan: 'VLAN 10', dualPower: true }),
      node('bkp', 'backup', 'Sauvegarde', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.35', vlan: 'VLAN 10' }),

      node('coreB', 'core-switch', 'CORE-PRA', { site: PRA, ip: '10.20.0.11', dualPower: true }),
      node('sanB', 'storage', 'SAN PRA', { site: PRA, ip: '10.20.0.30', dualPower: true }),

      node('pcA', 'workstation', 'Postes Bât. A', { site: SIEGE, zone: 'Bâtiment A', vlan: 'VLAN 20' }),
      node('pcB', 'workstation', 'Postes Bât. B', { site: SIEGE, zone: 'Bâtiment B', vlan: 'VLAN 30' }),
      node('imp', 'printer', 'Imprimantes', { site: SIEGE, zone: 'Bâtiment A', vlan: 'VLAN 50' }),

      node('upsA', 'ups', 'Onduleur A', { site: SIEGE, notes: 'Arrivée EDF 1' }),
      node('upsB', 'ups', 'Onduleur B', { site: SIEGE, notes: 'Arrivée EDF 2 + groupe' }),
      node('pduA', 'pdu', 'PDU A', { site: SIEGE }),
      node('pduB', 'pdu', 'PDU B', { site: SIEGE }),
    ].map((item) => ({ ...item, ...ASSETS[item.id] })),
    links: [
      link('net', 'isp1', 'wan', { speed: '1 Gb/s' }),
      link('net', 'isp2', 'wan', { speed: '1 Gb/s' }),

      link('isp1', 'rtr1', 'wan', { speed: '1 Gb/s', subnet: '203.0.113.0/30', ipA: '203.0.113.1', ipB: '203.0.113.2', routing: 'bgp', portB: 'Gi0/0/0' }),
      link('isp2', 'rtr2', 'wan', { speed: '1 Gb/s', subnet: '203.0.113.4/30', ipA: '203.0.113.5', ipB: '203.0.113.6', routing: 'bgp', portB: 'Gi0/0/0' }),
      link('isp1', 'rtr2', 'wan', { redundant: true, subnet: '203.0.113.8/30', ipA: '203.0.113.9', ipB: '203.0.113.10', routing: 'bgp' }),
      link('isp2', 'rtr1', 'wan', { redundant: true, subnet: '203.0.113.12/30', ipA: '203.0.113.13', ipB: '203.0.113.14', routing: 'bgp' }),
      link('rtr1', 'rtr2', 'heartbeat', { label: 'VRRP', vlans: '100', mode: 'access' }),

      link('rtr1', 'fw1', 'ethernet', { speed: '1 Gb/s', layers: ['l1', 'l2', 'l3'], vlans: '100', mode: 'access', subnet: '192.168.0.0/24', ipA: '192.168.0.1', ipB: '192.168.0.4', routing: 'static', portA: 'Gi0/0/1', portB: 'port1' }),
      link('rtr2', 'fw2', 'ethernet', { speed: '1 Gb/s', layers: ['l1', 'l2', 'l3'], vlans: '100', mode: 'access', subnet: '192.168.0.0/24', ipA: '192.168.0.2', ipB: '192.168.0.5', routing: 'static', portA: 'Gi0/0/1', portB: 'port1' }),
      link('rtr1', 'fw2', 'ethernet', { redundant: true }),
      link('rtr2', 'fw1', 'ethernet', { redundant: true }),
      link('fw1', 'fw2', 'heartbeat', { label: 'Synchro HA', vlans: '999', mode: 'access', portA: 'port10', portB: 'port10' }),

      link('fw1', 'core1', 'fiber', { speed: '10 Gb/s', layers: ['l1', 'l2', 'l3'], subnet: '10.0.0.0/29', ipA: '10.0.0.2', ipB: '10.0.0.5', routing: 'ospf', mtu: 9000, portA: 'port2', portB: 'Te1/0/1' }),
      link('fw2', 'core2', 'fiber', { speed: '10 Gb/s', layers: ['l1', 'l2', 'l3'], subnet: '10.0.0.0/29', ipA: '10.0.0.3', ipB: '10.0.0.6', routing: 'ospf', mtu: 9000, portA: 'port2', portB: 'Te1/0/1' }),
      link('fw1', 'core2', 'fiber', { redundant: true }),
      link('fw2', 'core1', 'fiber', { redundant: true }),
      link('core1', 'core2', 'stack', { label: 'MLAG', mode: 'trunk', vlans: '10,20,30,40,50,90', lag: 'Po1', mtu: 9000, portA: 'Te1/0/47', portB: 'Te1/0/47' }),

      link('core1', 'distA', 'fiber', { speed: '10 Gb/s', mode: 'trunk', vlans: '20,40,50', mtu: 9000, portA: 'Te1/0/1', portB: 'Te1/0/49', lagA: 'Po10', lagB: 'Po1', stpA: 'designated', stpB: 'root' }),
      link('core2', 'distA', 'fiber', { redundant: true, mode: 'trunk', vlans: '20,40,50', portA: 'Te1/0/1', portB: 'Te1/0/50', stpA: 'designated', stpB: 'alternate' }),
      link('core1', 'distB', 'fiber', { redundant: true, mode: 'trunk', vlans: '30', portA: 'Te1/0/2', portB: 'Te1/0/50', stpA: 'designated', stpB: 'alternate' }),
      link('core2', 'distB', 'fiber', { speed: '10 Gb/s', mode: 'trunk', vlans: '30', mtu: 9000, portA: 'Te1/0/2', portB: 'Te1/0/49', lagA: 'Po11', lagB: 'Po1', stpA: 'designated', stpB: 'root' }),

      link('distA', 'accA', 'ethernet', { speed: '1 Gb/s', mode: 'trunk', vlans: '20,50', nativeVlan: '1', portA: 'Gi1/0/1', portB: 'Gi0/1', stpA: 'designated', stpB: 'root' }),
      link('distA', 'wifiA', 'ethernet', { label: 'PoE+', mode: 'trunk', vlans: '40', nativeVlan: '1', portA: 'Gi1/0/8', portB: 'eth0', stpA: 'designated', stpB: 'edge' }),
      link('distB', 'accB', 'ethernet', { speed: '1 Gb/s', mode: 'trunk', vlans: '30', nativeVlan: '1', portA: 'Gi1/0/1', portB: 'Gi0/1', stpA: 'designated', stpB: 'root' }),
      link('accA', 'pcA', 'ethernet', { mode: 'access', vlans: '20', stp: 'edge' }),
      link('accA', 'imp', 'ethernet', { mode: 'access', vlans: '50', stp: 'edge' }),
      link('accB', 'pcB', 'ethernet', { mode: 'access', vlans: '30', stp: 'edge' }),

      link('core1', 'hv1', 'trunk', { speed: '10 Gb/s', mode: 'trunk', vlans: '10,90', lag: 'Po21', mtu: 9000 }),
      link('core2', 'hv1', 'trunk', { redundant: true, mode: 'trunk', vlans: '10,90', lag: 'Po21', mtu: 9000 }),
      link('core1', 'hv2', 'trunk', { redundant: true, mode: 'trunk', vlans: '10,90', lag: 'Po22', mtu: 9000 }),
      link('core2', 'hv2', 'trunk', { speed: '10 Gb/s', mode: 'trunk', vlans: '10,90', lag: 'Po22', mtu: 9000 }),
      link('core1', 'hv3', 'trunk', { speed: '10 Gb/s', mode: 'trunk', vlans: '10,90', lag: 'Po23', mtu: 9000 }),
      link('core2', 'hv3', 'trunk', { redundant: true, mode: 'trunk', vlans: '10,90', lag: 'Po23', mtu: 9000 }),
      link('hv1', 'hv2', 'heartbeat'),
      link('hv2', 'hv3', 'heartbeat'),
      link('wit', 'hv1', 'oob', { label: 'Quorum' }),
      link('wit', 'hv3', 'oob', { label: 'Quorum' }),

      link('hv1', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('hv2', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('hv3', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('san', 'bkp', 'replication', { label: 'Sauvegarde nocturne', subnet: '10.10.0.0/24', ipA: '10.10.0.30', ipB: '10.10.0.35' }),
      link('bkp', 'core1', 'ethernet'),

      link('core1', 'coreB', 'fiber', { label: 'Inter-sites', speed: '10 Gb/s', layers: ['l1', 'l2', 'l3'], subnet: '10.255.0.0/30', ipA: '10.255.0.1', ipB: '10.255.0.2', routing: 'ospf', mtu: 9000 }),
      link('core2', 'coreB', 'fiber', { redundant: true }),
      link('coreB', 'sanB', 'fiber', { speed: '10 Gb/s' }),
      link('san', 'sanB', 'replication', { label: 'Réplication asynchrone', subnet: '10.200.0.0/30', ipA: '10.200.0.1', ipB: '10.200.0.2' }),

      link('upsA', 'pduA', 'power', { label: 'Chaîne A' }),
      link('upsB', 'pduB', 'power', { label: 'Chaîne B' }),
    ],
    vlans: [
      { id: '1', name: 'Natif', notes: 'VLAN natif des trunks, volontairement sans adressage' },
      { id: '10', name: 'Serveurs', subnet: '10.10.0.0/24', gateway: '10.10.0.254' },
      { id: '20', name: 'Bureautique Bât. A', subnet: '10.10.20.0/24', gateway: '10.10.20.254' },
      { id: '30', name: 'Bureautique Bât. B', subnet: '10.10.30.0/24', gateway: '10.10.30.254' },
      { id: '40', name: 'Wi-Fi', subnet: '10.10.40.0/24', gateway: '10.10.40.254' },
      { id: '50', name: 'Impression', subnet: '10.10.50.0/24', gateway: '10.10.50.254' },
      { id: '90', name: 'Administration', subnet: '10.90.0.0/24', gateway: '10.90.0.254' },
      { id: '100', name: 'Interconnexion périmètre', subnet: '192.168.0.0/24', gateway: '192.168.0.254' },
      { id: '999', name: 'Synchronisation HA', notes: 'Non routé : lien direct entre les pare-feu' },
    ],
    // Cartouche renseigné : l'exemple montre ce qu'on attend d'un document qui circule.
    titleBlock: {
      show: false,
      organisation: 'Direction des systèmes d’information',
      reference: 'DOC-RES-001',
      version: 'B',
      author: 'Service réseau',
      status: 'Pour revue',
      confidentiality: 'Diffusion restreinte',
    },
    // Quelques lignes de matrice : de quoi montrer ce que le contrôle sait dire.
    flows: [
      {
        id: 'flux-portail',
        from: 'WAN',
        to: 'DMZ',
        service: 'HTTPS',
        protocol: 'TCP 443',
        action: 'autorise',
        purpose: 'Publication du portail usagers',
        owner: 'Direction métier',
        encryption: 'TLS 1.3',
      },
      {
        id: 'flux-bureautique',
        from: 'Bâtiment A',
        to: 'Datacenter',
        service: 'Applications métier',
        protocol: 'TCP 443, TCP 1433',
        action: 'autorise',
        purpose: 'Accès des postes aux applications hébergées',
        owner: 'Exploitation',
        encryption: 'TLS 1.2+',
      },
      {
        id: 'flux-admin',
        from: 'Datacenter',
        to: 'Bâtiment B',
        service: 'Administration',
        protocol: 'TCP 22, TCP 3389',
        action: 'refuse',
        purpose: 'Administration interdite depuis les postes bureautiques',
        owner: 'Sécurité',
      },
    ],
  }
}
