import { useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { deviceMeta } from '../lib/catalog'
import { DeviceIcon } from '../lib/icons'
import { cleNom, inventaireDuDocument, preparerReprise, texteDeRecherche } from '../lib/reprise'
import { emptyDiagram, parseClasseur } from '../lib/storage'
import { useDiagram } from '../store/useDiagram'
import { useSession } from '../store/useSession'
import type { Diagram } from '../types'
import { Btn } from './ui'

/** D'où vient l'inventaire proposé. */
type Source = { type: 'document' } | { type: 'serveur'; id: string; titre: string } | { type: 'fichier'; nom: string }

/**
 * Reprendre de l'inventaire.
 *
 * Un équipement saisi une fois ne devrait pas se ressaisir pour figurer sur un second
 * schéma. Ce dialogue liste ce qui est déjà enregistré — sur les pages du document ouvert,
 * dans un autre document du serveur, ou dans un fichier NetSchema — et le pose sur la page
 * voulue avec sa fiche, les liaisons déjà tracées entre les équipements choisis, leur baie
 * et les VLAN qu'ils citent.
 *
 * Le pied du dialogue dit ce qui va arriver avant qu'on valide : c'est le moyen de voir que
 * les liaisons suivent, sans avoir à le croire sur parole.
 */
export function RepriseDialog() {
  const ouvert = useDiagram((s) => s.repriseOuverte)
  // Monté à l'ouverture seulement : chaque ouverture repart d'un état neuf, sans rien avoir
  // à remettre à zéro.
  return ouvert ? <Dialogue /> : null
}

function Dialogue() {
  const choixInitial = useDiagram((s) => s.repriseChoix)
  const diagram = useDiagram((s) => s.diagram)
  const pagesDuDocument = useDiagram((s) => s.pages)
  const pageActive = useDiagram((s) => s.activePage)
  const mode = useSession((s) => s.mode)
  const projets = useSession((s) => s.projects)
  const projetOuvert = useSession((s) => s.currentId)

  const [source, setSource] = useState<Source>({ type: 'document' })
  const [pagesExternes, setPagesExternes] = useState<Diagram[] | null>(null)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')
  const [page, setPage] = useState('')
  const [site, setSite] = useState('')
  // Ce qu'on avait sélectionné dans l'inventaire arrive coché ; et sur une page vide, sans
  // sélection, c'est cette page qu'on remplit.
  const [coches, setCoches] = useState<Set<string>>(() => new Set(choixInitial.map(cleNom)))
  const [liaisons, setLiaisons] = useState(true)
  const [destination, setDestination] = useState<'nouvelle' | 'ici'>(() =>
    choixInitial.length === 0 && diagram.nodes.length === 0 && !diagram.locked ? 'ici' : 'nouvelle',
  )
  const [nomDePage, setNomDePage] = useState('')
  const [disposition, setDisposition] = useState<'origine' | 'auto'>('origine')
  const fichierRef = useRef<HTMLInputElement>(null)
  const enTete = useMemo(() => new Set(choixInitial.map(cleNom)), [choixInitial])

  const pages = useMemo<Diagram[]>(() => {
    if (source.type !== 'document') return pagesExternes ?? []
    return pagesDuDocument.map((item, index) => (index === pageActive ? diagram : item))
  }, [source, pagesExternes, pagesDuDocument, pageActive, diagram])

  const inventaire = useMemo(() => inventaireDuDocument(pages), [pages])
  const cible = destination === 'ici' ? diagram : null
  const surLaPage = useMemo(() => new Set((cible?.nodes ?? []).map((node) => cleNom(node.name))), [cible])

  const nomsDePages = useMemo(() => [...new Set(inventaire.flatMap((item) => item.pages))], [inventaire])
  const sites = useMemo(
    () => [...new Set(inventaire.map((item) => item.node.site?.trim()).filter(Boolean) as string[])].sort(),
    [inventaire],
  )

  const lignes = useMemo(() => {
    const cherche = recherche
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
    const filtrees = inventaire.filter((item) => {
      if (page && !item.pages.includes(page)) return false
      if (site && item.node.site !== site) return false
      if (!cherche) return true
      const meta = deviceMeta(item.node.kind)
      return texteDeRecherche(item, meta.label, [meta.family, ...(meta.aliases ?? [])]).includes(cherche)
    })
    // Ce qu'on avait sélectionné dans l'inventaire vient en tête : on le voit sans chercher.
    // L'ordre ne suit pas les cases cochées ensuite — une ligne ne doit pas fuir sous le clic.
    return [...filtrees.filter((item) => enTete.has(item.cle)), ...filtrees.filter((item) => !enTete.has(item.cle))]
  }, [inventaire, recherche, page, site, enTete])

  const cochables = lignes.filter((item) => !surLaPage.has(item.cle))
  const choisis = useMemo(
    () => inventaire.filter((item) => coches.has(item.cle) && !surLaPage.has(item.cle)),
    [inventaire, coches, surLaPage],
  )

  // Ce qui arrivera si l'on valide — calculé sans rien toucher.
  const apercu = useMemo(
    () =>
      choisis.length === 0
        ? null
        : preparerReprise(pages, choisis.map((item) => item.cle), cible ?? emptyDiagram(), { liaisons }),
    [pages, choisis, cible, liaisons],
  )

  const fermer = () => useDiagram.getState().fermerReprise()

  const basculer = (cle: string) =>
    setCoches((avant) => {
      const apres = new Set(avant)
      if (apres.has(cle)) apres.delete(cle)
      else apres.add(cle)
      return apres
    })

  const changerDeSource = (suivante: Source, chargees: Diagram[] | null) => {
    setSource(suivante)
    setPagesExternes(chargees)
    setCoches(new Set())
    setPage('')
    setSite('')
    setRecherche('')
  }

  const ouvrirDocumentServeur = async (id: string) => {
    const projet = projets.find((item) => item.id === id)
    if (!projet) return
    setChargement(true)
    setErreur(null)
    try {
      const charge = await api.fetchDiagram(id)
      changerDeSource({ type: 'serveur', id, titre: projet.title }, parseClasseur(charge.diagram).pages)
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : 'Document illisible.')
    } finally {
      setChargement(false)
    }
  }

  const ouvrirFichier = async (fichier: File | undefined) => {
    if (!fichier) return
    setErreur(null)
    try {
      const classeur = parseClasseur(JSON.parse(await fichier.text()))
      if (classeur.pages.every((item) => item.nodes.length === 0)) {
        setErreur(`« ${fichier.name} » ne contient aucun équipement.`)
        return
      }
      changerDeSource({ type: 'fichier', nom: fichier.name }, classeur.pages)
    } catch {
      setErreur(`« ${fichier.name} » n’est pas un document NetSchema lisible.`)
    }
  }

  const valider = () => {
    if (choisis.length === 0) return
    const store = useDiagram.getState()
    const fait = store.reprendreEquipements(
      pages,
      choisis.map((item) => item.node.name),
      { liaisons, disposition, nouvellePage: destination === 'nouvelle' ? nomDePage.trim() : undefined },
    )
    const ou = destination === 'nouvelle' ? `la page « ${useDiagram.getState().diagram.pageName} »` : 'cette page'
    store.notify(
      fait.equipements === 0
        ? 'Rien n’a été repris : ces équipements sont déjà sur la page.'
        : `${fait.equipements} équipement(s) repris de l’inventaire sur ${ou}${fait.liaisons > 0 ? `, avec ${fait.liaisons} liaison(s)` : ''}.`,
    )
    fermer()
  }

  const valeurSource = source.type === 'document' ? 'document' : source.type === 'serveur' ? `serveur:${source.id}` : 'fichier'
  const autresProjets = projets.filter((item) => item.id !== projetOuvert)
  const verrouille = diagram.locked === true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6" onPointerDown={fermer}>
      <div
        role="dialog"
        aria-label="Reprendre de l’inventaire"
        className="flex max-h-[88vh] w-[920px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-slate-800">Reprendre de l’inventaire</h2>
          <p className="text-[12px] leading-relaxed text-slate-500">
            Les équipements déjà enregistrés arrivent avec leur fiche — modèle, numéro de série, adresse —,
            les liaisons tracées entre eux, leur baie et leurs VLAN. Rien n’est à ressaisir.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5">
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            Inventaire de
            <select
              value={valeurSource}
              onChange={(event) => {
                const valeur = event.target.value
                if (valeur === 'document') changerDeSource({ type: 'document' }, null)
                else if (valeur === 'ouvrir-fichier') fichierRef.current?.click()
                else if (valeur.startsWith('serveur:')) void ouvrirDocumentServeur(valeur.slice(8))
              }}
              className="max-w-[260px] rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] text-slate-800"
            >
              <option value="document">ce document ({pagesDuDocument.length} page{pagesDuDocument.length > 1 ? 's' : ''})</option>
              {mode === 'server' && autresProjets.length > 0 && (
                <optgroup label="Autres documents du serveur">
                  {autresProjets.map((projet) => (
                    <option key={projet.id} value={`serveur:${projet.id}`}>
                      {projet.title} ({projet.nodes} équip.)
                    </option>
                  ))}
                </optgroup>
              )}
              {source.type === 'fichier' && <option value="fichier">fichier : {source.nom}</option>}
              <option value="ouvrir-fichier">un fichier NetSchema (.json)…</option>
            </select>
          </label>
          <input
            ref={fichierRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              void ouvrirFichier(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <input
            value={recherche}
            onChange={(event) => setRecherche(event.target.value)}
            placeholder="Nom, type, adresse, modèle, n° de série…"
            aria-label="Rechercher dans l’inventaire"
            className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {nomsDePages.length > 1 && (
            <select value={page} onChange={(event) => setPage(event.target.value)} aria-label="Page" className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
              <option value="">Toutes les pages</option>
              {nomsDePages.map((nom) => (
                <option key={nom} value={nom}>
                  {nom}
                </option>
              ))}
            </select>
          )}
          {sites.length > 0 && (
            <select value={site} onChange={(event) => setSite(event.target.value)} aria-label="Site" className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
              <option value="">Tous les sites</option>
              {sites.map((nom) => (
                <option key={nom} value={nom}>
                  {nom}
                </option>
              ))}
            </select>
          )}
        </div>

        {erreur && <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-[12px] text-amber-800">{erreur}</p>}

        <div className="flex items-center gap-2 px-5 pt-2.5 text-[12px] text-slate-500">
          <span>
            {chargement ? 'Chargement…' : `${lignes.length} équipement(s) sur ${inventaire.length}`}
            {coches.size > 0 ? ` · ${choisis.length} coché(s)` : ''}
          </span>
          <span className="ml-auto flex gap-1.5">
            <Btn
              onClick={() => setCoches((avant) => new Set([...avant, ...cochables.map((item) => item.cle)]))}
              disabled={cochables.length === 0}
            >
              Cocher les {cochables.length} affichés
            </Btn>
            <Btn onClick={() => setCoches(new Set())} disabled={coches.size === 0}>
              Tout décocher
            </Btn>
          </span>
        </div>

        <div className="mx-5 my-2.5 min-h-[160px] flex-1 overflow-y-auto rounded-lg border border-slate-200">
          {inventaire.length === 0 && !chargement ? (
            <p className="p-6 text-center text-[13px] leading-relaxed text-slate-500">
              {source.type === 'document'
                ? 'Ce document ne contient encore aucun équipement. Choisissez un autre document ou un fichier NetSchema ci-dessus.'
                : 'Aucun équipement dans cette source.'}
            </p>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-[12px]">
              <thead className="sticky top-0 z-10 bg-white text-left text-slate-500">
                <tr>
                  {['', 'Nom', 'Type', 'Site / zone', 'Adresse IP', 'Modèle', 'Page'].map((titre) => (
                    <th key={titre} className="border-b border-slate-200 px-2 py-1.5 font-semibold">
                      {titre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((item) => {
                  const meta = deviceMeta(item.node.kind)
                  const dejaLa = surLaPage.has(item.cle)
                  const coche = coches.has(item.cle) && !dejaLa
                  return (
                    <tr
                      key={item.cle}
                      onClick={() => !dejaLa && basculer(item.cle)}
                      className={`${dejaLa ? 'text-slate-500' : 'cursor-pointer text-slate-700 hover:bg-blue-50'} ${coche ? 'bg-blue-50' : ''}`}
                    >
                      <td className="w-8 border-b border-slate-100 px-2 py-1">
                        <input
                          type="checkbox"
                          checked={coche}
                          disabled={dejaLa}
                          onChange={() => basculer(item.cle)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Reprendre ${item.node.name}`}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1 font-medium">
                        <span className="flex items-center gap-1.5">
                          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="shrink-0">
                            <DeviceIcon icon={meta.icon} color={meta.accent} />
                          </svg>
                          {item.node.name}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1">{meta.label}</td>
                      <td className="border-b border-slate-100 px-2 py-1">
                        {[item.node.site, item.node.zone].filter(Boolean).join(' · ')}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1 tabular-nums">{item.node.ip}</td>
                      <td className="border-b border-slate-100 px-2 py-1">
                        {[item.node.vendor, item.node.model].filter(Boolean).join(' ')}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1">
                        {dejaLa ? 'déjà sur cette page' : item.pages.join(', ')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {inventaire.length > 0 && lignes.length === 0 && (
            <p className="p-6 text-center text-[13px] text-slate-500">Aucun équipement ne correspond à la recherche.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-5 py-2.5 text-[12px] text-slate-600">
          <span className="font-medium text-slate-700">Poser sur</span>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={destination === 'nouvelle'} onChange={() => setDestination('nouvelle')} className="accent-blue-600" />
            une nouvelle page
          </label>
          <input
            value={nomDePage}
            onChange={(event) => setNomDePage(event.target.value)}
            onFocus={() => setDestination('nouvelle')}
            placeholder="Nom de la page (facultatif)"
            aria-label="Nom de la nouvelle page"
            className="w-48 rounded-lg border border-slate-200 px-2 py-1 text-[12.5px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <label className={`flex items-center gap-1.5 ${verrouille ? 'text-slate-500' : ''}`} title={verrouille ? 'Cette page est verrouillée.' : undefined}>
            <input
              type="radio"
              checked={destination === 'ici'}
              disabled={verrouille}
              onChange={() => setDestination('ici')}
              className="accent-blue-600"
            />
            la page ouverte « {diagram.pageName ?? 'Schéma'} »
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={liaisons} onChange={(event) => setLiaisons(event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600" />
            avec leurs liaisons déjà tracées
          </label>
          {apercu?.dispositionOrigine && (destination === 'nouvelle' || diagram.nodes.length === 0) && (
            <label className="flex items-center gap-1.5">
              Disposition
              <select
                value={disposition}
                onChange={(event) => setDisposition(event.target.value as 'origine' | 'auto')}
                className="rounded-lg border border-slate-200 px-1.5 py-1 text-[12.5px]"
              >
                <option value="origine">comme sur la page d’origine</option>
                <option value="auto">placement automatique</option>
              </select>
            </label>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-slate-600" aria-live="polite">
            {apercu ? (
              <>
                <b>{apercu.nodes.length} équipement(s)</b>
                {liaisons ? `, ${apercu.links.length} liaison(s) déjà tracée(s)` : ''}
                {apercu.racks.length > 0 ? `, ${apercu.racks.length} baie(s)` : ''}
                {apercu.vlans.length > 0 ? `, ${apercu.vlans.length} VLAN du plan d’adressage` : ''}.
              </>
            ) : (
              'Cochez les équipements à reprendre.'
            )}
          </p>
          <Btn onClick={fermer}>Annuler</Btn>
          <Btn variant="primary" onClick={valider} disabled={choisis.length === 0}>
            Reprendre{choisis.length > 0 ? ` ${choisis.length} équipement(s)` : ''}
          </Btn>
        </footer>
      </div>
    </div>
  )
}
