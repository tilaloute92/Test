import type { Diagram, DeviceKind, LinkKind, NetLink, NetNode } from '../types'

function node(
  id: string,
  kind: DeviceKind,
  name: string,
  extra: Partial<NetNode> = {},
): NetNode {
  return { id, kind, name, x: 0, y: 0, ...extra }
}

function link(from: string, to: string, kind: LinkKind, extra: Partial<NetLink> = {}): NetLink {
  return { id: `l_${from}_${to}`, from, to, kind, ...extra }
}

/**
 * Exemple de départ : un siège avec cœur redondé et une agence raccordée en MPLS.
 * Les coordonnées sont laissées à zéro — le placement automatique s'en charge au chargement.
 */
export function sampleDiagram(): Diagram {
  return {
    title: 'Siège + agence — schéma type',
    nodes: [
      node('net', 'internet', 'Internet', { notes: 'Accès fibre 1 Gb/s' }),
      node('mpls', 'wan', 'MPLS opérateur', { zone: 'WAN' }),
      node('rtr', 'router', 'RTR-EDGE-01', { model: 'ISR 4331', ip: '10.0.0.1', zone: 'DMZ' }),
      node('fw1', 'firewall', 'FW-01 (actif)', { model: 'FortiGate 100F', ip: '10.0.0.2', zone: 'DMZ' }),
      node('fw2', 'firewall', 'FW-02 (passif)', { model: 'FortiGate 100F', ip: '10.0.0.3', zone: 'DMZ' }),
      node('core1', 'core-switch', 'SW-CORE-01', { ip: '10.10.0.11', vlan: 'VLAN 1-90', zone: 'Datacenter' }),
      node('core2', 'core-switch', 'SW-CORE-02', { ip: '10.10.0.12', vlan: 'VLAN 1-90', zone: 'Datacenter' }),
      node('distA', 'switch', 'SW-DIST-BATA', { ip: '10.10.1.1', zone: 'Bâtiment A' }),
      node('distB', 'switch', 'SW-DIST-BATB', { ip: '10.10.2.1', zone: 'Bâtiment B' }),
      node('accA1', 'access-switch', 'SW-ACC-A1', { vlan: 'VLAN 20', zone: 'Bâtiment A' }),
      node('accB1', 'access-switch', 'SW-ACC-B1', { vlan: 'VLAN 30', zone: 'Bâtiment B' }),
      node('wifiA', 'wifi', 'Bornes Wi-Fi A', { vlan: 'VLAN 40', zone: 'Bâtiment A' }),
      node('esx1', 'server', 'ESXi-01', { ip: '10.10.0.21', zone: 'Datacenter' }),
      node('esx2', 'server', 'ESXi-02', { ip: '10.10.0.22', zone: 'Datacenter' }),
      node('ad', 'server', 'AD / DNS', { ip: '10.10.0.25', zone: 'Datacenter' }),
      node('san', 'storage', 'Baie SAN', { ip: '10.10.0.30', zone: 'Datacenter' }),
      node('pcA', 'workstation', 'Postes Bât. A', { vlan: 'VLAN 20', zone: 'Bâtiment A' }),
      node('pcB', 'workstation', 'Postes Bât. B', { vlan: 'VLAN 30', zone: 'Bâtiment B' }),
      node('impA', 'printer', 'Imprimantes', { vlan: 'VLAN 50', zone: 'Bâtiment A' }),
    ],
    links: [
      link('net', 'rtr', 'wan', { speed: '1 Gb/s' }),
      link('mpls', 'rtr', 'vpn', { label: 'Agence Lyon' }),
      link('rtr', 'fw1', 'ethernet', { speed: '1 Gb/s' }),
      link('rtr', 'fw2', 'ethernet', { redundant: true }),
      link('fw1', 'core1', 'fiber', { speed: '10 Gb/s' }),
      link('fw2', 'core2', 'fiber', { speed: '10 Gb/s', redundant: true }),
      link('core1', 'core2', 'trunk', { label: 'MLAG' }),
      link('core1', 'distA', 'fiber', { speed: '10 Gb/s' }),
      link('core2', 'distA', 'fiber', { redundant: true }),
      link('core1', 'distB', 'fiber', { redundant: true }),
      link('core2', 'distB', 'fiber', { speed: '10 Gb/s' }),
      link('core1', 'esx1', 'trunk', { speed: '10 Gb/s' }),
      link('core2', 'esx2', 'trunk', { speed: '10 Gb/s' }),
      link('core1', 'ad', 'ethernet'),
      link('core2', 'san', 'fiber', { speed: '16 Gb FC' }),
      link('distA', 'accA1', 'ethernet', { speed: '1 Gb/s' }),
      link('distA', 'wifiA', 'ethernet', { label: 'PoE+' }),
      link('distB', 'accB1', 'ethernet', { speed: '1 Gb/s' }),
      link('accA1', 'pcA', 'ethernet'),
      link('accA1', 'impA', 'ethernet'),
      link('accB1', 'pcB', 'ethernet'),
    ],
  }
}
