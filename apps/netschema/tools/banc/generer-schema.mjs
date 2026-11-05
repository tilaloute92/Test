/**
 * Génère un schéma de charge à la forme exacte d'un fichier NetSchema.
 *
 *   node tools/banc/generer-schema.mjs 800
 *
 * La topologie est plausible — cœur redondé, distribution par bâtiment, accès par étage,
 * serveurs et postes — et les équipements sont placés en couches. Des équipements tous
 * posés au même point donneraient un cadrage absurde et une mesure sans valeur.
 */
// Génère un schéma réaliste : cœur redondé, distribution par bâtiment, accès par étage,
// serveurs et postes. Même forme de fichier que l'application.
import { writeFileSync } from 'node:fs'

let compteur = 0
const uid = (p) => `${p}${(compteur++).toString(36)}`

export function generer(cible) {
  const nodes = []
  const links = []
  const vlans = []
  const racks = []
  // Placement en couches, comme le ferait le placement automatique : sans coordonnées
  // plausibles, tout le schéma se superpose en un point et la mesure ne vaut rien.
  const RANGS = { internet: 0, firewall: 1, 'core-switch': 2, switch: 3, 'access-switch': 4,
    server: 5, workstation: 5, printer: 5 }
  const parRang = {}
  const ajouter = (kind, name, extra = {}) => {
    const rang = RANGS[kind] ?? 5
    parRang[rang] = (parRang[rang] ?? 0) + 1
    const colonne = parRang[rang] - 1
    const n = { id: uid('n'), kind, name, x: 80 + (colonne % 40) * 230, 
                y: 80 + rang * 320 + Math.floor(colonne / 40) * 140, ...extra }
    nodes.push(n)
    return n
  }
  const relier = (a, b, extra = {}) => {
    links.push({ id: uid('l'), from: a.id, to: b.id, kind: 'ethernet', layers: ['l1', 'l2'], ...extra })
  }

  for (let v = 10; v <= 60; v += 10) {
    vlans.push({ id: String(v), name: `VLAN ${v}`, subnet: `10.${v}.0.0/24`, gateway: `10.${v}.0.254` })
  }

  const net = ajouter('internet', 'Internet', { site: 'Externe' })
  const fw1 = ajouter('firewall', 'FW-01', { site: 'Siège', zone: 'Sécurité', cluster: 'FW-HA', role: 'actif' })
  const fw2 = ajouter('firewall', 'FW-02', { site: 'Siège', zone: 'Sécurité', cluster: 'FW-HA', role: 'passif' })
  const c1 = ajouter('core-switch', 'SW-CORE-01', { site: 'Siège', zone: 'Cœur', cluster: 'CORE-MLAG', role: 'actif' })
  const c2 = ajouter('core-switch', 'SW-CORE-02', { site: 'Siège', zone: 'Cœur', cluster: 'CORE-MLAG', role: 'actif' })
  relier(net, fw1, { speed: '10 Gb/s' })
  relier(net, fw2, { speed: '10 Gb/s' })
  relier(fw1, c1, { speed: '10 Gb/s' }); relier(fw2, c2, { speed: '10 Gb/s' })
  relier(c1, c2, { speed: '40 Gb/s', label: 'Peer-link', lag: 'Po1' })
  relier(c1, c2, { speed: '40 Gb/s', label: 'Peer-link', lag: 'Po1', portA: 'Eth1/2', portB: 'Eth1/2' })

  let batiment = 0
  while (nodes.length < cible) {
    batiment += 1
    const site = `Bâtiment ${String.fromCharCode(64 + ((batiment - 1) % 26) + 1)}${batiment > 26 ? Math.ceil(batiment / 26) : ''}`
    racks.push({ id: uid('r'), name: `Baie ${batiment}`, site, room: 'Local technique', units: 42 })
    const baie = racks[racks.length - 1].name
    const d1 = ajouter('switch', `SW-DIST-${batiment}A`, { site, zone: 'Distribution', rack: baie, vendor: 'Cisco', model: 'C9300-48P' })
    const d2 = ajouter('switch', `SW-DIST-${batiment}B`, { site, zone: 'Distribution', rack: baie, vendor: 'Cisco', model: 'C9300-48P' })
    relier(c1, d1, { speed: '10 Gb/s', lag: `Po${batiment}`, portA: `Eth1/${batiment}`, portB: 'Te1/1/1' })
    relier(c2, d1, { speed: '10 Gb/s', lag: `Po${batiment}`, portA: `Eth1/${batiment}`, portB: 'Te1/1/2' })
    relier(c1, d2, { speed: '10 Gb/s' }); relier(c2, d2, { speed: '10 Gb/s' })
    for (let etage = 1; etage <= 4 && nodes.length < cible; etage += 1) {
      const acc = ajouter('access-switch', `SW-ACC-${batiment}-${etage}`,
        { site, zone: 'Accès', rack: baie, vendor: 'Cisco', model: 'C9200-24P', vlan: String(10 * ((etage % 6) + 1)) })
      relier(d1, acc, { speed: '10 Gb/s', mode: 'trunk', vlans: '10,20,30' })
      relier(d2, acc, { speed: '10 Gb/s', mode: 'trunk', vlans: '10,20,30' })
      for (let k = 0; k < 3 && nodes.length < cible; k += 1) {
        const type = k === 0 ? 'server' : k === 1 ? 'workstation' : 'printer'
        const p = ajouter(type, `${type.slice(0, 3).toUpperCase()}-${batiment}-${etage}-${k}`,
          { site, zone: 'Accès', rack: baie, vlan: String(10 * ((etage % 6) + 1)),
            status: k === 0 ? 'production' : 'stock', ip: `10.${10 * ((etage % 6) + 1)}.${batiment % 254}.${k + 10}` })
        relier(acc, p, { speed: '1 Gb/s', mode: 'access' })
      }
    }
  }
  return { version: 1, diagram: { title: `Charge ${nodes.length}`, pageName: 'Schéma', nodes, links, vlans, racks } }
}

if (process.argv[2]) {
  const n = Number(process.argv[2])
  const d = generer(n)
  const dossier = process.env.BANC_DIR ?? new URL('.', import.meta.url).pathname
  const f = `${dossier}charge-${n}.json`
  writeFileSync(f, JSON.stringify(d))
  console.log(`${f} — ${d.diagram.nodes.length} équipements, ${d.diagram.links.length} liaisons`)
}
