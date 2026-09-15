import { useMemo, useState } from 'react'
import { Btn, Field, TextInput } from './ui'
import { deviceMeta } from '../lib/catalog'
import { detectFormat, FORMAT_LABELS, parseDiscovery, type DiscoveryResult } from '../lib/discovery'
import { DeviceIcon } from '../lib/icons'
import { useDiagram } from '../store/useDiagram'

const EXAMPLE = `SW-CORE-01#show lldp neighbors detail
------------------------------------------------
Local Intf: Te1/0/1
Chassis id: 000c.29ab.cd01
Port id: port2
System Name: FW-01
System Description: FortiGate-100F v7.4
Capabilities: B,R
Management Addresses:
    IP: 10.0.0.2
------------------------------------------------
Local Intf: Gi1/0/12
Chassis id: 000c.29ab.cd02
Port id: Gi0/1
System Name: SW-ACC-A1
System Description: cisco WS-C2960X-48FPD-L
Capabilities: B
Management Addresses:
    IP: 10.10.1.5
------------------------------------------------
Local Intf: Gi1/0/24
Chassis id: 000c.29ab.cd03
Port id: eth0
System Name: AP-ETAGE-2
System Description: Aruba AP-635 access point
Capabilities: W
Management Addresses:
    IP: 10.10.40.11`

/**
 * Découverte réseau.
 *
 * Un navigateur ne peut ni envoyer un ping, ni interroger en SNMP : la collecte se fait
 * hors de l'application (collecteur fourni dans `tools/collector/`, ou simple copier-coller
 * d'une sortie d'équipement). Ce module interprète ces relevés et en tire une cartographie.
 */
export function DiscoveryView() {
  const notify = useDiagram((s) => s.notify)
  const setAppView = useDiagram((s) => s.setAppView)
  const [text, setText] = useState('')
  const [localName, setLocalName] = useState('')
  const [result, setResult] = useState<DiscoveryResult | null>(null)

  const format = useMemo(() => (text.trim() ? detectFormat(text) : null), [text])

  const analyse = (value: string, name: string) => {
    const parsed = parseDiscovery(value, { localName: name })
    setResult(parsed)
  }

  const readFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const contents = await Promise.all([...files].map((file) => file.text()))
    const joined = contents.join('\n')
    setText(joined)
    analyse(joined, localName)
  }

  const merge = () => {
    if (!result) return
    const summary = useDiagram.getState().mergeDiscovery(result)
    notify(
      `${summary.created} équipement(s) créé(s), ${summary.updated} mis à jour, ${summary.links} liaison(s) ajoutée(s).`,
    )
    setAppView('diagram')
  }

  return (
    <div className="flex min-h-0 flex-1 bg-slate-50">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <header>
          <h1 className="text-[15px] font-semibold text-slate-800">Découverte réseau</h1>
          <p className="max-w-3xl pt-1 text-[12px] leading-relaxed text-slate-500">
            Collez un relevé d’équipement ou déposez les fichiers produits par le collecteur.
            L’application reconnaît le format, en déduit les équipements et, quand la source le
            permet, les liaisons — puis fusionne le tout dans le schéma sans écraser ce que vous
            avez saisi à la main.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Équipement interrogé (pour un relevé LLDP/CDP)">
              <TextInput value={localName} onChange={setLocalName} placeholder="SW-CORE-01" />
            </Field>
          </div>
          <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50">
            Déposer des fichiers…
            <input
              type="file"
              multiple
              accept=".txt,.xml,.log,.gnmap,.json,text/plain,application/xml"
              className="hidden"
              onChange={(event) => {
                void readFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
          <Btn onClick={() => setText(EXAMPLE)}>Insérer un exemple</Btn>
          {format && (
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                format === 'unknown' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {FORMAT_LABELS[format]}
            </span>
          )}
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          placeholder="Collez ici une sortie « show lldp neighbors detail », un export nmap (-oX ou -oG) ou une table ARP…"
          className="min-h-[220px] flex-1 resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          onDrop={(event) => {
            event.preventDefault()
            void readFiles(event.dataTransfer.files)
          }}
          onDragOver={(event) => event.preventDefault()}
        />

        <div className="flex items-center gap-2">
          <Btn variant="primary" onClick={() => analyse(text, localName)} disabled={!text.trim()}>
            Analyser
          </Btn>
          <Btn
            onClick={() => {
              setText('')
              setResult(null)
            }}
          >
            Effacer
          </Btn>
        </div>

        {result && (
          <section className="rounded-lg border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-slate-700">
                {result.label} — {result.nodes.length} équipement(s), {result.links.length} liaison(s)
              </h2>
              <div className="ml-auto">
                <Btn variant="primary" onClick={merge} disabled={result.nodes.length === 0}>
                  Fusionner dans le schéma
                </Btn>
              </div>
            </header>

            {result.warnings.length > 0 && (
              <ul className="border-b border-slate-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                {result.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            )}

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-slate-500">
                    <th className="px-3 py-1.5 font-semibold">Équipement</th>
                    <th className="px-3 py-1.5 font-semibold">Type déduit</th>
                    <th className="px-3 py-1.5 font-semibold">Adresse</th>
                    <th className="px-3 py-1.5 font-semibold">Relevé</th>
                  </tr>
                </thead>
                <tbody>
                  {result.nodes.map((node) => {
                    const meta = deviceMeta(node.kind)
                    return (
                      <tr key={node.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-700">{node.name}</td>
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <svg width="15" height="15" viewBox="0 0 24 24">
                              <DeviceIcon icon={meta.icon} color={meta.accent} />
                            </svg>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">{node.ip ?? '—'}</td>
                        <td className="px-3 py-1.5 text-slate-400">{node.model ?? node.notes ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 text-[12px] leading-relaxed text-slate-600">
        <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Comment collecter
        </h2>
        <p className="pb-2">
          Le navigateur ne peut pas sonder le réseau lui-même. Les relevés se prennent depuis un
          poste d’administration, puis se collent ici.
        </p>

        <h3 className="pt-2 text-[11px] font-semibold text-slate-500">Topologie (la plus fiable)</h3>
        <pre className="my-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px]">
{`show lldp neighbors detail
show cdp neighbors detail`}
        </pre>
        <p>Donne les voisins directs, les ports des deux côtés et l’adresse d’administration.</p>

        <h3 className="pt-3 text-[11px] font-semibold text-slate-500">Inventaire des hôtes</h3>
        <pre className="my-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px]">
{`nmap -sn 10.10.0.0/24 -oX sweep.xml
nmap -sV -F 10.10.0.0/24 -oG scan.gnmap`}
        </pre>
        <p>Le type est déduit des services ouverts et de la bannière système.</p>

        <h3 className="pt-3 text-[11px] font-semibold text-slate-500">Adresses vues</h3>
        <pre className="my-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px]">
{`show ip arp
arp -a`}
        </pre>
        <p>Associe adresses IP, adresses MAC et VLAN.</p>

        <h3 className="pt-3 text-[11px] font-semibold text-slate-500">Collecteur fourni</h3>
        <pre className="my-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px]">
{`node tools/collector/netschema-collect.mjs \\
  --subnet 10.10.0.0/24 \\
  --snmp-community public \\
  --out decouverte.json`}
        </pre>
        <p>
          Enchaîne le balayage et les relevés LLDP en SNMP, puis écrit un fichier de projet
          ouvrable directement depuis le schéma.
        </p>
      </aside>
    </div>
  )
}
