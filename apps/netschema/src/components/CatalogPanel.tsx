import { useMemo, useRef, useState } from 'react'
import { Btn, Field, Select, TextInput } from './ui'
import { allDevices, LAYER_LABELS, registeredPacks } from '../lib/catalog'
import {
  bootstrapCatalog,
  catalogReport,
  customDevices,
  deleteUserPack,
  getCatalogSource,
  parsePack,
  saveUserPack,
  setCatalogSource,
  upsertCustomDevice,
  userPackIds,
} from '../lib/catalogSource'
import { downloadBlob } from '../lib/exportImage'
import { DeviceIcon, iconIds } from '../lib/icons'
import { useDiagram } from '../store/useDiagram'

const LAYER_OPTIONS = Object.entries(LAYER_LABELS).map(([rank, label]) => ({
  value: rank,
  label: `${rank} — ${label}`,
}))

/**
 * Catalogue : ce que l'application connaît comme équipements, et comment le mettre à jour.
 *
 * Trois voies, de la plus simple à la plus outillée :
 *   — déposer un fichier de lot à côté de l'application (`catalog/`), rechargé au démarrage ;
 *   — pointer une source distante (serveur interne) et vérifier les mises à jour ;
 *   — créer un type maison directement ici, ou importer un lot reçu d'un collègue.
 */
export function CatalogPanel() {
  const revision = useDiagram((s) => s.catalogRevision)
  const bump = useDiagram((s) => s.bumpCatalog)
  const notify = useDiagram((s) => s.notify)
  const fileRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState(getCatalogSource())
  const [checking, setChecking] = useState(false)

  const [draft, setDraft] = useState({ label: '', family: 'Types maison', rank: '6', icon: 'generic', aliases: '' })

  const { packs, devices, locals, report } = useMemo(() => {
    void revision
    return {
      packs: registeredPacks(),
      devices: allDevices(),
      locals: new Set(userPackIds()),
      report: catalogReport(),
    }
  }, [revision])

  const icons = useMemo(() => iconIds(), [])

  const importPack = async (file: File | undefined) => {
    if (!file) return
    try {
      const pack = parsePack(JSON.parse(await file.text()))
      saveUserPack(pack)
      bump()
      notify(`Lot « ${pack.title} » installé (${pack.devices.length} types).`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Lot illisible.')
    }
  }

  const checkUpdates = async () => {
    setChecking(true)
    setCatalogSource(source)
    try {
      const result = await bootstrapCatalog()
      bump()
      notify(
        result.errors.length > 0
          ? result.errors.join(' ')
          : `Catalogue à jour : ${result.packs.length} lots, ${allDevices().length} types.`,
      )
    } finally {
      setChecking(false)
    }
  }

  const createDevice = () => {
    const label = draft.label.trim()
    if (!label) return
    const id = `perso-${label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}`
    upsertCustomDevice({
      id,
      label,
      rank: Number(draft.rank),
      icon: draft.icon,
      family: draft.family.trim() || 'Types maison',
      aliases: draft.aliases
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean),
    })
    bump()
    notify(`Type « ${label} » ajouté au catalogue.`)
    setDraft({ ...draft, label: '', aliases: '' })
  }

  const exportCustom = () => {
    const devicesList = customDevices()
    if (devicesList.length === 0) {
      notify('Aucun type maison à exporter.')
      return
    }
    const pack = {
      id: 'perso',
      title: 'Types maison',
      version: new Date().toISOString().slice(0, 10),
      description: 'Types d’équipement créés dans NetSchema.',
      devices: devicesList,
    }
    downloadBlob(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }), 'netschema-types-maison.json')
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Catalogue</h2>
        <p className="pt-1 text-[12px] text-slate-600">
          Version {report?.version ?? '—'} · {devices.length} types · {packs.length} lots
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {packs.map((pack) => (
            <li key={pack.id} className="rounded-lg border border-slate-200 px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-slate-700">{pack.title}</span>
                <span className="shrink-0 text-[10px] text-slate-400">v{pack.version}</span>
              </div>
              <p className="text-[11px] text-slate-500">{pack.devices.length} types</p>
              {locals.has(pack.id) && (
                <button
                  type="button"
                  onClick={() => {
                    deleteUserPack(pack.id)
                    bump()
                  }}
                  className="mt-1 text-[11px] text-red-600 hover:underline"
                >
                  Retirer ce lot
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mise à jour</h2>
        <div className="flex flex-col gap-2">
          <Field label="Source distante (dossier contenant index.json)">
            <TextInput value={source} onChange={setSource} placeholder="https://intranet/netschema/catalog" />
          </Field>
          <Btn onClick={() => void checkUpdates()} disabled={checking}>
            {checking ? 'Vérification…' : 'Vérifier les mises à jour'}
          </Btn>
          <Btn onClick={() => fileRef.current?.click()}>Importer un lot (.json)</Btn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              void importPack(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <p className="text-[11px] leading-snug text-slate-400">
            Les lots déposés dans le dossier <code>catalog/</code> livré avec l’application sont
            chargés au démarrage : mettre à jour le catalogue ne demande aucune recompilation.
          </p>
        </div>
      </section>

      <section>
        <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Créer un type</h2>
        <div className="flex flex-col gap-2">
          <Field label="Nom">
            <TextInput value={draft.label} onChange={(label) => setDraft({ ...draft, label })} placeholder="Passerelle métier" />
          </Field>
          <Field label="Famille (groupe dans la palette)">
            <TextInput value={draft.family} onChange={(family) => setDraft({ ...draft, family })} />
          </Field>
          <Field label="Couche par défaut">
            <Select value={draft.rank} onChange={(rank) => setDraft({ ...draft, rank })} options={LAYER_OPTIONS} />
          </Field>
          <Field label="Synonymes de recherche (séparés par des virgules)">
            <TextInput value={draft.aliases} onChange={(aliases) => setDraft({ ...draft, aliases })} placeholder="edi, passerelle, b2b" />
          </Field>
          <div>
            <p className="pb-1 text-[11px] font-medium text-slate-500">Pictogramme</p>
            <div className="grid max-h-36 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
              {icons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  title={icon}
                  onClick={() => setDraft({ ...draft, icon })}
                  className={`flex h-7 w-7 items-center justify-center rounded ${
                    draft.icon === icon ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-slate-100'
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <DeviceIcon icon={icon} color="#334155" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          <Btn variant="primary" onClick={createDevice} disabled={!draft.label.trim()}>
            Ajouter au catalogue
          </Btn>
          <Btn onClick={exportCustom}>Exporter mes types (.json)</Btn>
        </div>
      </section>
    </div>
  )
}
