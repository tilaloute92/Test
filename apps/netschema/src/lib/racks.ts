import { deviceMeta } from './catalog'
import type { Diagram, NetNode, RackDef } from '../types'

/** Hauteur par défaut, en U, selon le type d'équipement. */
const DEFAULT_HEIGHTS: Record<string, number> = {
  server: 2,
  hypervisor: 2,
  hci: 2,
  baremetal: 2,
  'gpu-server': 4,
  storage: 4,
  'nvme-storage': 2,
  backup: 2,
  'tape-backup': 4,
  ups: 3,
  pdu: 1,
  'core-switch': 2,
  spine: 2,
  router: 1,
  firewall: 1,
  ngfw: 1,
  'san-switch': 1,
  'wlan-controller': 1,
  'net-controller': 1,
  'console-server': 1,
  'patch-panel': 1,
  ipbx: 2,
}

export function defaultHeight(kind: string): number {
  return DEFAULT_HEIGHTS[kind] ?? 1
}

export function heightOf(node: NetNode): number {
  return Math.max(1, node.heightU ?? defaultHeight(node.kind))
}

/** Équipements physiques : ceux qui ont vocation à occuper des U dans une baie. */
export function isRackable(node: NetNode): boolean {
  const meta = deviceMeta(node.kind)
  if (meta.rank === 0) return false
  const virtual = new Set([
    'cloud',
    'cloud-region',
    'vpc',
    'cloud-interconnect',
    'serverless',
    'k8s-cluster',
    'k8s-control-plane',
    'k8s-node',
    'service-mesh',
    'registry',
    'message-queue',
    'object-storage',
    'managed-db',
    'workstation',
    'printer',
    'phone',
    'camera',
    'iot-sensor',
    'witness',
    'dect',
    'visio',
    'wifi-bridge',
  ])
  return !virtual.has(node.kind)
}

export interface RackSlot {
  node: NetNode
  /** U de départ, 1 = unité la plus basse. */
  start: number
  height: number
}

export interface RackOccupancy {
  rack: RackDef
  slots: RackSlot[]
  /** Équipements rattachés à la baie mais sans position. */
  floating: NetNode[]
  usedUnits: number
  freeUnits: number
  powerW: number
  /** Chevauchements : plusieurs équipements sur la même unité. */
  conflicts: { unit: number; nodes: NetNode[] }[]
  /** Équipements dont la position dépasse la hauteur de la baie. */
  outOfBounds: NetNode[]
}

export function racksOf(diagram: Diagram): RackDef[] {
  return [...(diagram.racks ?? [])].sort(
    (a, b) => (a.site ?? '').localeCompare(b.site ?? '') || a.name.localeCompare(b.name),
  )
}

/**
 * Élévation d'une baie : qui occupe quelles unités, ce qui reste libre, ce qui se
 * chevauche. C'est la base de la vue « face avant » et des contrôles d'implantation.
 */
export function rackOccupancy(diagram: Diagram, rack: RackDef): RackOccupancy {
  const members = diagram.nodes.filter((node) => node.rack === rack.id)
  const slots: RackSlot[] = []
  const floating: NetNode[] = []
  const outOfBounds: NetNode[] = []

  for (const node of members) {
    if (!Number.isFinite(node.rackUnit) || (node.rackUnit ?? 0) < 1) {
      floating.push(node)
      continue
    }
    const height = heightOf(node)
    const start = Number(node.rackUnit)
    if (start + height - 1 > rack.units) outOfBounds.push(node)
    slots.push({ node, start, height })
  }

  const byUnit = new Map<number, NetNode[]>()
  for (const slot of slots) {
    for (let unit = slot.start; unit < slot.start + slot.height; unit += 1) {
      const bucket = byUnit.get(unit)
      if (bucket) bucket.push(slot.node)
      else byUnit.set(unit, [slot.node])
    }
  }

  const conflicts = [...byUnit.entries()]
    .filter(([, nodes]) => nodes.length > 1)
    .map(([unit, nodes]) => ({ unit, nodes }))
    .sort((a, b) => a.unit - b.unit)

  const usedUnits = [...byUnit.keys()].filter((unit) => unit >= 1 && unit <= rack.units).length

  return {
    rack,
    slots: slots.sort((a, b) => b.start - a.start),
    floating,
    usedUnits,
    freeUnits: Math.max(0, rack.units - usedUnits),
    powerW: members.reduce((acc, node) => acc + (node.powerW ?? 0), 0),
    conflicts,
    outOfBounds,
  }
}

/** Première position libre pouvant accueillir `height` U, en partant du bas. */
export function firstFreeUnit(occupancy: RackOccupancy, height: number): number | null {
  const taken = new Set<number>()
  for (const slot of occupancy.slots) {
    for (let unit = slot.start; unit < slot.start + slot.height; unit += 1) taken.add(unit)
  }
  for (let start = 1; start + height - 1 <= occupancy.rack.units; start += 1) {
    let free = true
    for (let unit = start; unit < start + height; unit += 1) {
      if (taken.has(unit)) {
        free = false
        break
      }
    }
    if (free) return start
  }
  return null
}

/** Équipements physiques non rattachés à une baie. */
export function unrackedNodes(diagram: Diagram): NetNode[] {
  return diagram.nodes.filter((node) => isRackable(node) && !node.rack?.trim())
}
