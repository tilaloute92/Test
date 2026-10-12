import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Btn } from './ui'
import { deviceMeta } from '../lib/catalog'
import { downloadBlob, slugify } from '../lib/exportImage'
import { DeviceIcon } from '../lib/icons'
import {
  INVENTORY_COLUMNS,
  inventoryToCsv,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../lib/inventory'
import { ModelPicker } from './ModelPicker'
import { vendors } from '../lib/vendors'
import { useDiagram } from '../store/useDiagram'
import type { AssetStatus, Diagram, NetNode } from '../types'

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as AssetStatus[]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Inventaire du parc : la même base d'équipements que le schéma, vue comme une table
 * d'actifs — constructeur, modèle, numéro de série, immobilisation, garantie,
 * responsable, implantation en baie, consommation.
 */
/** Hauteur de repli, le temps qu'une première ligne soit peinte et mesurée. */
const HAUTEUR_LIGNE_DEFAUT = 33
/** Lignes montées de part et d'autre de la fenêtre, pour que le défilement reste plein. */
const MARGE_LIGNES = 8

export function InventoryView() {
  const diagram = useDiagram((s) => s.diagram)
  const updateNode = useDiagram((s) => s.updateNode)
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const select = useDiagram((s) => s.select)
  const notify = useDiagram((s) => s.notify)
  const updateNodes = useDiagram((s) => s.updateNodes)
  const fileRef = useRef<HTMLInputElement>(null)
  const cadreRef = useRef<HTMLDivElement>(null)
  /** Dernière ligne cliquée, pour que Maj sélectionne la plage comme dans un tableur. */
  const ancre = useRef<string | null>(null)

  const [query, setQuery] = useState('')
  const [site, setSite] = useState('')
  const [status, setStatus] = useState('')
  const [rack, setRack] = useState('')
  const [vendor, setVendor] = useState('')

  // Constructeurs présents dans le parc, puis ceux de la base matériels.
  const vendorOptions = useMemo(() => {
    const used = new Set(diagram.nodes.map((node) => node.vendor?.trim()).filter(Boolean) as string[])
    return [...new Set([...used, ...vendors()])].sort((a, b) => a.localeCompare(b))
  }, [diagram.nodes])

  const sites = useMemo(
    () => [...new Set(diagram.nodes.map((node) => node.site?.trim()).filter(Boolean))].sort() as string[],
    [diagram.nodes],
  )

  /**
   * Sélection de lignes aux habitudes du tableur : clic simple, Ctrl ou Cmd pour ajouter une
   * ligne, Maj pour prendre toute la plage depuis la dernière cliquée. C'est ce geste qui
   * rend le remplissage en lot utilisable — sans lui, il faudrait cocher trente cases.
   */
  /*
    Le filtre travaille sur une valeur différée : la frappe reste fluide pendant que React
    recalcule les lignes. Sur 205 équipements, filtrer coûtait entre 550 et 1 100 ms par
    touche, et chaque caractère bloquait le champ.
  */
  const recherche = useDeferredValue(query)
  const rows = useMemo(() => {
    const q = normalize(recherche.trim())
    return diagram.nodes
      .filter((node) => {
        if (site && node.site !== site) return false
        if (vendor && node.vendor !== vendor) return false
        if (status && node.status !== status) return false
        if (rack === '__none' && node.rack) return false
        if (rack && rack !== '__none' && node.rack !== rack) return false
        if (!q) return true
        const haystack = [
          node.name,
          node.ip,
          node.serial,
          node.model,
          node.vendor,
          node.assetTag,
          node.owner,
          deviceMeta(node.kind).label,
        ]
          .filter(Boolean)
          .join(' ')
        return normalize(haystack).includes(q)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [diagram.nodes, recherche, site, status, rack, vendor])

  /*
    Rendu par fenêtre.

    Monter deux cent cinq lignes de dix-sept cellules coûtait près d'une seconde à chaque
    ouverture de l'onglet, alors qu'une vingtaine tient à l'écran. On ne monte donc que ce
    qui est visible, plus une marge de part et d'autre pour que le défilement ne laisse
    jamais de vide le temps d'un rendu.

    La hauteur de ligne est fixe et connue : toutes les cellules ont la même mise en forme.
    C'est ce qui permet de se passer d'une mesure et de calculer la fenêtre d'une soustraction.
  */
  const [defilement, setDefilement] = useState(0)
  const [hauteurVue, setHauteurVue] = useState(800)
  /*
    La hauteur d'une ligne n'est pas devinée mais relevée sur une ligne réelle, après le
    premier rendu. Une valeur approchée paraît marcher en haut du tableau et rend les
    dernières lignes inatteignables en bas, l'écart s'accumulant à chaque ligne.
  */
  const [hauteurLigne, setHauteurLigne] = useState(HAUTEUR_LIGNE_DEFAUT)
  useEffect(() => {
    const cadre = cadreRef.current
    if (!cadre) return
    const mesurer = () => {
      setHauteurVue(cadre.clientHeight)
      const ligne = cadre.querySelector('tbody tr:not([aria-hidden])')
      const haut = ligne?.getBoundingClientRect().height
      if (haut && haut > 4) setHauteurLigne((precedent) => (Math.abs(precedent - haut) > 0.5 ? haut : precedent))
    }
    mesurer()
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(cadre)
    return () => observateur.disconnect()
  })

  const premiere = Math.max(0, Math.floor(defilement / hauteurLigne) - MARGE_LIGNES)
  const derniere = Math.min(rows.length, Math.ceil((defilement + hauteurVue) / hauteurLigne) + MARGE_LIGNES)
  const visibles = rows.slice(premiere, derniere)
  const avant = premiere
  const apres = rows.length - derniere

  const choisirLigne = (event: React.MouseEvent, id: string) => {
    if (event.shiftKey && ancre.current) {
      const debut = rows.findIndex((n) => n.id === ancre.current)
      const fin = rows.findIndex((n) => n.id === id)
      if (debut !== -1 && fin !== -1) {
        const plage = rows.slice(Math.min(debut, fin), Math.max(debut, fin) + 1).map((n) => n.id)
        select({ nodes: plage })
        return
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const deja = selectedNodes.includes(id)
      select({ nodes: deja ? selectedNodes.filter((n) => n !== id) : [...selectedNodes, id] })
      ancre.current = id
      return
    }
    select({ nodes: [id] })
    ancre.current = id
  }

  /** Lignes sélectionnées parmi celles qu'affichent les filtres. */
  const selectionVisible = rows.filter((n) => selectedNodes.includes(n.id))


  const totalPower = rows.reduce((acc, node) => acc + (node.powerW ?? 0), 0)

  const exportCsv = () => {
    downloadBlob(
      new Blob([inventoryToCsv(diagram, rows)], { type: 'text/csv;charset=utf-8' }),
      `${slugify(diagram.title)}-inventaire.csv`,
    )
  }

  const importCsv = async (file: File | undefined) => {
    if (!file) return
    const result = useDiagram.getState().applyInventoryCsv(await file.text())
    notify(
      `${result.updated} équipement(s) mis à jour, ${result.created} créé(s).` +
        (result.warnings.length > 0 ? ` ${result.warnings[0]}` : ''),
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un nom, une IP, un n° de série…"
          className="w-72 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Tous les sites</option>
          {sites.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Tous les statuts</option>
          {STATUS_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {STATUS_LABELS[item]}
            </option>
          ))}
        </select>
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Tous les constructeurs</option>
          {vendorOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={rack} onChange={(e) => setRack(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Toutes les baies</option>
          <option value="__none">Non implantés</option>
          {(diagram.racks ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-slate-500">
            {rows.length} ligne(s){totalPower > 0 ? ` · ${totalPower} W` : ''}
          </span>
          <Btn onClick={exportCsv}>Exporter CSV</Btn>
          <Btn onClick={() => fileRef.current?.click()}>Importer CSV</Btn>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              void importCsv(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
      </header>

      <BarreRemplissage
        selection={selectionVisible}
        lignes={rows}
        surTout={() => select({ nodes: rows.map((n) => n.id) })}
        surAppliquer={(patch) => {
          updateNodes(selectionVisible.map((n) => n.id), patch)
          notify(`${selectionVisible.length} équipement(s) mis à jour.`)
        }}
      />

      <div ref={cadreRef} onScroll={(event) => setDefilement(event.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-auto">
        <table className="w-max border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr>
              {INVENTORY_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  style={{ minWidth: column.width }}
                  className="border-b border-slate-200 bg-white px-2 py-2 text-left font-semibold text-slate-500"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/*
              Deux lignes creuses tiennent la hauteur de ce qui n'est pas monté : la barre de
              défilement reste juste, et le tableau se parcourt comme s'il était entier.
            */}
            {avant > 0 && <tr style={{ height: avant * hauteurLigne }} aria-hidden />}
            {visibles.map((node) => (
              <Row
                key={node.id}
                node={node}
                diagram={diagram}
                selected={selectedNodes.includes(node.id)}
                onSelect={(event) => choisirLigne(event, node.id)}
                onChange={(patch) => updateNode(node.id, patch)}
              />
            ))}
            {apres > 0 && <tr style={{ height: apres * hauteurLigne }} aria-hidden />}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-8 text-center text-[13px] text-slate-400">
            Aucun équipement ne correspond aux filtres.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Remplissage en lot.
 *
 * Trois quarts des valeurs d'un schéma sont la ressaisie d'une valeur déjà présente ailleurs :
 * « Siège » vingt-trois fois, « production » vingt-trois fois. Choisir une colonne, taper la
 * valeur une fois et l'appliquer à la sélection supprime cette répétition d'un geste.
 *
 * Seules les colonnes modifiables sont proposées — ni le type, ni la baie, qui se règlent
 * ailleurs et dont le remplissage en masse n'aurait pas de sens.
 */
function BarreRemplissage({
  selection,
  lignes,
  surTout,
  surAppliquer,
}: {
  selection: NetNode[]
  lignes: NetNode[]
  surTout: () => void
  surAppliquer: (patch: Partial<NetNode>) => void
}) {
  const modifiables = INVENTORY_COLUMNS.filter((c) => c.set && c.key !== 'name')
  const [colonne, setColonne] = useState(modifiables[0]?.key ?? '')
  const [valeur, setValeur] = useState('')
  const choisie = modifiables.find((c) => c.key === colonne)

  if (lignes.length === 0) return null
  if (selection.length < 2) {
    return (
      <p className="border-b border-slate-100 px-4 py-1.5 text-[11.5px] text-slate-400">
        Clic pour sélectionner une ligne, Ctrl+clic pour en ajouter, Maj+clic pour une plage —
        puis remplissez une colonne pour toute la sélection d’un coup.{' '}
        <button type="button" onClick={surTout} className="font-medium text-blue-700 hover:underline">
          Tout sélectionner ({lignes.length})
        </button>
      </p>
    )
  }

  const appliquer = () => {
    if (!choisie?.set) return
    surAppliquer(choisie.set(valeur.trim()))
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-blue-50/60 px-4 py-2">
      <span className="text-[12px] font-medium text-slate-700">
        {selection.length} lignes sélectionnées — remplir
      </span>
      <select
        value={colonne}
        onChange={(event) => setColonne(event.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] text-slate-700"
      >
        {modifiables.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <input
        value={valeur}
        onChange={(event) => setValeur(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') appliquer()
        }}
        placeholder="Valeur à appliquer"
        className="w-52 rounded-md border border-slate-300 px-2 py-1 text-[12px]"
      />
      <Btn variant="primary" onClick={appliquer}>
        Appliquer à la sélection
      </Btn>
      <button type="button" onClick={surTout} className="text-[11.5px] text-blue-700 hover:underline">
        Tout sélectionner ({lignes.length})
      </button>
    </div>
  )
}

/**
 * Cellule éditable : du texte au repos, un champ quand on y entre.
 *
 * L'inventaire posait un champ de saisie par cellule, en permanence. Sur un parc de 205
 * équipements cela faisait 3 491 champs contrôlés et 10 301 éléments dans la page : deux
 * secondes pour afficher l'onglet, une demi-seconde par modification. Or on ne modifie
 * qu'une cellule à la fois.
 *
 * Le champ n'existe donc que là où se trouve le curseur. Le reste est du texte.
 *
 * Deux précautions pour ne rien perdre au passage. Le texte au repos est atteignable au
 * clavier et passe en édition dès qu'il reçoit le focus : la tabulation parcourt toujours le
 * tableau de cellule en cellule, comme dans un tableur. Et la saisie n'est répercutée qu'à la
 * sortie du champ ou sur Entrée — Échap rend la valeur d'origine —, ce qui évite d'écrire
 * dans le document à chaque touche.
 */
function Cellule({
  valeur,
  onValider,
  aligne,
}: {
  valeur: string
  onValider: (valeur: string) => void
  aligne?: 'droite'
}) {
  const [edition, setEdition] = useState(false)
  const [brouillon, setBrouillon] = useState(valeur)

  const ouvrir = () => {
    setBrouillon(valeur)
    setEdition(true)
  }
  const fermer = (garder: boolean) => {
    setEdition(false)
    if (garder && brouillon !== valeur) onValider(brouillon)
  }

  if (!edition) {
    return (
      <span
        tabIndex={0}
        role="textbox"
        onClick={ouvrir}
        onFocus={ouvrir}
        className={`block w-full cursor-text rounded border border-transparent px-1 py-0.5 hover:border-slate-200 ${
          aligne === 'droite' ? 'text-right' : ''
        } ${valeur ? '' : 'text-slate-300'}`}
      >
        {valeur || '—'}
      </span>
    )
  }
  return (
    <input
      autoFocus
      value={brouillon}
      onChange={(event) => setBrouillon(event.target.value)}
      onBlur={() => fermer(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          fermer(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          fermer(false)
        }
      }}
      className={`w-full rounded border border-blue-500 bg-white px-1 py-0.5 outline-none ${
        aligne === 'droite' ? 'text-right' : ''
      }`}
    />
  )
}

/** Même principe pour les cellules à liste : l'énumération n'est montée qu'à l'ouverture. */
function CelluleChoix({
  valeur,
  libelle,
  couleur,
  options,
  onValider,
}: {
  valeur: string
  libelle: string
  couleur?: string
  options: { valeur: string; libelle: string }[]
  onValider: (valeur: string) => void
}) {
  const [edition, setEdition] = useState(false)
  if (!edition) {
    return (
      <span
        tabIndex={0}
        role="button"
        onClick={() => setEdition(true)}
        onFocus={() => setEdition(true)}
        className="block w-full cursor-pointer rounded border border-transparent px-1 py-0.5 hover:border-slate-200"
        style={{ color: couleur }}
      >
        {libelle || '—'}
      </span>
    )
  }
  return (
    <select
      autoFocus
      value={valeur}
      onChange={(event) => {
        onValider(event.target.value)
        setEdition(false)
      }}
      onBlur={() => setEdition(false)}
      className="w-full rounded border border-blue-500 bg-white px-1 py-0.5 text-[12px]"
    >
      <option value="">—</option>
      {options.map((item) => (
        <option key={item.valeur} value={item.valeur}>
          {item.libelle}
        </option>
      ))}
    </select>
  )
}

/**
 * Cellule « modèle » : le choix dans la base constructeurs n'est monté qu'à l'entrée.
 *
 * Le sélecteur ne cherche dans les 347 matériels qu'une fois ouvert, mais il posait tout de
 * même un champ par ligne. Au repos, le modèle n'est que du texte.
 */
function CelluleModele({ node, onChange }: { node: NetNode; onChange: (patch: Partial<NetNode>) => void }) {
  const [edition, setEdition] = useState(false)
  if (!edition) {
    return (
      <span
        tabIndex={0}
        role="button"
        onClick={() => setEdition(true)}
        onFocus={() => setEdition(true)}
        className={`block w-full cursor-text rounded border border-transparent px-1 py-0.5 hover:border-slate-200 ${
          node.model ? '' : 'text-slate-300'
        }`}
      >
        {node.model || '—'}
      </span>
    )
  }
  return (
    <div onBlur={(event) => {
      // On ne referme que lorsque le focus quitte vraiment le bloc : la liste de résultats
      // est un enfant, et la fermer au premier passage empêcherait d'y cliquer.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEdition(false)
    }}>
      <ModelPicker node={node} onPick={onChange} compact />
    </div>
  )
}

/*
  La ligne ne s'abonne plus au magasin.

  Chacune lisait le document entier par `useDiagram` : deux cent cinq abonnements pour une
  seule table, et autant de rendus à la moindre modification. Le document descend désormais en
  propriété, et les actions passent par `getState()`, qui ne crée pas d'abonnement.
*/
const Row = memo(function Row({
  node,
  diagram,
  selected,
  onSelect,
  onChange,
}: {
  node: NetNode
  diagram: Diagram
  selected: boolean
  onSelect: (event: React.MouseEvent) => void
  onChange: (patch: Partial<NetNode>) => void
}) {
  const meta = deviceMeta(node.kind)
  /*
    La sélection est posée sur « mousedown » et non sur « click ».

    Entrer dans une cellule remplace le texte par un champ : l'élément sous le pointeur
    disparaît avant la fin du clic, et l'événement « click » n'atteignait plus la ligne. Le
    « mousedown » part de l'élément d'origine et remonte avant tout rendu ; il porte les mêmes
    touches de modification, Maj et Ctrl comprises.
  */

  return (
    <tr
      onMouseDown={onSelect}
      className={`${selected ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'} `}
    >
      {INVENTORY_COLUMNS.map((column) => {
        const value = column.get(node, diagram)
        if (column.key === 'kind') {
          return (
            <td key={column.key} className="border-b border-slate-100 px-2 py-1">
              <button
                type="button"
                title="Voir dans le schéma"
                onClick={() => {
                  useDiagram.getState().focusNode(node.id)
                  useDiagram.getState().setAppView('diagram')
                }}
                className="flex items-center gap-1.5 text-slate-600 hover:text-blue-700"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0">
                  <DeviceIcon icon={meta.icon} color={meta.accent} />
                </svg>
                {value}
              </button>
            </td>
          )
        }
        if (column.key === 'model') {
          return (
            <td key={column.key} className="border-b border-slate-100 px-2 py-1">
              <CelluleModele node={node} onChange={onChange} />
            </td>
          )
        }
        if (column.key === 'status') {
          return (
            <td key={column.key} className="border-b border-slate-100 px-2 py-1">
              <CelluleChoix
                valeur={node.status ?? ''}
                libelle={node.status ? STATUS_LABELS[node.status] : ''}
                couleur={node.status ? STATUS_COLORS[node.status] : undefined}
                options={STATUS_OPTIONS.map((item) => ({ valeur: item, libelle: STATUS_LABELS[item] }))}
                onValider={(valeur) => onChange({ status: valeur ? (valeur as AssetStatus) : undefined })}
              />
            </td>
          )
        }
        return (
          <td key={column.key} className="border-b border-slate-100 px-2 py-1">
            {column.set ? (
              <Cellule
                valeur={value}
                onValider={(saisie) => onChange(column.set!(saisie))}
                aligne={['rackUnit', 'heightU', 'powerW'].includes(column.key) ? 'droite' : undefined}
              />
            ) : (
              <span className="text-slate-500">{value || '—'}</span>
            )}
          </td>
        )
      })}
    </tr>
  )
})
