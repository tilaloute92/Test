import { useEffect, useMemo, useRef, useState } from 'react'
import { deviceMeta, searchDevices } from '../lib/catalog'
import { collapsibleGroups } from '../lib/derive'
import { downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { DeviceIcon } from '../lib/icons'
import { GRID, useDiagram } from '../store/useDiagram'

interface Item {
  id: string
  label: string
  hint?: string
  icon?: { id: string; color: string }
  run: () => void
}

/**
 * Palette de commandes (Ctrl+K) : une seule entrée pour tout faire — lancer une action,
 * ajouter n'importe quel type d'équipement du catalogue, ou retrouver un équipement du
 * schéma et s'y rendre. C'est le raccourci qui évite de chercher dans les menus quand le
 * schéma devient gros.
 */
export function CommandPalette({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const open = useDiagram((s) => s.commandOpen)
  // Le contenu n'est monté que pendant l'ouverture : la recherche repart donc toujours
  // d'une saisie vide, sans avoir à la réinitialiser après coup.
  return open ? <PaletteDialog svgRef={svgRef} /> : null
}

function PaletteDialog({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [query, setQuery] = useState('')
  const [wanted, setWanted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items = useMemo(() => buildItems(query, svgRef), [query, svgRef])
  const cursor = Math.min(wanted, Math.max(0, items.length - 1))

  const close = () => useDiagram.getState().setCommandOpen(false)
  const runAt = (index: number) => {
    const item = items[index]
    if (!item) return
    close()
    item.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 pt-24"
      onPointerDown={close}
    >
      <div
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setWanted(Math.min(cursor + 1, items.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setWanted(Math.max(cursor - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              runAt(cursor)
            } else if (event.key === 'Escape') {
              close()
            }
          }}
          placeholder="Commande, équipement à ajouter, nom à retrouver…"
          className="w-full border-b border-slate-100 px-4 py-3 text-[14px] outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onPointerEnter={() => setWanted(index)}
                onClick={() => runAt(index)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] ${
                  index === cursor ? 'bg-blue-50 text-blue-900' : 'text-slate-700'
                }`}
              >
                {item.icon ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0">
                    <DeviceIcon icon={item.icon.id} color={item.icon.color} />
                  </svg>
                ) : (
                  <span className="h-[18px] w-[18px] shrink-0 rounded bg-slate-100" />
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-[11px] text-slate-400">{item.hint}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-slate-400">Aucun résultat.</li>
          )}
        </ul>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          ↑ ↓ pour naviguer · Entrée pour valider · Échap pour fermer
        </p>
      </div>
    </div>
  )
}

function centerOfView() {
  const { view, canvasSize, snap } = useDiagram.getState()
  const raw = {
    x: (canvasSize.width / 2 - view.tx) / view.zoom,
    y: (canvasSize.height / 2 - view.ty) / view.zoom,
  }
  return snap
    ? { x: Math.round(raw.x / GRID) * GRID, y: Math.round(raw.y / GRID) * GRID }
    : { x: Math.round(raw.x), y: Math.round(raw.y) }
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function buildItems(query: string, svgRef: React.RefObject<SVGSVGElement | null>): Item[] {
  const store = useDiagram.getState
  const q = normalize(query.trim())

  const actions: Item[] = [
    { id: 'layout', label: 'Placement automatique', hint: 'mise en page', run: () => store().applyAutoLayout() },
    { id: 'fit', label: 'Ajuster la vue', hint: 'vue', run: () => store().fitView() },
    { id: 'connect', label: 'Mode Relier', hint: 'L', run: () => store().setMode('connect') },
    { id: 'duplicate', label: 'Dupliquer la sélection', hint: 'Ctrl+D', run: () => store().duplicateSelection() },
    {
      id: 'front',
      label: 'Mettre la sélection au premier plan',
      hint: 'Ctrl+Maj+F',
      run: () => store().reorderNodes(store().selectedNodes, 'front'),
    },
    {
      id: 'back',
      label: 'Mettre la sélection à l’arrière-plan',
      hint: 'Ctrl+Maj+B',
      run: () => store().reorderNodes(store().selectedNodes, 'back'),
    },
    { id: 'import', label: 'Import rapide (coller une liste)', hint: 'Ctrl+I', run: () => store().setImportOpen(true) },
    { id: 'note', label: 'Poser une note sur le plan', hint: 'annotation', run: () => store().addAnnotation('note') },
    { id: 'cadre', label: 'Encadrer un périmètre', hint: 'annotation', run: () => store().addAnnotation('zone') },
    { id: 'fleche', label: 'Poser une flèche de renvoi', hint: 'annotation', run: () => store().addAnnotation('arrow') },
    {
      id: 'cartouche',
      label: 'Afficher le cartouche du document',
      hint: 'document',
      run: () => store().setTitleBlock({ show: true }),
    },
    {
      id: 'legende',
      label: 'Afficher la légende sous le schéma',
      hint: 'document',
      run: () => store().setDisplay({ showLegend: true }),
    },
    { id: 'flux', label: 'Matrice de flux', hint: 'module', run: () => store().setAppView('flows') },
    {
      id: 'chemin',
      label: 'Tracer un chemin entre deux équipements',
      hint: 'module',
      run: () => store().setAppView('flows'),
    },
    {
      id: 'dossier',
      label: 'Dossier : complétude, dossier technique, comparaison',
      hint: 'module',
      run: () => store().setAppView('dossier'),
    },
    { id: 'inventaire', label: 'Inventaire du parc', hint: 'module', run: () => store().setAppView('inventory') },
    { id: 'baies', label: 'Implantation en baies', hint: 'module', run: () => store().setAppView('racks') },
    { id: 'ha', label: 'Analyse haute disponibilité', hint: 'panneau', run: () => store().setPanel('ha') },
    {
      id: 'ha-deduire',
      label: 'Déduire le mécanisme de bascule des grappes',
      hint: 'haute dispo',
      run: () => {
        const { grappes, equipements } = store().deduireMecanismesHa()
        store().setPanel('ha')
        store().notify(
          grappes > 0
            ? `${grappes} grappe(s) documentée(s) sur ${equipements} équipement(s), à vérifier.`
            : 'Rien à déduire : les grappes documentent déjà leur mécanisme.',
        )
      },
    },
    { id: 'catalog', label: 'Catalogue d’équipements', hint: 'panneau', run: () => store().setPanel('catalog') },
    {
      id: 'collapse-all',
      label: 'Replier toutes les zones',
      hint: 'lisibilité',
      run: () =>
        store().setCollapsed(
          collapsibleGroups(store().diagram)
            .filter((group) => group.type === 'zone')
            .map((group) => group.key),
        ),
    },
    { id: 'expand-all', label: 'Tout déplier', hint: 'lisibilité', run: () => store().setCollapsed([]) },
    { id: 'osi-all', label: 'Vue OSI : toutes les couches', hint: 'couche', run: () => store().setOsi('all') },
    { id: 'osi-l1', label: 'Vue OSI : niveau 1 — physique (ports, débits)', hint: 'couche', run: () => store().setOsi('l1') },
    { id: 'osi-l2', label: 'Vue OSI : niveau 2 — liaison (VLAN, agrégats, STP)', hint: 'couche', run: () => store().setOsi('l2') },
    { id: 'osi-l3', label: 'Vue OSI : niveau 3 — réseau (sous-réseaux, routage)', hint: 'couche', run: () => store().setOsi('l3') },
    { id: 'vlans', label: 'Plan d’adressage (VLAN et sous-réseaux)', hint: 'panneau', run: () => store().setPanel('osi') },
    { id: 'detail-full', label: 'Détail : complet', hint: 'affichage', run: () => store().setDetail('full') },
    { id: 'detail-no-endpoints', label: 'Détail : sans les postes', hint: 'affichage', run: () => store().setDetail('no-endpoints') },
    { id: 'detail-summary', label: 'Détail : synthèse (cœur & sécurité)', hint: 'affichage', run: () => store().setDetail('summary') },
    {
      id: 'export-svg',
      label: 'Exporter en SVG',
      hint: 'export',
      run: () => svgRef.current && downloadSvg(svgRef.current, `${slugify(store().diagram.title)}.svg`),
    },
    {
      id: 'export-png',
      label: 'Exporter en PNG',
      hint: 'export',
      run: () => svgRef.current && void downloadPng(svgRef.current, `${slugify(store().diagram.title)}.png`, 2),
    },
    { id: 'sample', label: 'Charger le schéma d’exemple', hint: 'projet', run: () => store().loadSample() },
    { id: 'new', label: 'Nouveau schéma', hint: 'projet', run: () => store().newDiagram() },
  ]

  if (!q) return actions

  const matchedActions = actions.filter((item) => normalize(item.label).includes(q))

  const devices: Item[] = searchDevices(query)
    .slice(0, 8)
    .map((device) => ({
      id: `add:${device.id}`,
      label: `Ajouter : ${device.label}`,
      hint: device.family,
      icon: { id: device.icon, color: device.accent },
      run: () => {
        const center = centerOfView()
        store().addNode(device.id, center.x, center.y)
      },
    }))

  const nodes: Item[] = store()
    .diagram.nodes.filter((node) => normalize(node.name).includes(q) || normalize(node.ip ?? '').includes(q))
    .slice(0, 8)
    .map((node) => {
      const meta = deviceMeta(node.kind)
      return {
        id: `goto:${node.id}`,
        label: `Aller à : ${node.name}`,
        hint: [node.ip, meta.label].filter(Boolean).join(' · '),
        icon: { id: meta.icon, color: meta.accent },
        run: () => store().focusNode(node.id),
      }
    })

  return [...matchedActions, ...devices, ...nodes]
}
