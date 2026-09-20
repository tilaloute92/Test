import { useMemo } from 'react'
import { Btn, Checkbox, Field, Select, TextInput } from './ui'
import { dupliquer, type Disposition } from '../lib/duplication'
import { useDiagram } from '../store/useDiagram'

/**
 * Duplication en série.
 *
 * Le dialogue montre le résultat avant de l'écrire : les noms que porteront les copies, ce
 * qui sera recâblé, et les réserves — une adresse IP recopiée à l'identique ou un numéro de
 * série en double sont des erreurs qu'on ne voit qu'une fois le schéma livré.
 */
export function DuplicateDialog() {
  const open = useDiagram((s) => s.duplicateOpen)
  const options = useDiagram((s) => s.duplicateOptions)
  const diagram = useDiagram((s) => s.diagram)
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const selectedAnnotations = useDiagram((s) => s.selectedAnnotations)
  const setOptions = useDiagram((s) => s.setDuplicateOptions)

  const apercu = useMemo(
    () => (open ? dupliquer(diagram, selectedNodes, selectedAnnotations, options) : null),
    [open, diagram, selectedNodes, selectedAnnotations, options],
  )

  if (!open) return null

  const fermer = () => useDiagram.getState().setDuplicateOpen(false)
  const appliquer = () => {
    const { equipements, liaisons } = useDiagram.getState().duplicateSeries(options)
    useDiagram
      .getState()
      .notify(
        equipements > 0
          ? `${equipements} équipement(s) et ${liaisons} liaison(s) ajoutés. « Placement auto » range l’ensemble.`
          : 'Rien à dupliquer.',
      )
    fermer()
  }

  const sources = diagram.nodes.filter((node) => selectedNodes.includes(node.id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6"
      onPointerDown={fermer}
    >
      <div
        className="flex max-h-[85vh] w-[820px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-slate-800">Dupliquer en série</h2>
          <p className="text-[12px] leading-relaxed text-slate-500">
            {sources.length} équipement(s) et {selectedAnnotations.length} annotation(s)
            sélectionnés. Les copies sont renommées, réadressées et recâblées comme
            l’original — de quoi déployer douze agences identiques sans les redessiner.
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-5 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre de copies">
                <TextInput
                  value={String(options.copies)}
                  onChange={(value) => setOptions({ copies: Math.max(1, Math.min(50, Number(value) || 1)) })}
                />
              </Field>
              <Field label="Numéro de la première copie">
                <TextInput
                  value={String(options.debut)}
                  onChange={(value) => setOptions({ debut: Math.max(1, Number(value) || 1) })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Disposition">
                <Select
                  value={options.disposition}
                  onChange={(value) => setOptions({ disposition: value as Disposition })}
                  options={[
                    { value: 'droite', label: 'Côte à côte' },
                    { value: 'bas', label: 'L’une sous l’autre' },
                    { value: 'grille', label: 'En grille' },
                  ]}
                />
              </Field>
              <Field label="Écart entre copies (px)">
                <TextInput
                  value={String(options.ecart)}
                  onChange={(value) => setOptions({ ecart: Math.max(0, Number(value) || 0) })}
                />
              </Field>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <p className="pb-2 text-[11px] font-semibold text-slate-600">
                Renommer — <code>#</code> vaut le numéro de la copie, <code>@</code> sa lettre
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Remplacer dans le nom">
                  <TextInput
                    value={options.remplacer}
                    onChange={(value) => setOptions({ remplacer: value })}
                    placeholder="BAT-A"
                  />
                </Field>
                <Field label="Par">
                  <TextInput
                    value={options.par}
                    onChange={(value) => setOptions({ par: value })}
                    placeholder="BAT-@"
                  />
                </Field>
                <Field label="Préfixe">
                  <TextInput
                    value={options.prefixe}
                    onChange={(value) => setOptions({ prefixe: value })}
                    placeholder="(aucun)"
                  />
                </Field>
                <Field label="Suffixe">
                  <TextInput
                    value={options.suffixe}
                    onChange={(value) => setOptions({ suffixe: value })}
                    placeholder="-#"
                  />
                </Field>
              </div>
              <p className="pt-2 text-[11px] leading-snug text-slate-400">
                Sans règle, le numéro terminal est incrémenté : SW-ACC-01 devient SW-ACC-02.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Site des copies">
                <TextInput
                  value={options.site}
                  onChange={(value) => setOptions({ site: value })}
                  placeholder="(inchangé) — Agence #"
                />
              </Field>
              <Field label="Zone des copies">
                <TextInput
                  value={options.zone}
                  onChange={(value) => setOptions({ zone: value })}
                  placeholder="(inchangée)"
                />
              </Field>
            </div>
            <Field label="Grappe HA des copies">
              <TextInput
                value={options.cluster}
                onChange={(value) => setOptions({ cluster: value })}
                placeholder="(déduite du nom d’origine)"
              />
            </Field>
            <Field label="Pas d’incrémentation du réseau (3ᵉ octet et VLAN)">
              <TextInput
                value={String(options.pasReseau)}
                onChange={(value) => setOptions({ pasReseau: Math.max(0, Number(value) || 0) })}
              />
            </Field>
            <Checkbox
              checked={options.raccorder}
              onChange={(checked) => setOptions({ raccorder: checked })}
              label="Recâbler les copies sur les mêmes voisins que l’original"
            />
            <Checkbox
              checked={options.viderIdentifiants}
              onChange={(checked) => setOptions({ viderIdentifiants: checked })}
              label="Vider aussi les adresses IP et virtuelles des copies"
            />

            {apercu && (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200">
                <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                  Aperçu des noms
                </p>
                <ul className="divide-y divide-slate-100">
                  {apercu.noms.slice(0, 12).map((ligne) => (
                    <li key={ligne.source} className="px-3 py-1.5 text-[12px] text-slate-600">
                      <b className="text-slate-800">{ligne.source}</b> → {ligne.copies.join(', ')}
                    </li>
                  ))}
                </ul>
                {apercu.noms.length > 12 && (
                  <p className="px-3 py-1.5 text-[11.5px] text-slate-400">
                    … et {apercu.noms.length - 12} autre(s).
                  </p>
                )}
                {apercu.reserves.map((reserve) => (
                  <p
                    key={reserve}
                    className="border-t border-slate-100 bg-amber-50 px-3 py-2 text-[11.5px] leading-snug text-amber-900"
                  >
                    {reserve}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <p className="text-[11.5px] text-slate-400">
            Une duplication s’annule d’un seul{' '}
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1">Ctrl+Z</kbd>.
          </p>
          <div className="flex gap-2">
            <Btn onClick={fermer}>Annuler</Btn>
            <Btn variant="primary" onClick={appliquer} disabled={!apercu || apercu.nodes.length === 0}>
              {apercu
                ? `Dupliquer (${apercu.nodes.length} équipement(s), ${apercu.links.length} liaison(s))`
                : 'Dupliquer'}
            </Btn>
          </div>
        </footer>
      </div>
    </div>
  )
}
