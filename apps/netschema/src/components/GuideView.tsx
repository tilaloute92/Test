import { useState, type ReactNode } from 'react'
import { Btn } from './ui'
import { VOICE_EXAMPLE_GROUPS } from '../lib/voice'
import { useDiagram } from '../store/useDiagram'

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
  const loadSample = useDiagram((s) => s.loadSample)
  const run = useDiagram((s) => s.runVoiceCommand)
  const notify = useDiagram((s) => s.notify)

  const [query, setQuery] = useState('')
  /** Dernière commande d'exemple lancée depuis le guide, avec la réponse obtenue. */
  const [tried, setTried] = useState<{ command: string; message: string; ok: boolean } | null>(null)

  const openIn = (view: 'diagram' | 'inventory' | 'racks' | 'discovery', after?: () => void) => {
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
      id: 'modules',
      title: 'Les quatre modules',
      keywords: 'onglets vues modules inventaire baies racks decouverte navigation',
      body: (
        <>
          <P>
            Les quatre onglets travaillent sur le <b>même</b> jeu de données : un serveur créé
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
                view: 'discovery' as const,
                title: 'Découverte',
                text: 'Relevés réseau (LLDP, CDP, ARP, nmap, CSV) transformés en cartographie, à fusionner avec le schéma.',
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
      title: 'Trois modes de visualisation',
      keywords:
        'mode vue architecture technique presentation affichage projection lecture densite rendu',
      body: (
        <>
          <P>
            Le même schéma se regarde de trois façons, sans jamais toucher au modèle. Le
            sélecteur est dans la barre d'outils (et dans <i>Mise en page</i>) ; chaque mode
            règle d'un coup ce qui s'affiche et comment c'est dessiné.
          </P>
          <div className="grid gap-2 sm:grid-cols-3">
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
            L'export <b>HTML</b> embarque les trois vues dans un seul fichier : on passe de
            l'une à l'autre sans NetSchema, chez le destinataire.
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
            ses trois vues.
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
                document</b>, chacune dans <b>ses trois vues</b>,
                toutes les informations saisies et de quoi s'y déplacer. Un seul fichier, qui
                s'ouvre d'un double-clic sur n'importe quel poste : ni serveur, ni Internet, ni
                NetSchema.
              </>,
            ]}
          />
          <P>Dans la page exportée, le destinataire retrouve :</P>
          <List
            items={[
              <>les <b>trois vues</b> en onglets — architecture, technique, présentation ;</>,
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
                deux carrés verts — ses extrémités — à l'endroit voulu sur la boîte d'un
                équipement. Le point d'accroche est libre tout autour de la boîte, suit
                l'équipement quand on le déplace, et la liaison sort perpendiculairement avant
                de repartir. Double-clic sur un carré : retour à l'accroche calculée.
              </>,
              <>
                <b>Rebrancher ailleurs</b> : lâchez cette même extrémité sur un <i>autre</i>
                équipement et la liaison change de destination, sans avoir à la supprimer.
              </>,
              <>
                <b>À la création</b> : en mode <Keys>L</Keys>, un clic près d'un bord fixe
                l'accroche de ce côté ; un clic au centre laisse l'application choisir.
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
      id: 'ha',
      title: 'Haute disponibilité',
      keywords: 'haute disponibilite ha redondance spof panne cluster grappe vip actif passif temoin score audit onduleur alimentation',
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
              ['L', 'Mode liaison : cliquer les deux extrémités'],
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
