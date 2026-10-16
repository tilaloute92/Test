/**
 * Rendu du rapport de réunion : le document complet (pièce jointe) et le message lui-même.
 *
 * Le navigateur envoie des libellés déjà calculés (voir src/lib/reunionPayload.ts) ; ce
 * fichier ne fait que de la mise en page et l'échappement. Aucune décision métier ici :
 * si un chiffre est faux, c'est le calcul côté application qu'il faut corriger, et pas
 * deux endroits.
 *
 * Tout est en styles en ligne, sans feuille de style ni classe : c'est la seule chose
 * qu'un client de messagerie rend de façon prévisible. Les tableaux servent de grille
 * pour la même raison — Outlook ignore flex et grid.
 */

const ENCRE = '#0f172a';
const ENCRE2 = '#475569';
const ENCRE3 = '#94a3b8';
const TRAIT = '#e2e8f0';
const POLICE = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

export function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** Les champs libres venus du navigateur ne doivent pas pouvoir dépasser : un mot
 *  d'accompagnement de 40 ko ferait un message illisible et un relais fâché. */
function tronque(texte, max) {
  const t = String(texte ?? '');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function pastille(couleur, texte) {
  return `<span style="display:inline-block;font-size:11px;font-weight:600;color:#fff;background:${e(
    couleur
  )};border-radius:4px;padding:1px 6px;white-space:nowrap">${e(texte)}</span>`;
}

function carre(couleur, taille = 9) {
  if (!couleur) {
    return `<span style="display:inline-block;width:${taille}px;height:${taille}px;border-radius:2px;border:1px dashed #cbd5e1;box-sizing:border-box"></span>`;
  }
  return `<span style="display:inline-block;width:${taille}px;height:${taille}px;border-radius:2px;background:${e(couleur)}"></span>`;
}

function barre(pourcent, couleur, largeur = 110) {
  const p = Math.max(0, Math.min(100, Number(pourcent) || 0));
  return `<span style="display:inline-block;width:${largeur}px;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden;vertical-align:middle"
    ><span style="display:block;width:${p}%;height:6px;background:${e(couleur)};border-radius:3px"></span></span>`;
}

const TH = `text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:${ENCRE3};font-weight:600;padding:0 8px 5px 0`;
const TD = `font-size:12.5px;color:${ENCRE2};padding:7px 8px 7px 0;border-top:1px solid ${TRAIT};vertical-align:top`;
const TD_FORT = `${TD};color:${ENCRE};font-weight:500`;

function section(n, titre, apres) {
  return `<div style="margin:22px 0 10px;border-bottom:2px solid ${ENCRE};padding-bottom:4px">
    <span style="font-size:11px;font-weight:700;color:#fff;background:${ENCRE};border-radius:4px;padding:1px 6px">${n}</span>
    <span style="font-size:14px;font-weight:600;margin-left:8px">${e(titre)}</span>
    ${apres ? `<span style="font-size:12px;color:${ENCRE3};font-style:italic;margin-left:8px">— ${e(apres)}</span>` : ''}
  </div>`;
}

function vide(texte) {
  return `<p style="font-size:12.5px;color:${ENCRE3};margin:4px 0 0">${e(texte)}</p>`;
}

// ============================================================ LE DOCUMENT COMPLET

/**
 * Le corps du rapport : en-tête, météo, chiffres, puis les huit sections.
 *
 * Écrit UNE fois et servi deux fois — dans le fichier joint et dans le corps du message —
 * depuis que le message reprenait une version condensée qui ne ressemblait plus à ce que
 * l'équipe voit à l'écran. Deux mises en page pour un même rapport, c'est deux vérités à
 * tenir, et celle que personne ne relit dérive en silence.
 *
 * @param mot      Mot d'introduction, propre au message : le fichier joint n'en a pas.
 * @param piedPage Dernière ligne, elle aussi différente selon le support.
 */
/**
 * Retire l'indentation du HTML produit, sans toucher au texte.
 *
 * Gmail coupe un message au-delà d'environ 102 ko et affiche « message tronqué » : le
 * rapport complet en pèse déjà 72 avec cinq personnes, et une semaine chargée s'en
 * approche. On ne supprime que les espaces qui PRÉCÈDENT une balise en début de ligne —
 * jamais ceux d'un nœud de texte, où ils séparent des mots, ni ceux du mot
 * d'introduction, qui est affiché tel qu'il a été écrit.
 */
function compacter(html) {
  return html.replace(/\n[ \t]+(?=<)/g, '\n');
}

function corpsDocument(p, { mot = '', piedPage = '' } = {}) {
  return `${enTete(p)}
  <div style="padding:20px 28px 28px">
    ${
      mot
        ? `<p style="margin:0 0 16px;font-size:13px;color:${ENCRE2};line-height:1.5;white-space:pre-wrap">${e(
            tronque(mot, 2000)
          )}</p>`
        : ''
    }
    ${meteo(p)}
    ${chiffres(p)}
    ${section(1, 'Points à aborder')}
    ${points(p)}
    ${section(2, 'Incidents')}
    ${incidents(p)}
    ${section(3, 'Projets')}
    ${projets(p)}
    ${section(4, 'Tâches en retard')}
    ${retards(p)}
    ${section(5, 'Sujets prévus sur les deux semaines', 'sous réserve')}
    ${sujets(p)}
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${ENCRE3};font-weight:600;margin:16px 0 6px">
      Qui travaille sur quoi, demi-journée par demi-journée
    </div>
    ${grille(p)}
    ${section(6, 'Absences')}
    ${absences(p)}
    ${section(7, 'Charge par personne')}
    ${charge(p)}
    ${p.fdr ? section(8, `Feuille de route ${p.fdr.annee}`) + feuilleDeRoute(p.fdr) : ''}
    <div style="margin-top:24px;border-top:1px solid ${TRAIT};padding-top:10px;font-size:10.5px;color:${ENCRE3}">
      ${piedPage || "Suivi Infra &amp; Réseau — document généré automatiquement, chiffres issus des saisies de l'équipe."}
    </div>
  </div>`;
}

export function renderDocument(p) {
  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(`Réunion d'équipe — ${p.teamLabel} — ${p.semaineLabel}`)}</title>
<style>
  /* La seule feuille de style du fichier, et elle ne sert qu'à l'impression : le reste
     est en ligne pour survivre aux clients de messagerie. */
  @page { size: A4; margin: 12mm; }
  @media print { body { background: #fff !important; } .doc { box-shadow: none !important; margin: 0 !important; } }
</style>
</head>
<body style="margin:0;padding:16px;background:#f1f5f9;font-family:${POLICE};color:${ENCRE}">
<div class="doc" style="max-width:820px;margin:0 auto;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.18)">
  ${corpsDocument(p)}
</div>
</body></html>`;
}

function enTete(p) {
  return `<div style="background:#1e1b4b;color:#fff;padding:20px 28px">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="vertical-align:top">
        <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#a5b4fc">
          Réunion d'équipe${p.dateReunion ? ` · ${e(p.dateReunion)}` : ''}
        </div>
        <div style="font-size:22px;font-weight:600;margin-top:2px">${e(p.teamLabel)}</div>
        <div style="font-size:13px;color:#c7d2fe;margin-top:4px">Semaine écoulée : ${e(p.semaineLabel)}</div>
      </td>
      <td style="vertical-align:top;text-align:right;font-size:11px;color:#a5b4fc;line-height:1.6;white-space:nowrap">
        Document généré le<br><span style="color:#fff;font-size:13px">${e(p.genereLe)}</span>
        ${p.auteur ? `<br>par ${e(p.auteur)}` : ''}
      </td>
    </tr></table>
  </div>`;
}

const COULEUR_METEO = { Ensoleillé: '#16a34a', Éclaircies: '#65a30d', Nuageux: '#f59e0b', Orageux: '#dc2626' };

/**
 * Le bloc météo, dans le document joint.
 *
 * Trois colonnes quand l'équipe a voté : la météo retenue, le dépouillement, et ce que
 * disent les chiffres. Les voix sont rendues en barres faites de tableaux et de cellules
 * de largeur fixe — aucune barre en CSS, aucun pourcentage : Outlook ignore `width:%`
 * dans un `div` imbriqué et afficherait des barres toutes égales, c'est-à-dire un
 * graphique faux, ce qui est pire que pas de graphique.
 */
function meteo(p) {
  const bord = COULEUR_METEO[p.meteo.label] || '#f59e0b';
  const v = p.meteo.vote;
  const largeurMax = 110;
  const barres = v
    ? v.repartition
        .map((r) => {
          const px = v.total > 0 ? Math.round((r.n / v.total) * largeurMax) : 0;
          return `<tr>
            <td style="font-size:13px;padding:1px 6px 1px 0">${e(r.emoji)}</td>
            <td style="padding:1px 6px 1px 0">
              <table style="border-collapse:collapse;width:${largeurMax}px"><tr>
                ${
                  // Une cellule de largeur nulle occupe quand même quelques pixels chez
                  // certains clients : à zéro voix on ne l'écrit pas du tout, sinon une
                  // barre vide se lit comme une voix.
                  px > 0
                    ? `<td style="height:10px;width:${px}px;background:${COULEUR_METEO[r.label] || '#94a3b8'};border-radius:3px;font-size:0;line-height:0">&nbsp;</td>`
                    : ''
                }
                ${px < largeurMax ? `<td style="height:10px;width:${largeurMax - px}px;background:#f1f5f9;border-radius:3px;font-size:0;line-height:0">&nbsp;</td>` : ''}
              </tr></table>
            </td>
            <td style="font-size:12px;color:${ENCRE2};padding:1px 0">${e(r.n)}</td>
          </tr>`;
        })
        .join('')
    : '';

  return `<table style="width:100%;border-collapse:collapse;border:1px solid ${TRAIT};border-left:4px solid ${bord};border-radius:8px;margin-bottom:16px">
    <tr>
      <td style="width:110px;text-align:center;padding:14px 8px;vertical-align:top">
        <div style="font-size:34px;line-height:1">${e(p.meteo.emoji)}</div>
        <div style="font-size:15px;font-weight:600;margin-top:4px">${e(p.meteo.label)}</div>
        <div style="font-size:11px;color:${ENCRE3}">${v ? `${e(v.total)} voix sur ${e(v.effectif)}` : `score ${e(p.meteo.score)} / 100`}</div>
      </td>
      ${
        v
          ? `<td style="padding:14px 16px;border-left:1px solid ${TRAIT};vertical-align:top;width:200px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${ENCRE3};margin-bottom:6px">Ce qu'a voté l'équipe</div>
        <table style="border-collapse:collapse">${barres}</table>
      </td>`
          : ''
      }
      <td style="padding:14px 16px;border-left:1px solid ${TRAIT};vertical-align:top">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${ENCRE3};margin-bottom:6px">
          ${v ? 'Ce que disent les chiffres' : 'Ce qui donne cette météo'}
        </div>
        ${
          v
            ? `<div style="font-size:13px;color:${ENCRE2};margin-bottom:4px">${e(v.calculEmoji)} ${e(v.calculLabel)} — score ${e(p.meteo.score)} / 100</div>`
            : ''
        }
        <div style="font-size:13px;color:${ENCRE2};line-height:1.6">
          ${p.meteo.facteurs.map((f) => e(f)).join('<br>')}
        </div>
        <div style="font-size:11px;color:${ENCRE3};margin-top:8px">${e(p.meteo.mention || "Calcul affiché volontairement : la météo n'est pas une humeur, elle se vérifie.")}</div>
        ${
          v && v.ecart
            ? `<div style="margin-top:6px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 8px;font-size:12px;color:#78350f">
                 Le ressenti de l'équipe et les chiffres ne disent pas la même chose. C'est un point à aborder, pas une erreur.
               </div>`
            : ''
        }
        ${
          v && v.mots.length > 0
            ? `<div style="margin-top:8px;border-top:1px solid ${TRAIT};padding-top:6px">
                 <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${ENCRE3};margin-bottom:4px">Mots laissés avec les voix — sans nom</div>
                 <div style="font-size:12.5px;color:${ENCRE2}">${v.mots.map((t) => `« ${e(t)} »`).join(' · ')}</div>
               </div>`
            : ''
        }
      </td>
    </tr>
  </table>`;
}

function chiffres(p) {
  return `<table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px 20px"><tr>
    ${p.chiffres
      .map(
        (c) => `<td style="border:1px solid ${TRAIT};border-radius:8px;padding:10px 12px;width:25%;vertical-align:top">
          <div style="font-size:20px;font-weight:600">${e(c.valeur)}</div>
          <div style="font-size:11px;color:${ENCRE2};line-height:1.35;margin-top:2px">${e(c.libelle)}</div>
          ${c.sous ? `<div style="font-size:11px;color:${ENCRE3};margin-top:2px">${e(c.sous)}</div>` : ''}
        </td>`
      )
      .join('')}
  </tr></table>`;
}

function points(p) {
  if (p.points.length === 0) return vide("Rien que les données signalent cette semaine. L'ordre du jour est à vous.");
  return `<div>${p.points
    .map(
      (pt, i) => `<table style="width:100%;border-collapse:collapse;${i === 0 ? '' : `border-top:1px solid ${TRAIT}`}">
        <tr>
          <td style="width:26px;padding:7px 0;vertical-align:top">
            <span style="display:inline-block;width:16px;height:16px;border:1.5px solid ${ENCRE3};border-radius:3px"></span>
          </td>
          <td style="padding:7px 0;font-size:12.5px;color:${ENCRE}">
            ${e(pt.texte)} <span style="color:${ENCRE3};font-size:11px">— ${e(pt.source)}</span>
          </td>
        </tr>
      </table>`
    )
    .join('')}
    <div style="font-size:11px;color:${ENCRE3};margin-top:8px">
      Liste déduite des données : incident en attente depuis plus de 5 jours, projet sans heure saisie depuis 14 jours,
      sujet daté sans créneau, semaine en sous-effectif, surcharge, échéances dépassées.
    </div>
  </div>`;
}

function incidents(p) {
  const bloc = p.incidents.length
    ? `<table style="width:100%;border-collapse:collapse">
        <tr>
          <th style="${TH};width:38%">Incident ouvert</th><th style="${TH};width:74px">Priorité</th>
          <th style="${TH};width:130px">Qui</th><th style="${TH};width:70px">Ouvert le</th><th style="${TH}">État</th>
        </tr>
        ${p.incidents
          .map(
            (i) => `<tr>
              <td style="${TD_FORT}">${e(i.titre)}</td>
              <td style="${TD}">${pastille(i.couleur, i.priorite)}</td>
              <td style="${TD}">${e(i.qui)}</td>
              <td style="${TD}">${e(i.ouvertLe)}</td>
              <td style="${TD}${i.enAttente ? ';color:#b45309' : ''}">${e(i.etat)}</td>
            </tr>`
          )
          .join('')}
      </table>`
    : vide('Aucun incident critique ou haut encore ouvert.');

  const resolus = p.resolus.length
    ? `<div style="margin-top:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px;font-size:12.5px;color:#166534">
        <strong>Résolus cette semaine (${p.resolus.length})</strong>
        <span style="color:#15803d"> — ${p.resolus.map((t) => e(t)).join(' · ')}</span>
      </div>`
    : '';

  return bloc + resolus;
}

function projets(p) {
  if (!p.projets.length) return vide('Aucune tâche rattachée à un projet.');
  return `<table style="width:100%;border-collapse:collapse">
    <tr>
      <th style="${TH};width:28%">Projet</th><th style="${TH};width:120px">Avancement</th>
      <th style="${TH};width:92px">Heures</th><th style="${TH};width:76px">Échéance</th>
      <th style="${TH}">Fait cette semaine / prochaine étape</th>
    </tr>
    ${p.projets
      .map(
        (pr) => `<tr>
          <td style="${TD_FORT}">
            ${carre(pr.couleurEtat, 7)} ${e(pr.nom)}
            <div style="font-size:11px;color:${ENCRE3};font-weight:400;margin-left:13px">${e(pr.pilotes)}</div>
          </td>
          <td style="${TD}">
            ${barre(pr.avance, '#7c3aed', 110)}
            <div style="font-size:11px;color:${ENCRE3};margin-top:3px">${e(pr.avance)} % · ${e(pr.avanceTerminees)} % terminé</div>
          </td>
          <td style="${TD}${pr.depassement ? ';color:#b91c1c;font-weight:600' : ''}">${e(pr.heures)}</td>
          <td style="${TD}">${e(pr.echeance)}</td>
          <td style="${TD}">
            ${e(pr.fait)}
            ${pr.suite ? `<div style="color:${ENCRE};margin-top:2px">→ ${e(pr.suite)}</div>` : ''}
            ${pr.alerte ? `<div style="color:#b45309;font-size:11px;margin-top:2px">⚠ ${e(pr.alerte)}</div>` : ''}
          </td>
        </tr>`
      )
      .join('')}
    <tr>
      <td colspan="5" style="font-size:10.5px;color:${ENCRE3};padding-top:6px">
        Avancement : le premier chiffre est celui déclaré par l'équipe — la moyenne des avancements saisis sur les
        tâches, pondérée par leurs heures estimées. Le second est la part du budget d'heures réellement terminée.
        L'écart entre les deux se discute ; aucun des deux ne se déduit de l'autre.
      </td>
    </tr>
  </table>`;
}

function retards(p) {
  if (!p.retards.length) return vide('Aucune — tout est dans les temps.');
  return `<table style="width:100%;border-collapse:collapse">
    <tr>
      <th style="${TH};width:44%">Tâche</th><th style="${TH};width:72px">Nature</th>
      <th style="${TH};width:140px">Qui</th><th style="${TH};width:86px">Échéance</th><th style="${TH}">Retard</th>
    </tr>
    ${p.retards
      .map(
        (t) => `<tr>
          <td style="${TD_FORT}">${e(t.titre)}${
            t.demandeur ? `<div style="font-size:11px;color:${ENCRE3};font-weight:400">demandé par ${e(t.demandeur)}</div>` : ''
          }</td>
          <td style="${TD}">${pastille(t.couleurNature, t.nature)}</td>
          <td style="${TD}">${e(t.qui)}</td>
          <td style="${TD}">${e(t.echeance)}</td>
          <td style="${TD};color:#b91c1c;font-weight:600">${e(t.retard)}</td>
        </tr>`
      )
      .join('')}
  </table>`;
}

function sujets(p) {
  const rien = p.semaines.every((s) => s.sujets.length === 0);
  if (rien) return vide("Rien de planifié ni d'échu sur les deux semaines — le planning est à remplir.");
  return `<table style="width:100%;border-collapse:collapse">
    <tr>
      <th style="${TH};width:44%">Sujet</th><th style="${TH};width:72px">Nature</th>
      <th style="${TH};width:150px">Qui</th><th style="${TH}">Quand</th>
    </tr>
    ${p.semaines
      .map(
        (s) => `<tr>
            <td colspan="4" style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${ENCRE2};background:#f8fafc;padding:4px 8px 4px 6px;border-top:1px solid ${TRAIT}">
              ${e(s.label)} — planning rempli à ${e(s.remplissage)} %
            </td>
          </tr>
          ${
            s.sujets.length === 0
              ? `<tr><td colspan="4" style="${TD};color:${ENCRE3}">Rien de planifié ni d'échu sur cette semaine.</td></tr>`
              : s.sujets
                  .map(
                    (l) => `<tr>
                      <td style="${TD_FORT}">
                        ${e(l.titre)}${l.projet ? `<span style="color:${ENCRE3};font-weight:400"> — ${e(l.projet)}</span>` : ''}
                        ${l.reserve ? `<div style="font-size:11px;font-weight:400;color:#b45309;margin-top:1px">⚠ ${e(l.reserve)}</div>` : ''}
                      </td>
                      <td style="${TD}">${pastille(l.couleurNature, l.nature)}</td>
                      <td style="${TD}">${e(l.qui)}</td>
                      <td style="${TD}">${e(l.quand)}</td>
                    </tr>`
                  )
                  .join('')
          }`
      )
      .join('')}
    <tr><td colspan="4" style="font-size:11px;color:${ENCRE3};padding-top:6px">
      Sous réserve : liste établie à partir du planning et des échéances au ${e(p.genereLe)}. Un incident la rebat en une
      demi-journée — c'est une intention, pas un engagement. Les sujets marqués ⚠ sont ceux dont on sait déjà qu'ils
      peuvent sauter.
    </td></tr>
  </table>`;
}

function grille(p) {
  const g = p.grille;
  const L = 44;
  // Largeur fixe sur chaque demi-journée, sinon le tableau répartit à sa guise et les
  // colonnes ne tombent plus sous les noms de jours. Le trait entre les deux semaines est
  // porté par la première case de la huitième journée, en-tête ET corps.
  const cellule = (c, i) =>
    `<td style="width:${L / 2}px;padding:0 1px${i === g.coupure * 2 ? `;border-left:1px solid ${TRAIT}` : ''}">
      <div style="height:17px;border-radius:2px;box-sizing:border-box;${
        c.couleur ? `background:${e(c.couleur)}` : 'background:#fff;border:1px dashed #cbd5e1'
      }" title="${e(c.libelle)}"></div></td>`;

  return `<div style="overflow-x:auto"><table style="border-collapse:collapse;min-width:${118 + g.jours.length * L}px">
    <tr>
      <td style="width:118px"></td>
      ${g.jours
        .map(
          (j, i) =>
            `<td colspan="2" style="width:${L}px;text-align:center;font-size:10px;color:${
              j.weekend ? ENCRE3 : ENCRE2
            };padding:0 2px 3px${i === g.coupure ? ';border-left:1px solid ' + TRAIT : ''}${
              j.weekend ? ';background:#f8fafc' : ''
            }">${e(j.label)}</td>`
        )
        .join('')}
    </tr>
    ${g.lignes
      .map(
        (l) => `<tr>
          <td style="width:118px;font-size:12px;color:${ENCRE};padding:1px 8px 1px 0;white-space:nowrap">${e(l.nom)}</td>
          ${l.cases.map((c, i) => cellule(c, i)).join('')}
        </tr>`
      )
      .join('')}
    <tr><td colspan="${1 + g.jours.length * 2}" style="padding-top:8px;font-size:11px;color:${ENCRE2}">
      ${g.legende.map((c) => `${carre(c.couleur, 11)} ${e(c.libelle)}`).join('&nbsp;&nbsp;&nbsp; ')}
      <span style="color:${ENCRE3}">· chaque case = une demi-journée (matin, après-midi)</span>
    </td></tr>
  </table></div>`;
}

function absences(p) {
  if (!p.absences.length) return vide('Aucune absence prévue sur les deux semaines.');
  return `<table style="width:100%;border-collapse:collapse">
    ${p.absences
      .map(
        (a) => `<tr>
          <td style="${TD_FORT};width:150px">${e(a.qui)}</td>
          <td style="${TD};width:200px">${carre(a.couleur)} ${e(a.quoi)}</td>
          <td style="${TD}">${e(a.quand)}</td>
        </tr>`
      )
      .join('')}
  </table>`;
}

function charge(p) {
  return `<table style="width:100%;border-collapse:collapse">
    <tr>
      <th style="${TH};width:170px">Personne</th><th style="${TH};width:180px">Charge planifiée</th>
      <th style="${TH};width:130px">Heures saisies</th><th style="${TH};width:110px">Terminées</th><th style="${TH}">Absences</th>
    </tr>
    ${p.charge
      .map(
        (c) => `<tr>
          <td style="${TD_FORT}">${e(c.nom)}</td>
          <td style="${TD}">
            ${barre(c.absent ? 100 : c.pourcent, c.couleur, 150)}
            <div style="font-size:11px;color:${ENCRE3};margin-top:3px">${
              c.absent ? 'Absent toute la semaine' : `${e(c.pourcent)} % — ${e(c.niveau)}`
            }</div>
          </td>
          <td style="${TD}">${e(c.saisies)}</td>
          <td style="${TD}">${e(c.terminees)}</td>
          <td style="${TD}">${e(c.absences)}</td>
        </tr>`
      )
      .join('')}
  </table>`;
}

function feuilleDeRoute(fdr) {
  return `<div>
    <div style="font-size:12.5px;color:${ENCRE2};margin-bottom:8px">${e(fdr.resume)}</div>
    ${fdr.enCours
      .map(
        (r) => `<table style="width:100%;border-collapse:collapse;border-top:1px solid ${TRAIT}"><tr>
          <td style="font-size:12.5px;color:${ENCRE};padding:5px 8px 5px 0">${e(r.titre)} <span style="color:${ENCRE3}">— ${e(r.domaine)}</span></td>
          <td style="width:110px;padding:5px 0">${barre(r.progression, '#7c3aed', 110)}</td>
          <td style="width:40px;text-align:right;font-size:12.5px;color:${ENCRE3};padding:5px 0">${e(r.progression)} %</td>
        </tr></table>`
      )
      .join('')}
    ${
      fdr.enRetard.length
        ? `<div style="margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:12px;color:#78350f">
            <strong>Pas encore démarrée(s) alors que le trimestre cible est atteint :</strong> ${fdr.enRetard
              .map((t) => e(t))
              .join(' · ')}
          </div>`
        : ''
    }
  </div>`;
}

// ================================================================= LE MESSAGE

/**
 * Le corps du message est la SYNTHÈSE, pas le document complet : il se lit sur un
 * téléphone, le dimanche soir. Le document entier part en pièce jointe pour qui veut le
 * détail et la grille.
 */
/**
 * Le corps du message.
 *
 * Exactement le même rapport que le fichier joint et que l'écran : même en-tête, mêmes
 * huit sections, mêmes couleurs. Il a longtemps été une version condensée — quatre
 * chiffres et des listes raccourcies — ce qui obligeait à ouvrir la pièce jointe pour
 * retrouver ce dont on avait parlé, et faisait deux présentations à maintenir pour un
 * seul rapport. Seuls le mot d'introduction et la dernière ligne lui restent propres.
 *
 * Largeur portée à 820 px, celle du document : la grille des quatorze demi-journées ne
 * tient pas dans 600 px, et c'est elle qui fixe la largeur minimale du rapport.
 */
export function renderMail(p) {
  const sujetsPlat = p.semaines.flatMap((s) => s.sujets.map((x) => ({ ...x, semaine: s.label })));
  const pied = `Suivi Infra &amp; Réseau — ${p.auteur ? `envoyé par ${e(p.auteur)}, ` : ''}${e(p.genereLe)}. ${
    sujetsPlat.length
  } sujet(s) prévu(s) sur les deux semaines. Le même document est joint à ce message, pour l'imprimer ou le classer.`;

  return compacter(`<!doctype html>
<html lang="fr"><body style="margin:0;padding:16px;background:#f1f5f9;font-family:${POLICE};color:${ENCRE}">
<div style="max-width:820px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
  ${corpsDocument(p, { mot: p.mot, piedPage: pied })}
</div>
</body></html>`);
}

/** Version texte, pour les clients qui refusent le HTML et pour les filtres anti-spam,
 *  qui se méfient d'un message sans alternative texte. */
export function renderText(p) {
  const l = [];
  l.push(`RÉUNION D'ÉQUIPE — ${p.teamLabel}`);
  if (p.dateReunion) l.push(p.dateReunion);
  l.push(`Semaine écoulée : ${p.semaineLabel}`);
  l.push('');
  if (p.mot) {
    l.push(tronque(p.mot, 2000));
    l.push('');
  }
  l.push(`Météo : ${p.meteo.label}`);
  if (p.meteo.mention) l.push(`  ${p.meteo.mention}`);
  if (p.meteo.vote) {
    l.push(`  Voix : ${p.meteo.vote.repartition.filter((r) => r.n > 0).map((r) => `${r.n} ${r.label.toLowerCase()}`).join(', ')}`);
    l.push(`  Chiffres : ${p.meteo.vote.calculLabel} (score ${p.meteo.score}/100)`);
    for (const t of p.meteo.vote.mots) l.push(`  « ${t} »`);
  } else {
    l.push(`  score ${p.meteo.score}/100`);
  }
  for (const f of p.meteo.facteurs) l.push(`  - ${f}`);
  l.push('');
  for (const c of p.chiffres) l.push(`${c.valeur} ${c.libelle}`);
  l.push('');
  l.push('POINTS À ABORDER');
  if (p.points.length === 0) l.push('  (rien que les données signalent)');
  p.points.forEach((pt, i) => l.push(`  ${i + 1}. ${pt.texte}`));
  l.push('');
  l.push('INCIDENTS OUVERTS');
  if (p.incidents.length === 0) l.push('  aucun');
  for (const i of p.incidents) l.push(`  - [${i.priorite}] ${i.titre} — ${i.qui}, ouvert le ${i.ouvertLe}`);
  if (p.projets.length) {
    l.push('');
    l.push('PROJETS');
    for (const pr of p.projets)
      l.push(`  - ${pr.nom} — ${pr.avance} % déclaré (${pr.avanceTerminees} % terminé), ${pr.heures}${pr.alerte ? ` (! ${pr.alerte})` : ''}`);
  }
  l.push('');
  l.push('SUJETS PRÉVUS SUR LES DEUX SEMAINES (sous réserve)');
  for (const s of p.semaines) {
    l.push(`  ${s.label} — planning rempli à ${s.remplissage} %`);
    if (s.sujets.length === 0) l.push("    (rien de planifié ni d'échu)");
    for (const x of s.sujets) l.push(`    - ${x.titre} — ${x.qui}, ${x.quand}${x.reserve ? ` (! ${x.reserve})` : ''}`);
  }
  l.push('');
  l.push('ABSENCES');
  if (p.absences.length === 0) l.push("  aucune, toute l'équipe est là");
  for (const a of p.absences) l.push(`  - ${a.qui} — ${a.quoi}, ${a.quand}`);
  l.push('');
  l.push('Le document complet, avec la grille jour par jour, est en pièce jointe.');
  return l.join('\n');
}

export function nomFichier(p) {
  // Le nom porte la date de la réunion : trois rapports dans un même dossier de
  // téléchargements doivent rester distinguables sans les ouvrir.
  const base = (p.dateReunion || p.semaineLabel || 'reunion').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `reunion-${slug || 'equipe'}.html`;
}
