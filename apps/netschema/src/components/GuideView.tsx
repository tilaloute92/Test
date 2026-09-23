import { useState, type ReactNode } from 'react'
import { Btn } from './ui'
import { VOICE_EXAMPLE_GROUPS } from '../lib/voice'
import { useDiagram } from '../store/useDiagram'
import type { AppView } from '../types'

/**
 * Guide d'utilisation intégré.
 *
 * Le manuel vit dans l'application plutôt que dans un fichier à côté : il connaît l'état
 * réel du schéma, ses exemples vocaux s'exécutent d'un clic, et ses renvois ouvrent
 * directement le module concerné. Le contenu est déclaratif (`SECTIONS`) pour rester
 * filtrable par la recherche.
 */

interface Section {
  id: string
  title: string
  /** Mots supplémentaires pris en compte par la recherche. */
  keywords?: string
  body: ReactNode
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
        {n}
      </span>
      <span className="text-[13px] leading-relaxed text-slate-700">{children}</span>
    </li>
  )
}

function Keys({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-700">
      {children}
    </kbd>
  )
}

function Shortcuts({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <tbody>
        {rows.map(([keys, what]) => (
          <tr key={keys} className="border-b border-slate-100 last:border-0">
            <td className="w-44 py-1.5 pr-3 align-top">
              {keys.split(' + ').map((key, index) => (
                <span key={key}>
                  {index > 0 && <span className="px-1 text-slate-400">+</span>}
                  <Keys>{key}</Keys>
                </span>
              ))}
            </td>
            <td className="py-1.5 text-slate-700">{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      {children}
    </p>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-slate-700">{children}</p>
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-slate-700">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

export function GuideView() {
  const setAppView = useDiagram((s) => s.setAppView)
  const setVoiceOpen = useDiagram((s) => s.setVoiceOpen)
  const setPanel = useDiagram((s) => s.setPanel)
  const setImportOpen = useDiagram((s) => s.setImportOpen)
  const setCommandOpen = useDiagram((s) => s.setCommandOpen)
  const setAssistantOpen = useDiagram((s) => s.setAssistantOpen)
  const setDuplicateOpen = useDiagram((s) => s.setDuplicateOpen)
  const setVueLogique = useDiagram((s) => s.setVueLogique)
  const loadSample = useDiagram((s) => s.loadSample)
  const run = useDiagram((s) => s.runVoiceCommand)
  const notify = useDiagram((s) => s.notify)

  const [query, setQuery] = useState('')
  /** Dernière commande d'exemple lancée depuis le guide, avec la réponse obtenue. */
  const [tried, setTried] = useState<{ command: string; message: string; ok: boolean } | null>(null)

  const openIn = (view: AppView, after?: () => void) => {
    setAppView(view)
    after?.()
  }

  const tryCommand = (command: string) => {
    const result = run(command)
    setTried({ command, ...result })
    notify(result.message)
  }

  const sections: Section[] = [
    {
      id: 'demarrer',
      title: 'Prise en main',
      keywords: 'debuter commencer premier schema exemple demarrage installation prise en main',
      body: (
        <>
          <P>
            NetSchema produit des schémas d'infrastructure à partir d'une description des
            équipements : vous posez les briques, l'application place, relie, contrôle et
            exporte. Tout est enregistré dans le navigateur — aucun serveur, aucun compte.
          </P>
          <ol className="flex flex-col gap-2">
            <Step n={1}>
              Posez les équipements : glissez-les depuis la palette de gauche, ou décrivez-les à
              la voix (« ajoute un switch cœur SW-CORE-01 »).
            </Step>
            <Step n={2}>
              Reliez-les : touche <Keys>L</Keys> puis un clic sur chaque extrémité. Le type de
              liaison est déduit des deux équipements et reste modifiable.
            </Step>
            <Step n={3}>
              Rangez : <b>Disposer</b> range le schéma en couches (cœur en haut, postes en bas)
              et respecte les sites, zones et grappes.
            </Step>
            <Step n={4}>
              Contrôlez et exportez : l'onglet <b>Haute dispo</b> note la robustesse, les boutons
              d'export produisent un PNG, un SVG ou un JSON.
            </Step>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => openIn('diagram', loadSample)}>
              Charger le schéma d'exemple
            </Btn>
            <Btn onClick={() => openIn('diagram')}>Aller au schéma</Btn>
          </div>
          <Note>
            Le travail en cours est conservé dans le stockage local du navigateur. Pour le
            transporter d'un poste à l'autre, exportez le JSON : c'est le format qui contient
            tout (positions, liaisons, VLAN, baies, inventaire).
          </Note>
        </>
      ),
    },
    {
      id: 'assistant',
      title: 'Assistant de conception',
      keywords:
        'assistant ia intelligence artificielle aide conception decrire description generer construire ameliorer suggestions propositions corrections automatique',
      body: (
        <>
          <P>
            Le bouton <b>✦ Assistant</b> (<Keys>Ctrl</Keys> + <Keys>J</Keys>) ouvre une aide à la
            conception qui fait deux choses : construire un schéma à partir d'une description en
            français, et proposer les corrections qu'elle sait appliquer sur le schéma ouvert.
          </P>
          <Note>
            <b>Rien ne sort du poste.</b> L'assistant n'interroge aucun service distant : il
            raisonne sur le catalogue d'équipements, les règles de liaison et la base des
            mécanismes de haute disponibilité embarqués dans l'application. C'est aussi pourquoi
            il fonctionne sans connexion et reste utilisable sur un réseau fermé.
          </Note>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Onglet « Construire »</p>
          <P>
            Décrivez l'architecture, <b>un groupe d'équipements par ligne</b> (ou séparés par des
            virgules). L'assistant reconnaît la quantité, le type, le constructeur, la zone, le
            site, la grappe et les rôles :
          </P>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100">{`deux liens opérateur
deux routeurs de périmètre en grappe
deux pare-feu Fortinet en grappe actif/passif, zone DMZ
deux switches cœur en grappe, zone Datacenter
quatre switches d'accès
trois hyperviseurs en grappe avec témoin
une baie de stockage
deux onduleurs`}</pre>
          <List
            items={[
              <>
                <b>Il annonce avant d'agir.</b> « Analyser la demande » affiche le plan étape par
                étape — et, en ambre, les fragments qu'il n'a pas compris et qu'il ignorera
                donc. Rien n'est modifié tant que vous n'avez pas cliqué sur « Appliquer ».
              </>,
              <>
                <b>Il câble les couches entre elles</b> : chaque groupe est raccordé au groupe
                amont le plus proche (les accès aux switches cœur, les hyperviseurs au cœur, les
                onduleurs aux équipements critiques), avec le type de liaison qui convient.
              </>,
              <>
                <b>Il monte les grappes</b> : lien de synchronisation, rôles actif/passif ou
                actif/actif, mécanisme de bascule déduit du type et du constructeur (FGCP pour
                du Fortinet, HA active/passive pour du Palo Alto, VRRP pour un routeur…).
              </>,
              <>
                <b>Rangez ensuite</b> avec <b>Placement auto</b> : l'assistant crée la structure,
                la mise en page reste le travail du moteur de placement.
              </>,
            ]}
          />

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Onglet « Améliorer »</p>
          <P>
            Ici l'assistant lit le schéma ouvert et ne propose que ce qu'il sait corriger tout
            seul, sans arbitrage de votre part : membre de grappe sans lien de synchronisation,
            grappe à deux nœuds sans témoin de quorum, équipement raccordé à un seul amont,
            liens parallèles à déclarer en agrégat, double alimentation non renseignée alors que
            deux chaînes ondulées existent, données représentées sans chaîne de sauvegarde.
          </P>
          <List
            items={[
              <>
                Chaque proposition s'applique <b>séparément</b>, et s'annule d'un
                <Keys>Ctrl</Keys> + <Keys>Z</Keys>.
              </>,
              <>
                La liste se <b>fige</b> dès la première correction, pour que les cartes ne
                sautent pas sous le curseur ; « Réanalyser le schéma » la rafraîchit.
              </>,
              <>
                Ce qui demande une décision (dimensionnement, adressage, choix d'un mécanisme de
                bascule) n'apparaît pas ici : c'est le rôle du panneau <b>Haute dispo</b> et du
                module <b>Dossier</b>.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => openIn('diagram', () => setAssistantOpen(true))}>
              Ouvrir l'assistant
            </Btn>
            <Btn onClick={() => tryCommand("ouvre l'assistant de conception")}>
              Essayer la commande vocale
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'dupliquer',
      title: 'Dupliquer : un bloc, une page, un site entier',
      keywords:
        'dupliquer duplication copier coller couper presse-papiers clone replique repeter serie agence site batiment salle baie identique modele gabarit alt glisser',
      body: (
        <>
          <P>
            Une infrastructure se répète : douze agences câblées pareil, quatre salles
            jumelles, deux baies identiques. Rien de tout cela ne mérite d'être redessiné —
            et le redessiner, c'est douze occasions de se tromper, puis une modification
            reportée sur onze.
          </P>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Quatre gestes</p>
          <List
            items={[
              <>
                <b>Dupliquer sur place</b> — bouton <b>Dupliquer</b>, ou <Keys>Ctrl</Keys> +{' '}
                <Keys>D</Keys>. La copie se pose à côté de l'original, renommée
                (SW-ACC-01 → SW-ACC-02), avec les liaisons internes à la sélection.
              </>,
              <>
                <b>Alt + glisser</b> — le geste le plus direct : on attrape un équipement ou
                un bloc, on part avec une copie, l'original reste en place. Un Alt+clic qui
                ne bouge pas ne duplique rien.
              </>,
              <>
                <b>Copier / coller</b> — <Keys>Ctrl</Keys> + <Keys>C</Keys> puis{' '}
                <Keys>Ctrl</Keys> + <Keys>V</Keys>. Le bloc passe par le presse-papiers du
                système : on le colle sur une autre page, dans un autre document, dans une
                autre fenêtre du navigateur. Il se pose <b>là où est le pointeur</b>.{' '}
                <Keys>Ctrl</Keys> + <Keys>X</Keys> déplace au lieu de copier.
              </>,
              <>
                <b>Dupliquer une page entière</b> — clic droit sur l'onglet de page, ou
                « duplique la page » à la voix : tout le schéma, liaisons et annotations
                comprises, sur une nouvelle page.
              </>,
            ]}
          />

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">
            Dupliquer en série : douze agences d'un coup
          </p>
          <P>
            Bouton <b>En série…</b>, <Keys>Ctrl</Keys> + <Keys>Maj</Keys> + <Keys>D</Keys>, ou
            « duplique quatre fois » à la voix. Le dialogue produit N copies et montre le
            résultat <b>avant</b> de l'écrire : les noms que porteront les copies, le nombre
            de liaisons recréées, et les réserves.
          </P>
          <List
            items={[
              <>
                <b>Renommer</b> — remplacer un fragment (« BAT-A » par « BAT-@ »), ou encadrer
                d'un préfixe et d'un suffixe. Dans ces modèles, <code>#</code> vaut le numéro
                de la copie et <code>@</code> sa lettre : un bloc BAT-A devient BAT-B, BAT-C.
                Sans règle, le numéro terminal est simplement incrémenté.
              </>,
              <>
                <b>Site et zone</b> — « Agence # » nomme les copies Agence 2, Agence 3… et le
                placement automatique les range aussitôt en groupes distincts.
              </>,
              <>
                <b>Adressage</b> — un pas de réseau décale le troisième octet des IP et les
                VLAN à chaque copie : 10.10.<b>0</b>.1 devient 10.10.<b>1</b>.1, puis
                10.10.<b>2</b>.1.
              </>,
              <>
                <b>Recâblage</b> — les copies se rebranchent sur les mêmes voisins que
                l'original (le même switch cœur, la même chaîne d'énergie). Décochez la case
                pour obtenir des blocs indépendants, à raccorder ensuite.
              </>,
              <>
                <b>Grappes HA</b> — une grappe suit son bloc : les copies forment leurs
                propres grappes, et non une grappe géante à huit membres qui ferait crier
                l'analyse de haute disponibilité.
              </>,
            ]}
          />
          <Note>
            <b>Ce qui n'est jamais recopié</b> : numéro de série, immobilisation et place en
            baie. Deux équipements ne partagent aucun des trois — les laisser en double
            ferait mentir l'inventaire et le plan des baies. Les adresses IP, elles, sont
            recopiées : décalez-les d'un pas de réseau, ou videz-les. Le module{' '}
            <b>Dossier</b> signale de toute façon les adresses et les noms en double.
          </Note>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => openIn('diagram', () => setDuplicateOpen(true))}>
              Ouvrir la duplication en série
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'modules',
      title: 'Les six modules',
      keywords: 'onglets vues modules inventaire baies racks flux matrice dossier decouverte navigation',
      body: (
        <>
          <P>
            Les six onglets travaillent sur le <b>même</b> jeu de données : un serveur créé
            dans le schéma apparaît dans l'inventaire, et l'implanter dans une baie ne le
            déplace pas sur le plan.
          </P>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                view: 'diagram' as const,
                title: 'Schéma',
                text: 'Cartographie logique : équipements, liaisons, VLAN, couches OSI, analyse de haute disponibilité.',
              },
              {
                view: 'inventory' as const,
                title: 'Inventaire',
                text: 'Le parc en tableau : modèle, numéro de série, garantie, responsable, statut. Import et export CSV.',
              },
              {
                view: 'racks' as const,
                title: 'Baies',
                text: 'Implantation physique en U, façon GLPI : hauteur, position, puissance, taux de remplissage.',
              },
              {
                view: 'flows' as const,
                title: 'Flux',
                text: 'Matrice de flux contrôlée contre le schéma, et traçage du chemin entre deux équipements.',
              },
              {
                view: 'discovery' as const,
                title: 'Découverte',
                text: 'Relevés réseau (LLDP, CDP, ARP, nmap, CSV) transformés en cartographie, à fusionner avec le schéma.',
              },
              {
                view: 'dossier' as const,
                title: 'Dossier',
                text: 'Complétude du document, dossier technique imprimable, comparaison avec une version précédente.',
              },
            ].map((card) => (
              <button
                key={card.view}
                type="button"
                onClick={() => openIn(card.view)}
                className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
              >
                <p className="text-[13px] font-semibold text-slate-800">{card.title}</p>
                <p className="pt-0.5 text-[12px] leading-relaxed text-slate-600">{card.text}</p>
              </button>
            ))}
          </div>
        </>
      ),
    },
    {
      id: 'modes',
      title: 'Quatre modes de visualisation',
      keywords:
        'mode vue architecture technique presentation affichage projection lecture densite rendu',
      body: (
        <>
          <P>
            Le même schéma se regarde de quatre façons, sans jamais toucher au modèle. Le
            sélecteur est dans la barre d'outils (et dans <i>Mise en page</i>) ; chaque mode
            règle d'un coup ce qui s'affiche et comment c'est dessiné.
          </P>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                title: 'Architecture',
                text: 'Qui parle à qui. Boîtes colorées par type, cadres de sites et de zones bien marqués, liaisons épaisses portant leur débit — ni adressage, ni ports, ni numéros de série.',
              },
              {
                title: 'Technique',
                text: 'La documentation d’exploitation. Boîtes blanches et compactes portant adresse, modèle et numéro de série ; ports, VLAN, agrégat et rôle STP aux deux bouts de chaque liaison ; cadres de groupes effacés pour laisser lire les textes.',
              },
              {
                title: 'Logique',
                text: 'La vue du routage : seuls les équipements et liens de niveau 3, avec sous-réseaux, VRF et adresses aux deux bouts. Câblage, baies, alimentation et administration hors bande disparaissent du schéma.',
              },
              {
                title: 'Présentation',
                text: 'Pour projeter ou coller dans un document. Noms seuls en très gros, traits épais, boîtes ombrées, aucune étiquette technique — pas même l’adresse virtuelle des grappes.',
              },
            ].map((card) => (
              <div key={card.title} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[13px] font-semibold text-slate-800">{card.title}</p>
                <p className="pt-0.5 text-[12px] leading-relaxed text-slate-600">{card.text}</p>
              </div>
            ))}
          </div>
          <P>
            Les cases d'affichage restent modifiables après coup : le mode donne le point de
            départ, pas une prison. À la voix : « mode présentation », « vue technique »,
            « mode architecture ».
          </P>
          <Note>
            L'export <b>HTML</b> embarque les quatre vues dans un seul fichier : on passe de
            l'une à l'autre sans NetSchema, chez le destinataire.
          </Note>
        </>
      ),
    },
    {
      id: 'couches',
      title: 'Cadres de couche et marques constructeurs',
      keywords: 'couche cadre bande placement automatique agrandir reduire deplacer etaler resserrer marge poignee constructeur logo marque monogramme vendor cisco fortinet',
      body: (
        <>
          <P>
            Le placement automatique range les équipements par couches — Internet/WAN,
            périmètre, sécurité, cœur, distribution, accès… Chaque couche a désormais un{' '}
            <b>cadre en pointillés</b> que l'on peut reprendre à la main.
          </P>
          <List
            items={[
              <>
                <b>Déplacer</b> : la poignée à gauche du cadre (les six points). Toute la couche
                suit, et ses équipements sont épinglés — le prochain placement automatique ne
                les reprendra plus.
              </>,
              <>
                <b>Étaler ou resserrer</b> : les bords dans le sens de la couche. Les équipements
                s'écartent ou se rapprochent autour du centre du cadre.
              </>,
              <>
                <b>Agrandir ou réduire le cadre</b> : les bords en travers. Là, seule la marge du
                cadre change ; les équipements ne bougent pas.
              </>,
              <>
                <b>Renommer</b> : double-clic sur le nom de la couche, en marge du schéma.
              </>,
            ]}
          />
          <Note>
            Les cadres n'apparaissent que si <i>Afficher les noms de couches</i> est coché dans
            l'inspecteur, et ne figurent pas dans les exports.
          </Note>
          <P>
            Chaque boîte porte par ailleurs le <b>monogramme de son constructeur</b>, reconnu
            par le champ <i>Constructeur</i> ou, à défaut, par le modèle. Pour afficher vos
            <b> logos officiels</b> à la place, déposez les fichiers dans{' '}
            <code className="rounded bg-slate-100 px-1">public/logos/</code> et déclarez-les dans{' '}
            <code className="rounded bg-slate-100 px-1">index.json</code> : ils sont alors
            intégrés au schéma et à ses exports. L'application ne les fournit pas — ce sont des
            marques déposées, et le droit de les utiliser est le vôtre, pas le sien.
          </P>
        </>
      ),
    },
    {
      id: 'impact',
      title: 'Analyse d’impact : « que se passe-t-il si… »',
      keywords: 'impact panne simulation coupure arret switch cable debranche isole fragile redondance continuite pra pca criticite risque que se passe t il',
      body: (
        <>
          <P>
            Onglet <b>Impact</b> de l'inspecteur. On y désigne ce qui tombe — un switch, un
            câble, plusieurs à la fois — et le schéma répond aussitôt. Rien n'est modifié : la
            simulation vit à côté du document et s'efface d'un clic sur <i>Rétablir</i>.
          </P>
          <List
            items={[
              <>
                <b>Rouge</b> : déclaré en panne. <b>Orange</b> : isolé — plus aucun chemin vers
                le réseau. <b>Ambre</b> : ne tient plus qu'à un fil — encore joignable, mais la
                prochaine panne l'emporte.
              </>,
              <>
                Le panneau donne le compte, la part d'équipements encore joignables, la liste
                des isolés et, pour chaque équipement fragile, <b>le point de passage dont il
                dépend désormais</b>.
              </>,
              <>
                <b>Par quoi commencer</b> : le classement des équipements par l'effet de leur
                arrêt, pris un par un. Le haut de la liste est ce qu'il faut doubler en premier.
                Un clic sur un nom simule directement sa panne.
              </>,
            ]}
          />
          <P>
            L'analyse descend au niveau 2. Un VLAN n'est transporté que s'il est autorisé{' '}
            <b>aux deux extrémités</b> du trunk : le rapport nomme les VLAN interrompus, les
            équipements qu'ils desservaient, et distingue le cas où <i>un chemin physique
            subsiste mais n'autorise pas le VLAN</i> — la liste d'autorisation incomplète du
            lien de secours, erreur classique et pénible à trouver le jour de la panne. Les
            ports concernés sont listés avec leur mode (accès ou trunk), prêts à recopier dans
            un ticket.
          </P>
          <P>
            Les liens en état <b>alternatif ou bloqué</b> (spanning-tree) ne transportent rien
            en temps normal mais reprennent après convergence : le rapport signale lequel prend
            le relais et rappelle le délai — 1 à 3 s en RSTP/MSTP, jusqu'à 50 s en STP
            historique.
          </P>
          <Note>
            Chaque constat est rédigé en trois temps — ce que l'on voit, ce que cela implique,
            ce qu'il faut faire — et le bouton <i>Copier l'analyse</i> met le tout dans le
            presse-papiers, à coller dans un ticket ou un compte rendu d'incident.
          </Note>
          <Note>
            Les liaisons de service — battement de cœur, réplication, administration hors bande,
            alimentation — ne comptent pas comme chemin de données : un onduleur relié par son
            seul câble d'alimentation n'est pas « isolé du réseau ». Les points de référence
            sont les accès opérateur et le périmètre.
          </Note>
          <P>
            À la voix : « simule la panne de SW-CORE-01 », « débranche la liaison entre
            SW-CORE-01 et FW-01 », « quel est l'impact », « rétablis ».
          </P>
        </>
      ),
    },
    {
      id: 'zones',
      title: 'Info-bulles, bandeaux, zones et couches',
      keywords: 'info bulle infobulle survol fiche equipement bandeau palette inspecteur masquer cacher plein ecran zone site grappe couche renommer libelle bande perimetre distribution coeur de reseau',
      body: (
        <>
          <P>
            Trois façons de gagner en confort sur un grand schéma.
          </P>
          <List
            items={[
              <>
                <b>Survoler un équipement</b> affiche sa fiche : type, adresse, VLAN, matériel
                et numéro de série, site, zone, grappe, baie, responsable, état, puissance, fin
                de support (en rouge si elle est passée), note, et <b>la liste de ses
                liaisons</b> avec le débit et le port de chaque côté. Rien à ouvrir, rien à
                déplacer. Survoler une liaison donne de la même façon son détail.
              </>,
              <>
                <b>Masquer les bandeaux</b> : les deux boutons <i>Palette</i> et{' '}
                <i>Inspecteur</i> de la barre d'outils replient le bandeau de gauche et celui de
                droite — sur un portable, le plan de travail y gagne la moitié de sa largeur.
                Une languette sur le bord les ramène, et le réglage est retenu d'une séance à
                l'autre (il appartient au poste, pas au document).
              </>,
              <>
                <b>Renommer une zone, un site, une grappe ou une couche</b> : double-clic sur
                son libellé, directement sur le schéma. <Keys>Entrée</Keys> valide,{' '}
                <Keys>Échap</Keys> annule. Renommer une zone met à jour tous les équipements qui
                en font partie ; renommer une couche (« Cœur de réseau », « Distribution »…) ne
                touche qu'à son nom d'affichage, propre à ce schéma.
              </>,
            ]}
          />
          <Note>
            À la voix : « renomme la zone DMZ en Périmètre public », « renomme la couche Accès
            en Étage 2 », « renomme le site Siège en Paris », « renomme la grappe FW-HA en
            Pare-feu Paris ».
          </Note>
        </>
      ),
    },
    {
      id: 'pages',
      title: 'Plusieurs pages dans un même document',
      keywords: 'page onglet classeur document plusieurs schemas siege agence vue logique physique migration renommer verrouiller dupliquer supprimer bas',
      body: (
        <>
          <P>
            Un dossier réseau tient rarement sur un seul schéma : le siège et l'agence, la vue
            logique et la vue physique, l'avant et l'après d'une migration. La barre d'onglets,
            en bas de la fenêtre, permet de les garder dans <b>un même document</b> — un seul
            fichier, un seul enregistrement sur le serveur.
          </P>
          <List
            items={[
              <>
                <b>Ajouter</b> : le bouton <b>+</b> à droite des onglets, ou « ajoute une page
                Agence Lyon » à la voix.
              </>,
              <>
                <b>Renommer</b> : double-clic sur l'onglet, ou « renomme la page en Vue
                physique ». <Keys>Entrée</Keys> valide, <Keys>Échap</Keys> annule.
              </>,
              <>
                <b>Verrouiller</b> : clic droit sur l'onglet → <i>Verrouiller la page</i>. Un
                cadenas apparaît ; la page passe en lecture seule, les autres restent
                modifiables. Le verrou est enregistré avec le document.
              </>,
              <>
                <b>Dupliquer, déplacer, supprimer</b> : le même menu au clic droit. Une page
                verrouillée ne peut être ni renommée ni supprimée, et un document garde
                toujours au moins une page.
              </>,
              <>
                <b>Naviguer</b> : clic sur un onglet, ou « page suivante », « va à la page 2 »,
                « ouvre la page Agence Lyon ».
              </>,
            ]}
          />
          <Note>
            Chaque page est un schéma complet et indépendant : ses équipements, ses liaisons,
            son plan d'adressage, ses baies. L'inventaire et les baies affichent la page
            ouverte. L'export <b>HTML</b>, lui, embarque <b>toutes les pages</b> — chacune dans
            ses quatre vues.
          </Note>
          <Note>
            L'annulation (<Keys>Ctrl</Keys> <Keys>Z</Keys>) ne traverse pas les pages : changer
            d'onglet repart d'un historique vierge, pour qu'un « annuler » ne modifie jamais une
            page que vous ne voyez pas.
          </Note>
        </>
      ),
    },
    {
      id: 'annoter',
      title: 'Annoter, cartouche et légende',
      keywords: 'note annotation cadre fleche commentaire reserve cartouche legende indice revision diffusion document',
      body: (
        <>
          <P>
            Un schéma porte aussi ce qu'il ne montre pas : une réserve, un périmètre de
            travaux, un renvoi. Trois outils dans la barre d'outils du module Schéma.
          </P>
          <List
            items={[
              <>
                <b>Note</b> — un texte sur fond teinté. Double-clic sur le plan pour l'écrire
                (<Keys>Maj</Keys> + <Keys>Entrée</Keys> pour une nouvelle ligne), poignée du
                coin pour la redimensionner, six couleurs dans l'inspecteur.
              </>,
              <>
                <b>Cadre</b> — un rectangle en pointillés avec un libellé, pour délimiter un
                périmètre qui n'est pas une zone du schéma (un lot, une phase de migration).
              </>,
              <>
                <b>Flèche</b> — un renvoi, avec un libellé facultatif.
              </>,
              <>
                <b>Cartouche</b> (inspecteur → <i>Document</i>) — organisation, référence,
                indice de révision, date, auteur, état et mention de diffusion, dessinés sous
                le schéma. Un plan qui circule sans indice ni mention de diffusion ne peut être
                ni daté, ni comparé, ni transmis en confiance.
              </>,
              <>
                <b>Légende</b> — construite d'après le contenu réel de la page : les types de
                liaison présents et les familles d'équipements, avec leur nombre.
              </>,
            ]}
          />
          <P>
            Annotations, cartouche et légende appartiennent au document : ils suivent les
            pages, l'enregistrement et partent dans tous les exports.
          </P>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => tryCommand('Ajoute une note Migration prévue au troisième trimestre')}>
              Essayer : « ajoute une note… »
            </Btn>
            <Btn onClick={() => tryCommand('Affiche la légende')}>Essayer : « affiche la légende »</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'flux',
      title: 'Matrice de flux et traçage de chemin',
      keywords: 'flux matrice pare-feu filtrage ports protocole justification chemin trajet redondance securite',
      body: (
        <>
          <P>
            Module <b>Flux</b>. La matrice dit qui a le droit de parler à qui, avec quel
            service et pourquoi — la pièce que réclame toute revue de sécurité.
          </P>
          <P>
            Chaque ligne est <b>contrôlée contre le schéma</b> : extrémité qui n'existe pas,
            chemin ne traversant aucun équipement de filtrage, traversée d'un lien opérateur
            sans protection déclarée, VLAN absent d'un trunk, justification manquante,
            ouverture en « any ».
          </P>
          <List
            items={[
              <>
                <b>Proposer d'après le schéma</b> — une ligne « à étudier » par couple de zones
                réellement reliées, à qualifier ensuite.
              </>,
              <>
                <b>Import / export CSV</b> — pour reprendre une matrice de tableur et la rendre
                à qui la demande.
              </>,
              <>
                <b>Tracer un chemin</b> — le chemin le plus court puis les secours
                <i> réellement indépendants</i> : filtrage traversé, maillon le plus lent, MTU
                hétérogène, liaison bloquée par spanning-tree, lien de service emprunté.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('flows')}>Ouvrir la matrice de flux</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'dossier',
      title: 'Dossier : complétude, PDF, comparaison',
      keywords: 'dossier technique pdf impression completude qualite controle comparaison version diff drawio csv',
      body: (
        <>
          <P>
            Module <b>Dossier</b> : ce qui transforme un schéma en pièce livrable.
          </P>
          <List
            items={[
              <>
                <b>Complétude</b> — cartouche, zones, équipements isolés, homonymes, adresses IP
                en double, recouvrement de sous-réseaux, VLAN orphelins, numéros de série,
                responsables, garanties, implantation en baie, sauvegarde, administration hors
                bande. Chaque constat dit quoi faire et mène aux équipements concernés.
              </>,
              <>
                <b>Dossier technique imprimable</b> — page de garde, sommaire, schémas,
                inventaire, liaisons, plan d'adressage, baies et puissance installée, matrice de
                flux, réserves. Ouvrez le fichier et imprimez-le en PDF.
              </>,
              <>
                <b>Comparer avec une version</b> — sur les données, pas sur le dessin : un
                équipement déplacé n'est pas une modification, un port renommé en est une.
              </>,
              <>
                <b>Autres exports</b> — draw.io (une page par onglet), inventaire et matrice en
                CSV.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('dossier')}>Ouvrir le dossier</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'export',
      title: 'Exporter : SVG, PNG, page interactive',
      keywords: 'export svg png html page interactive partager transmettre document imprimer navigation autonome hors ligne',
      body: (
        <>
          <P>
            Trois formats, trois usages. Les boutons sont à droite de la barre d'outils.
          </P>
          <List
            items={[
              <>
                <b>SVG</b> — une image vectorielle de la vue courante, à reprendre dans Visio,
                Illustrator, Word ou un wiki. Elle ne contient qu'une vue et ne se manipule
                pas : c'est une image.
              </>,
              <>
                <b>PNG</b> — la même chose en points, ×2, sur fond blanc. Pour un courriel ou
                une diapositive.
              </>,
              <>
                <b>HTML</b> — une <b>page autonome</b> qui contient <b>toutes les pages du
                document</b>, chacune dans <b>ses quatre vues</b>,
                toutes les informations saisies et de quoi s'y déplacer. Un seul fichier, qui
                s'ouvre d'un double-clic sur n'importe quel poste : ni serveur, ni Internet, ni
                NetSchema.
              </>,
            ]}
          />
          <P>Dans la page exportée, le destinataire retrouve :</P>
          <List
            items={[
              <>les <b>quatre vues</b> en onglets — architecture, technique, logique, présentation ;</>,
              <>
                des <b>cases à cocher</b> pour montrer ou masquer les étiquettes de liaison,
                les ports et adresses des extrémités, les détails des équipements, les cadres
                de groupes et les noms de couches ;
              </>,
              <>le <b>zoom</b> à la molette, le déplacement en glissant, un bouton <i>Ajuster</i> ;</>,
              <>la <b>fiche</b> d'un équipement d'un clic, le <b>détail d'une liaison</b> au survol ;</>,
              <>une <b>recherche</b> qui estompe tout ce qui ne correspond pas ;</>,
              <>
                deux <b>tableaux</b> — équipements et liaisons — avec l'intégralité des
                informations, y compris ce que le schéma ne montre pas.
              </>,
            ]}
          />
          <Note>
            Pourquoi pas un SVG interactif ? Parce que la plupart des visionneuses de SVG en
            ignorent le script : le fichier s'ouvrirait, mais rien ne répondrait. Une page HTML
            se comporte partout de la même façon — et s'imprime correctement, la vue affichée
            tenant sur la feuille.
          </Note>
        </>
      ),
    },
    {
      id: 'verrous',
      title: 'Verrouiller un schéma',
      keywords: 'verrou verrouiller cadenas lecture seule fige protection etiquettes valider publier',
      body: (
        <>
          <P>
            Un schéma validé n'a plus à bouger — surtout s'il est ouvert par d'autres personnes.
            Deux verrous, indépendants, enregistrés <b>avec le schéma</b> : ils suivent le
            document, y compris après un export et un import sur un autre poste.
          </P>
          <List
            items={[
              <>
                <b>Verrouiller le schéma</b> (barre d'outils, ou « verrouille le schéma » à la
                voix) : lecture seule complète. On peut toujours naviguer, zoomer, replier,
                changer de vue OSI ou de mode, consulter les fiches, interroger et exporter ;
                rien ne peut plus être déplacé, ajouté, relié ni supprimé — ni à la souris, ni
                au clavier, ni à la voix, ni par un import.
              </>,
              <>
                <b>Verrouiller les étiquettes</b> : leur position calculée est inscrite dans le
                schéma et n'est plus recalculée. Utile quand on a soigné une mise en page et
                qu'on ne veut plus qu'elle bouge quand le schéma évolue. Déverrouiller les rend
                de nouveau déplaçables ; <i>Tracé auto</i> les remet au placement automatique.
              </>,
            ]}
          />
        </>
      ),
    },
    {
      id: 'serveur',
      title: 'Travailler à plusieurs (mode serveur)',
      keywords: 'serveur client compte connexion identifiant mot de passe session role lecteur editeur admin partage enregistrement automatique conflit deconnexion windows',
      body: (
        <>
          <P>
            L'application fonctionne de deux façons et choisit toute seule au démarrage. Posée
            comme fichiers statiques, elle travaille <b>en local</b> : les schémas restent dans
            le navigateur du poste. Servie par le serveur NetSchema, elle demande d'abord une
            <b> connexion</b> et range les schémas sur le serveur, où l'équipe les partage.
          </P>
          <P>
            En mode serveur, un bandeau apparaît en haut de la fenêtre :
          </P>
          <List
            items={[
              <>
                <b>Schémas</b> : la liste de ceux du serveur — ouvrir, créer, supprimer (la
                suppression est réservée aux administrateurs).
              </>,
              <>
                <b>État de l'enregistrement</b> : tout est enregistré automatiquement quelques
                secondes après la dernière modification. <Keys>Ctrl</Keys> <Keys>S</Keys> force
                l'enregistrement sans attendre.
              </>,
              <>
                <b>Compte et rôle</b>, puis <b>Quitter</b> pour fermer la session.
              </>,
            ]}
          />
          <P>
            Trois rôles : <i>lecteur</i> consulte, <i>éditeur</i> modifie, <i>admin</i> gère les
            comptes et les suppressions. Un lecteur retrouve le schéma dans l'état verrouillé
            décrit plus haut : navigation, recherche et exports restent ouverts, l'édition non.
          </P>
          <Note>
            Si deux personnes modifient le même schéma en même temps, la seconde à enregistrer
            est prévenue d'un conflit plutôt que d'écraser le travail de l'autre : rouvrez le
            schéma pour repartir de la version du serveur.
          </Note>
        </>
      ),
    },
    {
      id: 'schema',
      title: 'Construire le schéma',
      keywords: 'palette equipement materiel deplacer selection groupes zones sites grappes disposition automatique epingler motifs premier plan arriere plan empilement chevauchement ordre',
      body: (
        <>
          <List
            items={[
              <>
                <b>Ajouter</b> : glisser-déposer depuis la palette, double-clic sur une entrée de
                la palette, ou <Keys>Ctrl</Keys> <Keys>K</Keys> pour la recherche universelle.
              </>,
              <>
                <b>Sélectionner</b> : un clic ; <Keys>Maj</Keys> + clic pour ajouter ; un
                rectangle tracé dans le vide pour une sélection multiple.
              </>,
              <>
                <b>Déplacer</b> : glisser un équipement. Un équipement déplacé à la main est
                <i> épinglé</i> : la disposition automatique ne le reprend plus.
              </>,
              <>
                <b>Regrouper</b> : les champs <i>Site</i>, <i>Zone</i> et <i>Grappe</i> de
                l'inspecteur dessinent les cadres et guident le rangement automatique.
              </>,
              <>
                <b>Premier plan / arrière-plan</b> : quand deux boîtes se chevauchent, c'est
                l'ordre d'empilement qui tranche. Les quatre boutons <i>Plan d'affichage</i> de
                l'inspecteur — ou <Keys>Ctrl</Keys> <Keys>Maj</Keys> <Keys>F</Keys> et
                <Keys>Ctrl</Keys> <Keys>Maj</Keys> <Keys>B</Keys>, <Keys>]</Keys> et
                <Keys>[</Keys> pour un cran — le règlent pour la sélection.
              </>,
              <>
                <b>Motifs</b> : le panneau Haute dispo propose des ensembles prêts à poser (paire
                de pare-feu, cœur redondant, cluster hyperviseur…).
              </>,
            ]}
          />
          <Note>
            La disposition automatique est rejouable à tout moment : elle ne détruit rien, elle
            range. Épinglez ce que vous voulez figer, elle s'arrangera autour.
          </Note>
        </>
      ),
    },
    {
      id: 'liaisons',
      title: 'Liaisons, tracés et couches OSI',
      keywords: 'liaisons liens cable fibre trunk vlan lacp agregat osi couche niveau 2 3 routage trace point de passage ancrage accroche brancher rebrancher extremite courbe orthogonal croisement pont saut port stp spanning tree superposition chevauchement confondues couloir ecarter lisibilite etiquette libelle deplacer debit texte',
      body: (
        <>
          <P>
            Une liaison porte un type physique (cuivre, fibre, agrégat, sans-fil, WAN, virtuel) et
            ses attributs de niveau 2 et 3 : débit, VLAN transportés, mode accès ou trunk,
            agrégation, sous-réseau.
          </P>
          <List
            items={[
              <>
                <b>Tracer à la main</b> : tirez le trait d'une liaison, un point de passage
                apparaît là où vous l'avez saisi. Glissez-le pour le déplacer, double-cliquez
                dessus pour le retirer.
              </>,
              <>
                <b>Choisir où la liaison se branche</b> : sélectionnez-la, puis glissez l'un des
                deux carrés verts — ses extrémités — sur la boîte d'un équipement.{' '}
                <b>Seize repères apparaissent tout autour</b> : les quatre coins, le milieu et
                les quarts de chaque côté. Le plus proche s'allume, et c'est là que la liaison
                se branche. Elle en sort perpendiculairement avant de repartir, et le point suit
                l'équipement quand on le déplace.
              </>,
              <>
                <b>Se poser entre deux repères</b> : gardez <Keys>Alt</Keys> enfoncé pendant la
                glisse — l'aimant se désactive et l'accroche se pose exactement sous le pointeur.
                Sans lui, deux liaisons voisines arriveraient à trois pixels l'une de l'autre.
                <b> Double-clic</b> sur une poignée : retour à l'accroche calculée.
              </>,
              <>
                <b>Rebrancher ailleurs</b> : lâchez cette même extrémité sur un <i>autre</i>
                équipement et la liaison change de destination, sans avoir à la supprimer.
              </>,
              <>
                <b>À la création</b> : en mode <Keys>L</Keys>, les repères s'affichent au survol
                de la boîte visée — cliquer dessus fixe l'accroche, cliquer au centre laisse
                l'application choisir.
              </>,
              <>
                <b>Forme</b> : automatique, orthogonale, droite ou courbe, au choix dans
                l'inspecteur — avec les angles arrondis pour les tracés orthogonaux.
              </>,
              <>
                <b>Ancrage</b> : forcez le côté de départ ou d'arrivée (haut, bas, gauche, droite)
                quand la liaison doit contourner un bloc.
              </>,
              <>
                <b>Jamais deux liaisons confondues</b> : les liaisons qui quittent un
                équipement par le même côté sont réparties le long de l'arête, dans l'ordre de
                leurs destinations, et celles qui emprunteraient le même couloir sont rangées
                dans des couloirs voisins — comme des câbles dans un chemin de câbles. Sur le
                schéma d'exemple, on passe de 79 couples de liaisons superposées à 6. Un tracé
                que vous avez dessiné (point de passage, accroche libre) n'est jamais déplacé :
                superposer deux liaisons reste possible, mais c'est alors votre décision. La
                case <i>Écarter les liaisons superposées</i> (Mise en page) coupe le mécanisme.
              </>,
              <>
                <b>Tout le détail au survol</b> : passez la souris sur une liaison, une
                info-bulle donne ce que le schéma ne montre pas — type, débit, sous-réseau,
                VRF, routage, MTU — et la configuration de chaque extrémité côte à côte (port,
                mode, VLAN, agrégat, rôle spanning-tree, adresse).
              </>,
              <>
                <b>Étiquettes lisibles et déplaçables</b> : débits, VLAN, ports et adresses se
                posent à côté du trait, à un endroit libre — jamais sur une boîte ni sur une
                autre étiquette. Une qui ne vous convient pas se <b>glisse</b> où vous voulez ;
                un trait de rappel la relie alors à sa liaison, elle suit l'équipement quand il
                se déplace, et les autres s'arrangent autour d'elle. Double-clic dessus pour
                revenir au placement automatique.
              </>,
              <>
                <b>Croisements visibles</b> : quand deux liaisons se coupent sans se
                raccorder, celle du dessus enjambe l'autre par un petit pont — comme sur un
                schéma électrique. Le compteur en bas à droite du plan indique combien il y en
                a : c'est un bon indicateur de lisibilité. Se coupe dans <i>Mise en page</i> ou
                à la voix (« masque les croisements »).
              </>,
              <>
                <b>Vues OSI</b> : <i>Couche 2</i> met en avant le domaine de diffusion et les
                VLAN, <i>Couche 3</i> les sous-réseaux et le routage. Les liaisons hors couche
                s'estompent — en mode strict, elles disparaissent.
              </>,
              <>
                <b>Chaque bout de câble, de son côté</b> : en couche 1 et 2, le port et sa
                configuration (mode, VLAN, VLAN natif, agrégat, rôle spanning-tree) sont écrits
                à la sortie de l'équipement concerné, pas au milieu du trait ; en couche 3, ce
                sont les adresses d'interface. L'inspecteur a un bloc par extrémité : ce qui y
                est laissé vide hérite de la valeur commune à la liaison.
              </>,
              <>
                <b>VLAN</b> : le panneau VLAN tient la table (identifiant, nom, sous-réseau,
                passerelle) et signale les incohérences d'adressage et les boucles de niveau 2.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('diagram', () => setPanel('osi'))}>Ouvrir le panneau OSI</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'vues-logiques',
      title: 'Vues logiques : routage, plan VLAN, domaines de diffusion',
      keywords:
        'vue logique vues logiques vlan vlans routage couche 3 l3 svi passerelle gateway domaine de diffusion broadcast rail rails plan vlan projecteur focus segment sous-reseau subnet inter-vlan',
      body: (
        <>
          <P>
            Le schéma d'infrastructure répond à « qu'est-ce qui est branché où ». Il ne répond
            pas à « qui parle à qui sans passer par un routeur » — la question des VLAN, et
            celle qu'on pose en exploitation, en sécurité et en migration. Le mode{' '}
            <b>Logique</b> ouvre trois lectures du même document, choisies dans le sélecteur
            bleu de la barre d'outils.
          </P>
          <Note>
            Ce sont des <b>projections</b> : elles sont recalculées depuis le document à
            chaque affichage, et <b>rien ne s'y modifie</b>. Un bandeau le rappelle en haut du
            plan. Le document, lui, ne bouge pas — on le retrouve intact en revenant sur
            <b> Architecture</b>.
          </Note>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Routage (couche 3)</p>
          <P>
            Ne survit que ce qui décide d'un chemin : routeurs, pare-feu, répartiteurs, cœur de
            niveau 3, extrémités WAN, et tout équipement qui porte une passerelle. Les chaînes
            de commutation disparaissent, remplacées par les <b>réseaux qu'elles desservent</b>
            — un nuage par VLAN adressé, raccroché à l'équipement qui porte sa passerelle. Le
            plan de routage tient alors sur une page et se lit comme un plan d'adressage.
          </P>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">
            Plan VLAN — un rail par VLAN
          </p>
          <P>
            Chaque VLAN devient une ligne de sa couleur, et les équipements s'y accrochent. Il
            n'y a plus de câble : dans un domaine de diffusion, tout le monde se parle
            directement, et c'est précisément ce que le rail veut dire. Les commutateurs de
            transit y figurent aussi — c'est ainsi qu'on repère un VLAN qui traverse un
            bâtiment qu'il ne devrait pas traverser.
          </P>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">
            Domaines de diffusion
          </p>
          <P>
            Le même découpage, mais avec le routage : un cadre par VLAN, sa passerelle, et un
            trait vers le point de routage central. <b>Chaque trait est un franchissement de
            routeur</b> — donc un endroit où l'on filtre. Un VLAN sans trait ne sort pas du
            niveau 2 : la synchronisation de grappe, le VLAN natif, tout ce qui doit rester
            confiné se voit immédiatement.
          </P>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Projecteur VLAN</p>
          <P>
            Indépendant des trois lectures, et disponible dans <b>toutes</b> les vues : le
            sélecteur « Tous les VLAN » allume un VLAN et estompe le reste, sans rien retirer
            du plan. C'est l'outil de dépannage — « par où passe le 20 ? », « ce trunk le
            transporte-t-il ? », « quel bâtiment atteint-il ? ». <Keys>Ctrl</Keys> +{' '}
            <Keys>K</Keys> puis « vlan 20 » fait la même chose au clavier.
          </P>
          <List
            items={[
              <>
                Un VLAN cité sur une liaison mais absent du plan d'adressage apparaît quand
                même : le module <b>Dossier</b> le signale comme orphelin.
              </>,
              <>
                Les vues logiques s'exportent comme le reste — SVG, PNG, page interactive —
                puisqu'elles sont dessinées avec la même machinerie.
              </>,
              <>
                À la voix : « plan VLAN », « domaines de diffusion », « vue du routage »,
                « projecteur sur le VLAN 20 », « tous les VLAN ».
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => openIn('diagram', () => setVueLogique('rails'))}>
              Voir le plan VLAN
            </Btn>
            <Btn onClick={() => openIn('diagram', () => setVueLogique('domaines'))}>
              Voir les domaines de diffusion
            </Btn>
            <Btn onClick={() => tryCommand('projecteur sur le VLAN 20')}>
              Essayer le projecteur
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'agregats',
      title: 'Agrégats de liens : port-channels, LACP, MLAG',
      keywords:
        'agregat agrégat port-channel portchannel po lacp 802.3ad 802.1ax bundle bonding lag teaming etherchannel faisceau ovale mlag vpc vsx vlt multi-chassis brins debit cumule negociation active passive statique',
      body: (
        <>
          <P>
            Deux câbles entre les mêmes équipements et un port-channel de deux membres se
            dessinent de la même façon : deux traits. Ce n'est pourtant pas la même chose.
            Deux câbles indépendants, ce sont deux chemins que le spanning-tree va arbitrer —
            un seul travaille. Un port-channel, c'est <b>un seul lien logique</b> dont les
            débits s'additionnent et qui ne coupe pas quand un brin tombe.
          </P>
          <Note>
            NetSchema matérialise donc les agrégats selon l'usage du métier : un{' '}
            <b>ovale encercle les brins</b> et porte le nom du bundle et son débit — « Po21 ·
            2 × 10 Gb/s ». C'est le symbole que tout le monde reconnaît depuis les premiers
            EtherChannel, et le seul de la légende qui ne se devine pas.
          </Note>

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Déclarer un agrégat</p>
          <List
            items={[
              <>
                Sélectionnez une liaison, puis, dans <b>Niveau 2 — liaison</b>, renseignez{' '}
                <b>Agrégat (port-channel)</b> : <code>Po1</code>, <code>ag1</code>,{' '}
                <code>bond0</code>, ce que vous voulez. Donnez le <b>même nom</b> aux brins qui
                vont ensemble : c'est ce qui les réunit.
              </>,
              <>
                Le nom du port-channel est <b>local à chaque châssis</b>. Quand il diffère
                d'un bout à l'autre, saisissez-le côté par côté plus bas dans le même panneau ;
                l'ovale est alors posé côté de l'équipement qui porte le faisceau.
              </>,
              <>
                <b>Négociation de l'agrégat</b> : LACP actif, LACP passif, ou statique (mode
                « on »). Un agrégat statique est tracé en pointillés — il ne détecte pas un
                brin resté allumé mais muet.
              </>,
              <>
                À l'import rapide : <code>lag=Po1 lacp=actif</code> sur chacune des deux lignes
                de liaison. L'assistant, lui, propose de déclarer l'agrégat quand il voit des
                liens parallèles non documentés.
              </>,
            ]}
          />

          <p className="pt-1 text-[12.5px] font-semibold text-slate-700">Ce que l'ovale raconte</p>
          <List
            items={[
              <>
                <b>Faisceau entre deux mêmes équipements</b> : l'ovale se pose au milieu. C'est
                le cas d'un peer-link MLAG, qui n'est jamais un seul câble en production.
              </>,
              <>
                <b>Agrégat multi-châssis</b> (vPC, VSX, MLAG, VLT) : les brins montent vers
                deux châssis différents, et l'ovale se pose près de l'équipement qui porte le
                port-channel. Le schéma montre alors, d'un coup d'œil, qu'un seul lien logique
                s'appuie sur deux boîtiers.
              </>,
              <>
                <b>En ambre</b>, l'agrégat est incohérent. Survolez-le : débits inégaux entre
                brins, MTU ou VLAN divergents, brin marqué « secours » alors que tous les
                membres d'un agrégat sont actifs, deux extrémités en LACP passif — qui ne
                formeront jamais le bundle —, ou agrégat multi-châssis sans mécanisme déclaré
                côté réseau.
              </>,
              <>
                Un <b>clic sur l'ovale</b> sélectionne tous les brins d'un coup ; l'inspecteur
                résume alors le faisceau et le module <b>Dossier</b> en dresse le tableau
                complet.
              </>,
            ]}
          />
          <Note>
            Les ovales se masquent d'un clic (<i>Encercler les agrégats</i>, dans Mise en page)
            ou à la voix (« masque les agrégats »), et disparaissent d'eux-mêmes en mode{' '}
            <b>Présentation</b>, où le plan doit rester nu.
          </Note>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => openIn('diagram', loadSample)}>
              Voir sur le schéma d'exemple
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'ha',
      title: 'Haute disponibilité',
      keywords: 'haute disponibilite ha redondance spof panne cluster grappe vip actif passif temoin score audit onduleur alimentation mecanisme bascule vpc vsx mlag fgcp clusterxl vrrp hsrp vsphere metrocluster stack empilement',
      body: (
        <>
          <P>
            Le panneau <b>Haute dispo</b> relit le schéma comme le ferait un auditeur : il note la
            robustesse sur 100 et liste les constats, du plus grave au plus anodin.
          </P>
          <List
            items={[
              <>
                <b>Points de défaillance unique</b> : les équipements dont la panne coupe le
                schéma en deux sont identifiés par calcul (points d'articulation du graphe).
              </>,
              <>
                <b>Rôles</b> : actif, passif, actif-actif, témoin. Une grappe sans témoin, un
                actif sans secours, une VIP absente sont signalés.
              </>,
              <>
                <b>Alimentation</b> : un équipement à une seule alimentation dans une salle
                redondée ressort dans les constats.
              </>,
              <>
                <b>Motifs</b> : insérez une architecture de référence (paire de pare-feu en
                actif-passif, cœur en pile, cluster à trois nœuds) et adaptez-la.
              </>,
            ]}
          />

          <P>
            <b>Le mécanisme de bascule.</b> « Deux pare-feu en grappe » ne dit pas lequel : un
            FGCP Fortinet, un ClusterXL Check Point et un chassis cluster SRX ne se câblent pas
            pareil et ne basculent pas dans le même temps. L'inspecteur propose donc, pour
            chaque équipement de grappe, la liste des mécanismes de son type et de son
            constructeur — 65 en tout, du vPC au MetroCluster.
          </P>
          <List
            items={[
              <>
                Chaque mécanisme dit ce qu'il faut <b>câbler</b> entre les membres (peer-link,
                HA1/HA2, control link + fabric link…), s'il faut un <b>témoin</b>, l'ordre de
                grandeur de la <b>bascule</b>, et le piège qui lui est propre.
              </>,
              <>
                <b>Plan de contrôle commun</b> : un empilement ou un châssis virtuel se met à
                jour d'un bloc. La grappe protège du matériel, pas d'un bogue logiciel —
                l'analyse le dit explicitement.
              </>,
              <>
                <b>Déduire</b> : le bouton du panneau propose un mécanisme pour les grappes qui
                n'en déclarent pas, d'après le matériel et la liaison déjà tracée.
              </>,
              <>
                L'analyse vérifie ensuite la cohérence : mécanisme impossible chez ce
                constructeur, membres trop nombreux, liaison de synchronisation absente, témoin
                manquant, rôles incohérents.
              </>,
              <>
                <b>La gamme compte autant que la marque.</b> vPC est un mécanisme Nexus et non
                Catalyst ; VSX s'adresse aux CX 8000 et non aux CX 6000 ; l'actif/actif PAN-OS
                demande une PA-3400 ou au-dessus, une PA-450 n'en fait pas. L'analyse nomme
                alors le mécanisme attendu sur ce matériel.
              </>,
              <>
                <b>Le compte des liaisons</b> suit le mécanisme : une paire Palo Alto
                actif/passif demande HA1 et HA2, une paire actif/actif y ajoute HA3. Un seul
                lien tracé, et l'analyse dit lequel manque.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('diagram', () => setPanel('ha'))}>Ouvrir l'analyse</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'lisibilite',
      title: 'Simplifier un schéma complexe',
      keywords: 'simplifier detail synthese replier plier groupes lisibilite masquer postes complexite',
      body: (
        <>
          <P>
            Une architecture de 200 équipements ne se lit pas d'un bloc. Trois leviers, cumulables
            et réversibles, sans rien supprimer :
          </P>
          <List
            items={[
              <>
                <b>Niveau de détail</b> : <i>Complet</i>, <i>Sans les postes</i> (les terminaux
                disparaissent) ou <i>Synthèse</i> (seules l'ossature et les liaisons structurantes
                restent).
              </>,
              <>
                <b>Replier un groupe</b> : double-cliquez sur le cadre d'une zone ou d'un site. Il
                devient une brique unique, ses liaisons sortantes sont regroupées et comptées.
              </>,
              <>
                <b>Vue par couche</b> : afficher la seule couche 2 ou la seule couche 3 retire de
                l'image tout ce qui relève de l'autre.
              </>,
            ]}
          />
          <P>
            À la voix : « synthèse », « masque les postes », « replie la zone Bâtiment A »,
            « couche 3 », « détail complet ».
          </P>
        </>
      ),
    },
    {
      id: 'voix',
      title: 'Commande vocale',
      keywords: 'voix vocal vocale micro microphone dictee dicter parler reconnaissance commandes phrases exemples chrome edge',
      body: (
        <>
          <P>
            Le bouton <b>Voix</b> (en haut à droite) ouvre le panneau de dictée. Tout ce qui se
            fait à la souris se dit : créer, modifier, relier, supprimer, interroger, exporter.
            Le même champ accepte les commandes <b>tapées</b> — utile sur Firefox, sans micro, ou
            dans un local bruyant.
          </P>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="pb-1.5 text-[12px] font-semibold text-slate-700">
              Bien se faire comprendre
            </p>
            <List
              items={[
                <>
                  <b>Dites la phrase d'une traite</b>, puis marquez une pause : la commande part
                  après un court silence, ce qui évite qu'elle soit coupée en deux.
                </>,
                <>
                  <b>Épelez les sigles</b> : « S W core zéro un » est recollé en « SW-CORE-01 ».
                  Les lettres isolées sont rassemblées automatiquement.
                </>,
                <>
                  <b>Dites les nombres comme ils se lisent</b> : « dix point dix point zéro point
                  onze » devient <code>10.10.0.11</code>, « zéro deux » devient <code>02</code>,
                  « slash vingt-quatre » devient <code>/24</code>.
                </>,
                <>
                  <b>Un mot de travers n'est pas grave</b> : « pare-fou », « switche », « postes
                  de travail » retombent sur le bon type. Les noms d'équipements sont eux aussi
                  rapprochés du plus ressemblant.
                </>,
                <>
                  <b>Quand la phrase n'est pas comprise</b>, le panneau propose les commandes les
                  plus proches : un clic les exécute.
                </>,
                <>
                  <b>Micro et navigateur</b> : Chrome ou Edge, en HTTPS ou sur
                  <code> localhost</code>, avec une connexion réseau (la reconnaissance est faite
                  par le navigateur, en ligne). Un casque-micro vaut mieux qu'un micro de portable
                  en salle machine.
                </>,
              ]}
            />
          </div>
          <P>
            Cliquez un exemple pour l'exécuter tout de suite — c'est la façon la plus rapide de
            voir ce que l'application comprend. Une commande qui modifie le schéma vous y ramène
            aussitôt, la réponse s'affiche en bas de l'écran.
          </P>
          {tried && (
            <p
              className={`rounded-lg px-3 py-2 text-[12px] ${
                tried.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
              }`}
            >
              « {tried.command} » → {tried.message}
            </p>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {VOICE_EXAMPLE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-xl border border-slate-200 bg-white p-2.5">
                <p className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.examples.map((example) => (
                    <li key={example}>
                      <button
                        type="button"
                        onClick={() => tryCommand(example)}
                        className="text-left text-[12px] leading-snug text-slate-600 hover:text-blue-700 hover:underline"
                      >
                        « {example} »
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => setVoiceOpen(true)}>
              Ouvrir le panneau vocal
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'imports',
      title: 'Imports et exports',
      keywords: 'import export drawio draw.io diagrams csv json png svg image texte visio sauvegarde fichier',
      body: (
        <>
          <List
            items={[
              <>
                <b>draw.io / diagrams.net</b> : déposez un fichier <code>.drawio</code> ou
                <code> .xml</code> (y compris compressé). Les formes sont rapprochées du catalogue
                par leur libellé et leur style, les liens deviennent des liaisons.
              </>,
              <>
                <b>Import rapide</b> (<Keys>Ctrl</Keys> <Keys>I</Keys>) : une ligne par liaison,
                <code> SW-CORE-01 &gt; FW-01</code>. Les équipements manquants sont créés, leur
                type déduit du nom.
              </>,
              <>
                <b>CSV d'inventaire</b> : colonnes libres (nom, modèle, série, garantie,
                responsable, baie, U…). Les lignes existantes sont mises à jour, les autres
                créées.
              </>,
              <>
                <b>JSON NetSchema</b> : le format complet, pour sauvegarder, versionner ou passer
                le schéma à un collègue.
              </>,
              <>
                <b>PNG et SVG</b> : l'export reprend exactement ce qui est affiché — niveau de
                détail, groupes repliés, vue OSI comprise. Le SVG reste modifiable dans un
                éditeur vectoriel.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('diagram', () => setImportOpen(true))}>
              Ouvrir l'import rapide
            </Btn>
            <Btn onClick={() => openIn('diagram', () => setCommandOpen(true))}>
              Recherche universelle
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'decouverte',
      title: 'Découverte du réseau',
      keywords: 'decouverte lldp cdp arp nmap snmp collecteur scan sonde cartographie fusion',
      body: (
        <>
          <P>
            Un navigateur ne peut ni envoyer un ping ni interroger en SNMP : la collecte se fait
            donc à côté, puis le relevé est interprété ici.
          </P>
          <ol className="flex flex-col gap-2">
            <Step n={1}>
              Collectez : sortie de <code>show lldp neighbors detail</code>, de
              <code> show cdp neighbors</code>, table ARP, export nmap, ou le collecteur fourni
              (<code>tools/collector/netschema-collect.mjs</code>) qui produit un JSON prêt à
              déposer.
            </Step>
            <Step n={2}>
              Déposez le fichier ou collez le texte : le format est reconnu tout seul et
              l'aperçu montre les équipements et les voisinages détectés.
            </Step>
            <Step n={3}>
              Fusionnez : les équipements déjà présents sont enrichis (adresse, modèle, voisins),
              les nouveaux sont créés et placés.
            </Step>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('discovery')}>Ouvrir la découverte</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'inventaire',
      title: 'Inventaire et baies',
      keywords: 'inventaire baies racks glpi parc garantie numero de serie responsable modele constructeur rack unite u puissance implantation',
      body: (
        <>
          <List
            items={[
              <>
                <b>Choisir un modèle</b> : le catalogue constructeurs (Dell, HPE, Cisco, Juniper,
                Fortinet, Palo Alto, Nutanix, Aruba, Ubiquiti, Synology…) renseigne d'un clic la
                hauteur en U et la puissance.
              </>,
              <>
                <b>Implanter</b> : dans le module Baies, glissez un équipement à l'emplacement
                voulu. Les chevauchements et les débordements sont refusés.
              </>,
              <>
                <b>Suivre</b> : garantie, responsable, statut (en service, en panne, en
                maintenance, en stock) et consommation totale par baie.
              </>,
              <>
                À la voix : « implante SRV-APP-01 dans la baie A1 », « combien de U libres dans
                la baie A1 ? », « retire PDU-B de la baie ».
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('inventory')}>Inventaire</Btn>
            <Btn onClick={() => openIn('racks')}>Baies</Btn>
          </div>
        </>
      ),
    },
    {
      id: 'catalogue',
      title: 'Tenir le catalogue à jour',
      keywords: 'catalogue mise a jour paquets packs icones types nouvelles technologies extension constructeurs',
      body: (
        <>
          <P>
            Les types d'équipements ne sont pas figés dans le code : ils viennent de paquets que
            l'on ajoute sans recompiler l'application.
          </P>
          <List
            items={[
              <>
                <b>Depuis l'application</b> : le panneau <i>Catalogue</i> accepte un paquet JSON
                collé ou déposé, et le conserve dans le navigateur.
              </>,
              <>
                <b>Par fichier</b> : déposez un paquet dans <code>public/catalog/</code> et
                référencez-le dans <code>public/catalog/index.json</code>.
              </>,
              <>
                <b>Depuis une source distante</b> : indiquez une URL, l'application ira y chercher
                les paquets au démarrage.
              </>,
              <>
                Un paquet décrit des types (identifiant, libellé, famille, icône, couleur,
                synonymes) et, si besoin, des modèles constructeurs.
              </>,
            ]}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => openIn('diagram', () => setPanel('catalog'))}>
              Ouvrir le catalogue
            </Btn>
          </div>
        </>
      ),
    },
    {
      id: 'raccourcis',
      title: 'Raccourcis clavier',
      keywords: 'raccourcis clavier touches souris zoom molette ctrl suppr echap',
      body: (
        <>
          <Shortcuts
            rows={[
              ['Ctrl + K', 'Recherche universelle : équipements, types, actions'],
              ['Ctrl + I', 'Import rapide (texte, liste de liaisons)'],
              ['Ctrl + Z', 'Annuler'],
              ['Ctrl + Maj + Z', 'Rétablir'],
              ['Ctrl + D', 'Dupliquer la sélection'],
              ['Ctrl + Maj + D', 'Dupliquer en série (plusieurs copies renommées)'],
              ['Alt + glisser', 'Emporter une copie, laisser l’original en place'],
              ['Ctrl + C / X / V', 'Copier, couper, coller — d’une page ou d’un document à l’autre'],
              ['L', 'Mode liaison : cliquer les deux extrémités'],
              ['N', 'Poser une note sur le plan'],
              ['Ctrl + A', 'Tout sélectionner'],
              ['Flèches', 'Déplacer la sélection (Alt : au pixel, Maj : cinq pas)'],
              ['Maj + glisser', 'Sélection au lasso sur le fond du plan'],
              ['Ctrl + Maj + F', 'Mettre la sélection au premier plan'],
              ['Ctrl + Maj + B', 'Mettre la sélection à l’arrière-plan'],
              ['] / [', 'Avancer / reculer la sélection d’un cran'],
              ['Suppr', 'Supprimer la sélection'],
              ['Échap', 'Quitter le mode courant, fermer les fenêtres'],
            ]}
          />
          <P>
            À la souris : molette pour zoomer, glisser le fond pour déplacer la vue, glisser dans
            le vide pour un rectangle de sélection, double-clic sur un cadre de groupe pour le
            replier, et sur une liaison sélectionnée : glisser le trait pour poser un point de
            passage, glisser un carré vert pour choisir où elle se branche.
          </P>
        </>
      ),
    },
    {
      id: 'depannage',
      title: 'Dépannage',
      keywords: 'depannage probleme panne micro erreur schema perdu sauvegarde firefox https localhost stockage',
      body: (
        <>
          <List
            items={[
              <>
                <b>Le micro ne démarre pas</b> : la dictée demande Chrome ou Edge, une page servie
                en HTTPS ou depuis <code>localhost</code>, et l'autorisation micro du navigateur
                (icône dans la barre d'adresse). Sans micro, les commandes tapées font tout.
              </>,
              <>
                <b>La dictée comprend mal</b> : parlez d'une traite, épelez les sigles, vérifiez
                que la langue du navigateur est le français. Le panneau propose les commandes
                proches quand il hésite.
              </>,
              <>
                <b>Un schéma disparu</b> : il vit dans le stockage local du navigateur — une
                navigation privée, un nettoyage des données de site ou un autre navigateur ne le
                verra pas. Exportez le JSON pour le mettre à l'abri.
              </>,
              <>
                <b>Un export tronqué</b> : l'export reprend ce qui est affiché. Repassez en détail
                complet et dépliez les groupes si vous voulez tout voir.
              </>,
              <>
                <b>Un import draw.io pauvre</b> : les formes sans libellé explicite tombent en
                équipement générique ; renommez-les côté draw.io ou corrigez le type après
                l'import (« change SW-01 en switch cœur »).
              </>,
            ]}
          />
        </>
      ),
    },
  ]

  // Recherche sans accents : « decouverte » doit trouver « Découverte ».
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const needle = fold(query.trim())
  const visible = needle
    ? sections.filter((section) => fold(`${section.title} ${section.keywords ?? ''}`).includes(needle))
    : sections

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-slate-50">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white p-3 lg:flex">
        <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Guide
        </p>
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#guide-${section.id}`}
            className="rounded-lg px-2 py-1.5 text-[13px] text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            {section.title}
          </a>
        ))}
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-[20px] font-semibold text-slate-900">
              Guide d'utilisation de NetSchema
            </h1>
            <p className="text-[13px] leading-relaxed text-slate-600">
              Comment dessiner, documenter et contrôler une infrastructure : les gestes, les
              commandes vocales, les imports et les points de vigilance.
            </p>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher dans le guide (voix, baies, export, OSI…)"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </header>

          {visible.length === 0 && (
            <p className="rounded-lg bg-white px-3 py-2 text-[13px] text-slate-500 ring-1 ring-slate-200">
              Aucune section ne correspond à « {query} ».
            </p>
          )}

          {visible.map((section) => (
            <section
              key={section.id}
              id={`guide-${section.id}`}
              className="flex scroll-mt-4 flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
            >
              <h2 className="text-[15px] font-semibold text-slate-900">{section.title}</h2>
              {section.body}
            </section>
          ))}

          <p className="pb-6 text-[12px] text-slate-400">
            Une question sans réponse ici ? Le fichier <code>README.md</code> du dépôt détaille
            l'installation, le collecteur réseau et le format des paquets de catalogue.
          </p>
        </div>
      </div>
    </div>
  )
}
