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
export function sampleDiagram(): Diagram {
  return {
    title: 'Architecture haute disponibilité — siège + site de secours',
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
      node('wit', 'witness', 'Témoin quorum', { site: 'Site tiers', cluster: 'CLUSTER-VM', role: 'witness', ip: '10.90.0.5' }),
      node('san', 'storage', 'SAN Siège', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.30', dualPower: true }),
      node('bkp', 'backup', 'Sauvegarde', { site: SIEGE, zone: 'Datacenter', ip: '10.10.0.35' }),

      node('coreB', 'core-switch', 'CORE-PRA', { site: PRA, ip: '10.20.0.11', dualPower: true }),
      node('sanB', 'storage', 'SAN PRA', { site: PRA, ip: '10.20.0.30', dualPower: true }),

      node('pcA', 'workstation', 'Postes Bât. A', { site: SIEGE, zone: 'Bâtiment A', vlan: 'VLAN 20' }),
      node('pcB', 'workstation', 'Postes Bât. B', { site: SIEGE, zone: 'Bâtiment B', vlan: 'VLAN 30' }),
      node('imp', 'printer', 'Imprimantes', { site: SIEGE, zone: 'Bâtiment A', vlan: 'VLAN 50' }),

      node('upsA', 'ups', 'Onduleur A', { site: SIEGE, notes: 'Arrivée EDF 1' }),
      node('upsB', 'ups', 'Onduleur B', { site: SIEGE, notes: 'Arrivée EDF 2 + groupe' }),
      node('pduA', 'pdu', 'PDU A', { site: SIEGE }),
      node('pduB', 'pdu', 'PDU B', { site: SIEGE }),
    ],
    links: [
      link('net', 'isp1', 'wan', { speed: '1 Gb/s' }),
      link('net', 'isp2', 'wan', { speed: '1 Gb/s' }),

      link('isp1', 'rtr1', 'wan', { speed: '1 Gb/s' }),
      link('isp2', 'rtr2', 'wan', { speed: '1 Gb/s' }),
      link('isp1', 'rtr2', 'wan', { redundant: true }),
      link('isp2', 'rtr1', 'wan', { redundant: true }),
      link('rtr1', 'rtr2', 'heartbeat', { label: 'VRRP' }),

      link('rtr1', 'fw1', 'ethernet', { speed: '1 Gb/s' }),
      link('rtr2', 'fw2', 'ethernet', { speed: '1 Gb/s' }),
      link('rtr1', 'fw2', 'ethernet', { redundant: true }),
      link('rtr2', 'fw1', 'ethernet', { redundant: true }),
      link('fw1', 'fw2', 'heartbeat', { label: 'Synchro HA' }),

      link('fw1', 'core1', 'fiber', { speed: '10 Gb/s' }),
      link('fw2', 'core2', 'fiber', { speed: '10 Gb/s' }),
      link('fw1', 'core2', 'fiber', { redundant: true }),
      link('fw2', 'core1', 'fiber', { redundant: true }),
      link('core1', 'core2', 'stack', { label: 'MLAG' }),

      link('core1', 'distA', 'fiber', { speed: '10 Gb/s' }),
      link('core2', 'distA', 'fiber', { redundant: true }),
      link('core1', 'distB', 'fiber', { redundant: true }),
      link('core2', 'distB', 'fiber', { speed: '10 Gb/s' }),

      link('distA', 'accA', 'ethernet', { speed: '1 Gb/s' }),
      link('distA', 'wifiA', 'ethernet', { label: 'PoE+' }),
      link('distB', 'accB', 'ethernet', { speed: '1 Gb/s' }),
      link('accA', 'pcA', 'ethernet'),
      link('accA', 'imp', 'ethernet'),
      link('accB', 'pcB', 'ethernet'),

      link('core1', 'hv1', 'trunk', { speed: '10 Gb/s' }),
      link('core2', 'hv1', 'trunk', { redundant: true }),
      link('core1', 'hv2', 'trunk', { redundant: true }),
      link('core2', 'hv2', 'trunk', { speed: '10 Gb/s' }),
      link('core1', 'hv3', 'trunk', { speed: '10 Gb/s' }),
      link('core2', 'hv3', 'trunk', { redundant: true }),
      link('hv1', 'hv2', 'heartbeat'),
      link('hv2', 'hv3', 'heartbeat'),
      link('wit', 'hv1', 'oob', { label: 'Quorum' }),
      link('wit', 'hv3', 'oob', { label: 'Quorum' }),

      link('hv1', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('hv2', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('hv3', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('san', 'bkp', 'replication', { label: 'Sauvegarde nocturne' }),
      link('bkp', 'core1', 'ethernet'),

      link('core1', 'coreB', 'fiber', { label: 'Inter-sites', speed: '10 Gb/s' }),
      link('core2', 'coreB', 'fiber', { redundant: true }),
      link('coreB', 'sanB', 'fiber', { speed: '10 Gb/s' }),
      link('san', 'sanB', 'replication', { label: 'Réplication asynchrone' }),

      link('upsA', 'pduA', 'power', { label: 'Chaîne A' }),
      link('upsB', 'pduB', 'power', { label: 'Chaîne B' }),
    ],
  }
}
