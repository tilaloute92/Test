import { deviceMeta, LINKS } from './catalog'
import { LAYER_LABELS_OSI, linkEnd, linkLayers } from './osi'
import type { Diagram, NetLink, NetNode, ViewMode } from '../types'

/**
 * Export « page interactive » : un seul fichier HTML qui contient les trois vues du schéma,
 * toutes les informations saisies, et de quoi naviguer dedans.
 *
 * Un SVG ne sait pas faire cela : la plupart des visionneuses en ignorent le script, et une
 * image ne porte ni onglet, ni case à cocher, ni fiche d'équipement. Une page HTML autonome,
 * elle, s'ouvre d'un double-clic sur n'importe quel poste, se transmet par courriel comme un
 * document, et n'a besoin ni de serveur, ni d'Internet, ni de NetSchema.
 *
 * Le rendu des trois vues est celui de l'application — ce sont ses propres SVG, capturés tels
 * quels. Ce fichier n'ajoute que la coquille : navigation, options d'affichage, tableaux.
 */

export interface VueExportee {
  id: ViewMode
  label: string
  hint: string
  /** SVG produit par l'application pour ce mode. */
  svg: string
}

interface LigneEquipement {
  id: string
  nom: string
  type: string
  modele: string
  ip: string
  vlan: string
  serie: string
  site: string
  zone: string
  grappe: string
  baie: string
  role: string
  note: string
}

interface LigneLiaison {
  id: string
  de: string
  vers: string
  type: string
  couches: string
  debit: string
  libelle: string
  sousReseau: string
  vrf: string
  routage: string
  mtu: string
  secours: string
  boutA: string
  boutB: string
}

function texte(valeur: unknown): string {
  return valeur === undefined || valeur === null ? '' : String(valeur).trim()
}

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Résumé d'un bout de liaison : port, mode, VLAN, agrégat, rôle STP, adresse. */
function resumeBout(link: NetLink, bout: 'a' | 'b'): string {
  const config = linkEnd(link, bout)
  const morceaux = [
    config.port,
    config.mode === 'trunk' ? 'trunk' : config.mode === 'access' ? 'accès' : '',
    config.vlans ? `VLAN ${config.vlans}` : '',
    config.nativeVlan ? `natif ${config.nativeVlan}` : '',
    config.lag ? `agrégat ${config.lag}` : '',
    config.stp ? `STP ${config.stp}` : '',
    config.ip,
  ]
  return morceaux.filter((part) => texte(part) !== '').join(' · ')
}

function lignesEquipements(diagram: Diagram): LigneEquipement[] {
  return diagram.nodes.map((node: NetNode) => ({
    id: node.id,
    nom: texte(node.name),
    type: deviceMeta(node.kind).label,
    modele: texte(node.model),
    ip: texte(node.ip),
    vlan: texte(node.vlan),
    serie: texte(node.serial),
    site: texte(node.site),
    zone: texte(node.zone),
    grappe: texte(node.cluster) + (texte(node.vip) ? ` (VIP ${texte(node.vip)})` : ''),
    baie: texte(node.rack) + (texte(node.rackUnit) ? ` U${texte(node.rackUnit)}` : ''),
    role: texte(node.role) === 'standalone' ? '' : texte(node.role),
    note: texte(node.notes),
  }))
}

function lignesLiaisons(diagram: Diagram): LigneLiaison[] {
  const noms = new Map(diagram.nodes.map((node) => [node.id, texte(node.name)]))
  return diagram.links.map((link) => ({
    id: link.id,
    de: noms.get(link.from) ?? '—',
    vers: noms.get(link.to) ?? '—',
    type: LINKS[link.kind].label,
    couches: linkLayers(link)
      .map((layer) => LAYER_LABELS_OSI[layer])
      .join(', '),
    debit: texte(link.speed),
    libelle: texte(link.label),
    sousReseau: texte(link.subnet),
    vrf: texte(link.vrf),
    routage: texte(link.routing),
    mtu: texte(link.mtu),
    secours: link.redundant ? 'oui' : '',
    boutA: resumeBout(link, 'a'),
    boutB: resumeBout(link, 'b'),
  }))
}

/** Le SVG arrive avec sa déclaration XML : inutile une fois inséré dans une page HTML. */
function svgPropre(markup: string): string {
  return markup.replace(/^<\?xml[^>]*\?>\s*/, '')
}

const STYLE = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 'Segoe UI',Inter,system-ui,-apple-system,sans-serif;color:#0f172a;background:#f1f5f9}
header{background:#0f172a;color:#fff;padding:14px 20px;display:flex;flex-wrap:wrap;gap:16px;align-items:center}
header h1{margin:0;font-size:16px;font-weight:600}
header .meta{color:#94a3b8;font-size:12px}
header .grandit{flex:1}
nav.onglets{display:flex;gap:6px;background:#e2e8f0;padding:6px 20px;border-bottom:1px solid #cbd5e1;flex-wrap:wrap;align-items:center}
button{font:inherit;cursor:pointer}
.onglet{border:1px solid transparent;background:transparent;border-radius:8px;padding:6px 14px;font-size:13px;color:#334155}
.onglet:hover{background:#f8fafc}
.onglet.actif{background:#fff;border-color:#cbd5e1;font-weight:600;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,.08)}
main{display:flex;min-height:calc(100vh - 116px)}
aside{width:290px;flex:none;background:#fff;border-right:1px solid #e2e8f0;padding:16px;overflow:auto}
aside h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:18px 0 8px}
aside h2:first-child{margin-top:0}
aside label{display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:13px;cursor:pointer}
aside input[type=checkbox]{margin-top:3px;accent-color:#2563eb}
.aide{font-size:12px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:12px}
.recherche{width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
section.plan{flex:1;position:relative;overflow:hidden;background:#fff}
#scene{position:absolute;inset:0;overflow:hidden;cursor:grab}
#scene.attrape{cursor:grabbing}
#scene svg{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none}
.vue{display:none}
.vue.actif{display:block}
.commandes{position:absolute;right:16px;bottom:16px;display:flex;gap:6px;z-index:5}
.commandes button{width:36px;height:36px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;font-size:16px;line-height:1}
.commandes button.large{width:auto;padding:0 12px;font-size:13px}
.legende{font-size:12.5px}
.legende div{display:flex;gap:8px;align-items:center;padding:2px 0}
.legende i{width:20px;height:0;border-top-width:3px;border-top-style:solid;display:inline-block;flex:none}
.fiche{position:absolute;right:16px;top:16px;width:300px;background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.14);padding:14px;z-index:6;display:none;max-height:calc(100% - 90px);overflow:auto}
.fiche.visible{display:block}
.fiche h3{margin:0 0 2px;font-size:14px}
.fiche .type{color:#64748b;font-size:12px;margin-bottom:10px}
.fiche dl{display:grid;grid-template-columns:96px 1fr;gap:4px 10px;margin:0;font-size:12.5px}
.fiche dt{color:#64748b}
.fiche dd{margin:0;word-break:break-word}
.fiche .fermer{position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:18px;color:#94a3b8}
#bulle{position:fixed;z-index:20;pointer-events:none;background:#0f172a;color:#fff;border-radius:10px;padding:9px 12px;font-size:12px;max-width:330px;display:none;box-shadow:0 10px 24px rgba(15,23,42,.3)}
#bulle b{display:block;margin-bottom:4px}
#bulle span{display:block;color:#cbd5e1}
.tableau{padding:18px 20px;overflow:auto;flex:1;background:#fff}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{border-bottom:1px solid #e2e8f0;padding:6px 10px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
tr:hover td{background:#f8fafc}
.masque [data-couche=etiquette]{display:none}
.masque-bouts [data-couche=bout]{display:none}
.masque-details [data-couche=details]{display:none}
.masque-groupes [data-couche=groupe]{display:none}
.masque-bandes [data-couche=bande]{display:none}
[data-noeud].estompe,[data-liaison].estompe{opacity:.12}
footer{padding:10px 20px;font-size:11.5px;color:#64748b;background:#e2e8f0;border-top:1px solid #cbd5e1}
@media print{
  header,nav.onglets,aside,.commandes,footer,.fiche{display:none!important}
  main{display:block}
  section.plan{overflow:visible;height:auto}
  #scene{position:static;overflow:visible}
  #scene svg{position:static;transform:none!important;max-width:100%;height:auto}
}
`

/** Script de la page exportée : sans dépendance, sans réseau, sans template literal. */
const SCRIPT = `
(function () {
  var donnees = JSON.parse(document.getElementById('donnees').textContent);
  var scene = document.getElementById('scene');
  var bulle = document.getElementById('bulle');
  var fiche = document.getElementById('fiche');
  var vues = {};
  var vueActive = donnees.vues[0].id;
  var etat = {};

  donnees.vues.forEach(function (vue) {
    var element = document.getElementById('vue-' + vue.id);
    vues[vue.id] = element;
    etat[vue.id] = { echelle: 1, x: 0, y: 0, ajuste: false };
  });

  function svgDe(id) { return vues[id].querySelector('svg'); }

  function appliquer(id) {
    var e = etat[id];
    var svg = svgDe(id);
    if (svg) svg.style.transform = 'translate(' + e.x + 'px,' + e.y + 'px) scale(' + e.echelle + ')';
  }

  function ajuster(id) {
    var svg = svgDe(id);
    if (!svg) return;
    var largeur = parseFloat(svg.getAttribute('width')) || 1200;
    var hauteur = parseFloat(svg.getAttribute('height')) || 800;
    var zone = scene.getBoundingClientRect();
    var facteur = Math.min((zone.width - 40) / largeur, (zone.height - 40) / hauteur);
    if (!isFinite(facteur) || facteur <= 0) facteur = 1;
    etat[id].echelle = facteur;
    etat[id].x = (zone.width - largeur * facteur) / 2;
    etat[id].y = (zone.height - hauteur * facteur) / 2;
    etat[id].ajuste = true;
    appliquer(id);
  }

  function montrerVue(id) {
    vueActive = id;
    donnees.vues.forEach(function (vue) {
      vues[vue.id].classList.toggle('actif', vue.id === id);
      var bouton = document.getElementById('onglet-' + vue.id);
      if (bouton) bouton.classList.toggle('actif', vue.id === id);
    });
    var aide = document.getElementById('aide-vue');
    donnees.vues.forEach(function (vue) { if (vue.id === id) aide.textContent = vue.hint; });
    if (!etat[id].ajuste) ajuster(id); else appliquer(id);
    filtrer();
  }

  // ── Onglets principaux (schéma, tableaux) ──────────────────────────────────
  function montrerPage(nom) {
    ['plan', 'equipements', 'liaisons'].forEach(function (page) {
      document.getElementById('page-' + page).style.display = page === nom ? (page === 'plan' ? 'flex' : 'block') : 'none';
      var bouton = document.getElementById('page-onglet-' + page);
      if (bouton) bouton.classList.toggle('actif', page === nom);
    });
    document.getElementById('colonne-options').style.display = nom === 'plan' ? 'block' : 'none';
    if (nom === 'plan') { ajuster(vueActive); }
  }

  // ── Options d'affichage ────────────────────────────────────────────────────
  var bascules = [
    ['opt-etiquettes', 'masque'],
    ['opt-bouts', 'masque-bouts'],
    ['opt-details', 'masque-details'],
    ['opt-groupes', 'masque-groupes'],
    ['opt-bandes', 'masque-bandes']
  ];
  bascules.forEach(function (paire) {
    var case_ = document.getElementById(paire[0]);
    if (!case_) return;
    case_.addEventListener('change', function () {
      document.getElementById('page-plan').classList.toggle(paire[1], !case_.checked);
    });
  });

  // ── Zoom et déplacement ────────────────────────────────────────────────────
  scene.addEventListener('wheel', function (event) {
    event.preventDefault();
    var e = etat[vueActive];
    var zone = scene.getBoundingClientRect();
    var sx = event.clientX - zone.left, sy = event.clientY - zone.top;
    var facteur = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    var prochaine = Math.min(6, Math.max(0.08, e.echelle * facteur));
    var rapport = prochaine / e.echelle;
    e.x = sx - (sx - e.x) * rapport;
    e.y = sy - (sy - e.y) * rapport;
    e.echelle = prochaine;
    appliquer(vueActive);
  }, { passive: false });

  var glisse = null;
  scene.addEventListener('pointerdown', function (event) {
    if (event.target.closest('[data-noeud]')) return;
    glisse = { x: event.clientX, y: event.clientY, ox: etat[vueActive].x, oy: etat[vueActive].y };
    scene.classList.add('attrape');
    scene.setPointerCapture(event.pointerId);
  });
  scene.addEventListener('pointermove', function (event) {
    if (!glisse) return;
    etat[vueActive].x = glisse.ox + (event.clientX - glisse.x);
    etat[vueActive].y = glisse.oy + (event.clientY - glisse.y);
    appliquer(vueActive);
  });
  function relacher() { glisse = null; scene.classList.remove('attrape'); }
  scene.addEventListener('pointerup', relacher);
  scene.addEventListener('pointercancel', relacher);

  document.getElementById('zoom-plus').addEventListener('click', function () {
    etat[vueActive].echelle = Math.min(6, etat[vueActive].echelle * 1.2); appliquer(vueActive);
  });
  document.getElementById('zoom-moins').addEventListener('click', function () {
    etat[vueActive].echelle = Math.max(0.08, etat[vueActive].echelle / 1.2); appliquer(vueActive);
  });
  document.getElementById('zoom-ajuste').addEventListener('click', function () { ajuster(vueActive); });

  // ── Fiche d'un équipement ──────────────────────────────────────────────────
  var parNom = {};
  donnees.equipements.forEach(function (ligne) { parNom[ligne.id] = ligne; });

  function ouvrirFiche(id) {
    var ligne = parNom[id];
    if (!ligne) return;
    var champs = [
      ['Type', ligne.type], ['Modèle', ligne.modele], ['Adresse IP', ligne.ip], ['VLAN', ligne.vlan],
      ['N° de série', ligne.serie], ['Site', ligne.site], ['Zone', ligne.zone], ['Grappe', ligne.grappe],
      ['Baie', ligne.baie], ['Rôle HA', ligne.role], ['Note', ligne.note]
    ];
    var liaisons = donnees.liaisons.filter(function (l) { return l.de === ligne.nom || l.vers === ligne.nom; });
    var html = '<button class="fermer" id="fermer-fiche">&times;</button><h3></h3><div class="type"></div><dl>';
    champs.forEach(function (champ) {
      if (!champ[1]) return;
      html += '<dt>' + champ[0] + '</dt><dd>' + echapper(champ[1]) + '</dd>';
    });
    html += '</dl>';
    if (liaisons.length) {
      html += '<h3 style="margin-top:14px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Liaisons (' + liaisons.length + ')</h3><dl>';
      liaisons.forEach(function (l) {
        var autre = l.de === ligne.nom ? l.vers : l.de;
        var detail = [l.type, l.debit, l.libelle].filter(Boolean).join(' · ');
        html += '<dt>' + echapper(autre) + '</dt><dd>' + echapper(detail) + '</dd>';
      });
      html += '</dl>';
    }
    fiche.innerHTML = html;
    fiche.querySelector('h3').textContent = ligne.nom;
    fiche.querySelector('.type').textContent = ligne.type;
    fiche.classList.add('visible');
    document.getElementById('fermer-fiche').addEventListener('click', function () { fiche.classList.remove('visible'); });
  }

  function echapper(valeur) {
    return String(valeur).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  scene.addEventListener('click', function (event) {
    var cible = event.target.closest('[data-noeud]');
    if (cible) ouvrirFiche(cible.getAttribute('data-noeud'));
  });

  // ── Info-bulle des liaisons ────────────────────────────────────────────────
  var parLiaison = {};
  donnees.liaisons.forEach(function (l) { parLiaison[l.id] = l; });

  scene.addEventListener('mousemove', function (event) {
    var cible = event.target.closest('[data-liaison]');
    if (!cible) { bulle.style.display = 'none'; return; }
    var l = parLiaison[cible.getAttribute('data-liaison')];
    if (!l) { bulle.style.display = 'none'; return; }
    var lignes = [
      ['Type', l.type], ['Couches', l.couches], ['Débit', l.debit], ['Libellé', l.libelle],
      ['Sous-réseau', l.sousReseau], ['VRF', l.vrf], ['Routage', l.routage], ['MTU', l.mtu],
      ['Secours', l.secours], [l.de, l.boutA], [l.vers, l.boutB]
    ];
    var html = '<b>' + echapper(l.de) + ' → ' + echapper(l.vers) + '</b>';
    lignes.forEach(function (ligne) {
      if (!ligne[1]) return;
      html += '<span>' + echapper(ligne[0]) + ' : ' + echapper(ligne[1]) + '</span>';
    });
    bulle.innerHTML = html;
    bulle.style.display = 'block';
    var largeur = bulle.offsetWidth;
    bulle.style.left = Math.min(event.clientX + 16, window.innerWidth - largeur - 12) + 'px';
    bulle.style.top = Math.min(event.clientY + 16, window.innerHeight - bulle.offsetHeight - 12) + 'px';
  });
  scene.addEventListener('mouseleave', function () { bulle.style.display = 'none'; });

  // ── Recherche ──────────────────────────────────────────────────────────────
  var champ = document.getElementById('recherche');
  function filtrer() {
    var terme = champ.value.trim().toLowerCase();
    var svg = svgDe(vueActive);
    if (!svg) return;
    var gardes = {};
    donnees.equipements.forEach(function (ligne) {
      var texte = [ligne.nom, ligne.type, ligne.ip, ligne.site, ligne.zone, ligne.grappe, ligne.modele]
        .join(' ').toLowerCase();
      gardes[ligne.id] = !terme || texte.indexOf(terme) >= 0;
    });
    svg.querySelectorAll('[data-noeud]').forEach(function (element) {
      element.classList.toggle('estompe', !gardes[element.getAttribute('data-noeud')]);
    });
    svg.querySelectorAll('[data-liaison]').forEach(function (element) {
      var l = parLiaison[element.getAttribute('data-liaison')];
      var visible = !terme || (l && [l.de, l.vers, l.type, l.libelle, l.debit, l.sousReseau]
        .join(' ').toLowerCase().indexOf(terme) >= 0);
      element.classList.toggle('estompe', !visible);
    });
  }
  champ.addEventListener('input', filtrer);

  // ── Raccordements ──────────────────────────────────────────────────────────
  donnees.vues.forEach(function (vue) {
    document.getElementById('onglet-' + vue.id).addEventListener('click', function () { montrerVue(vue.id); });
  });
  ['plan', 'equipements', 'liaisons'].forEach(function (page) {
    var bouton = document.getElementById('page-onglet-' + page);
    if (bouton) bouton.addEventListener('click', function () { montrerPage(page); });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { fiche.classList.remove('visible'); bulle.style.display = 'none'; }
  });
  window.addEventListener('resize', function () { ajuster(vueActive); });

  montrerPage('plan');
  montrerVue(vueActive);
})();
`

function tableau(entetes: string[], lignes: string[][]): string {
  const tete = entetes.map((titre) => `<th>${echapper(titre)}</th>`).join('')
  const corps = lignes
    .map((ligne) => `<tr>${ligne.map((valeur) => `<td>${echapper(valeur)}</td>`).join('')}</tr>`)
    .join('\n')
  return `<table><thead><tr>${tete}</tr></thead><tbody>\n${corps}\n</tbody></table>`
}

/** Types de liaisons réellement présents : une légende ne liste pas ce qui n'existe pas. */
function legende(diagram: Diagram): string {
  const kinds = Array.from(new Set(diagram.links.map((link) => link.kind)))
  if (kinds.length === 0) return ''
  const lignes = kinds
    .map((kind) => {
      const meta = LINKS[kind]
      const trait = `border-top-color:${meta.color};${meta.dash ? 'border-top-style:dashed;' : ''}`
      return `<div><i style="${trait}"></i>${echapper(meta.label)}</div>`
    })
    .join('')
  return `<h2>Types de liaisons</h2><div class="legende">${lignes}</div>`
}

export function pageInteractive(diagram: Diagram, vues: VueExportee[]): string {
  const equipements = lignesEquipements(diagram)
  const liaisons = lignesLiaisons(diagram)
  const donnees = {
    titre: diagram.title,
    vues: vues.map((vue) => ({ id: vue.id, label: vue.label, hint: vue.hint })),
    equipements,
    liaisons,
  }
  // `</script>` à l'intérieur d'une chaîne fermerait la balise : on coupe la séquence.
  const json = JSON.stringify(donnees).replace(/<\//g, '<\\/')
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const ongletsVues = vues
    .map(
      (vue) =>
        `<button class="onglet" id="onglet-${vue.id}" type="button">${echapper(vue.label)}</button>`,
    )
    .join('')

  const svgVues = vues
    .map((vue) => `<div class="vue" id="vue-${vue.id}">${svgPropre(vue.svg)}</div>`)
    .join('\n')

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapper(diagram.title)} — schéma réseau</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>${echapper(diagram.title)}</h1>
  <span class="meta">${equipements.length} équipement(s) · ${liaisons.length} liaison(s) · ${echapper(date)}</span>
  <span class="grandit"></span>
  <button class="onglet actif" id="page-onglet-plan" type="button">Schéma</button>
  <button class="onglet" id="page-onglet-equipements" type="button">Équipements</button>
  <button class="onglet" id="page-onglet-liaisons" type="button">Liaisons</button>
</header>

<nav class="onglets">${ongletsVues}</nav>

<main>
  <aside id="colonne-options">
    <div class="aide" id="aide-vue"></div>
    <h2>Rechercher</h2>
    <input class="recherche" id="recherche" type="search" placeholder="Nom, adresse, site…" autocomplete="off">
    <h2>Afficher</h2>
    <label><input type="checkbox" id="opt-etiquettes" checked> Étiquettes des liaisons</label>
    <label><input type="checkbox" id="opt-bouts" checked> Ports et adresses aux extrémités</label>
    <label><input type="checkbox" id="opt-details" checked> Détails des équipements</label>
    <label><input type="checkbox" id="opt-groupes" checked> Cadres des sites, zones et grappes</label>
    <label><input type="checkbox" id="opt-bandes" checked> Noms des couches</label>
    <h2>Navigation</h2>
    <div class="aide">
      Molette pour zoomer, glisser pour déplacer. Clic sur un équipement : sa fiche.
      Survol d'une liaison : son détail. <b>Échap</b> referme.
    </div>
    ${legende(diagram)}
  </aside>

  <section class="plan" id="page-plan">
    <div id="scene">
${svgVues}
    </div>
    <div class="fiche" id="fiche"></div>
    <div class="commandes">
      <button id="zoom-moins" type="button" title="Dézoomer">−</button>
      <button id="zoom-plus" type="button" title="Zoomer">+</button>
      <button id="zoom-ajuste" class="large" type="button" title="Cadrer le schéma">Ajuster</button>
    </div>
  </section>

  <div class="tableau" id="page-equipements" style="display:none">
    ${tableau(
      ['Nom', 'Type', 'Modèle', 'Adresse IP', 'VLAN', 'N° de série', 'Site', 'Zone', 'Grappe', 'Baie', 'Rôle'],
      equipements.map((ligne) => [
        ligne.nom,
        ligne.type,
        ligne.modele,
        ligne.ip,
        ligne.vlan,
        ligne.serie,
        ligne.site,
        ligne.zone,
        ligne.grappe,
        ligne.baie,
        ligne.role,
      ]),
    )}
  </div>

  <div class="tableau" id="page-liaisons" style="display:none">
    ${tableau(
      ['De', 'Vers', 'Type', 'Couches', 'Débit', 'Libellé', 'Sous-réseau', 'VRF', 'Routage', 'MTU', 'Côté départ', 'Côté arrivée'],
      liaisons.map((ligne) => [
        ligne.de,
        ligne.vers,
        ligne.type,
        ligne.couches,
        ligne.debit,
        ligne.libelle,
        ligne.sousReseau,
        ligne.vrf,
        ligne.routage,
        ligne.mtu,
        ligne.boutA,
        ligne.boutB,
      ]),
    )}
  </div>
</main>

<div id="bulle"></div>
<footer>Page autonome produite par NetSchema — aucune connexion requise. Les trois vues et toutes les informations du schéma sont dans ce seul fichier.</footer>

<script type="application/json" id="donnees">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}
