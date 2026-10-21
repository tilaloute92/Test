import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { dataRouter } from './routes/data.js';
import { mailRouter } from './routes/mail.js';
import { equipesRouter } from './routes/equipes.js';
import { glpiRouter } from './routes/glpi.js';
import { startMailScheduler } from './mail/scheduler.js';
import { startRetentionScheduler } from './retention.js';
import { listerEquipes, migrerSiBesoin, rattacherComptesSansEquipe } from './equipes.js';

/**
 * Migration vers la disposition multi-équipe, AVANT toute lecture de données.
 *
 * Les installations existantes ont leurs fichiers métier à la racine de `data/` ; ils
 * passent dans `data/equipes/equipe-1/`. Joué une seule fois, silencieux quand il n'y a
 * rien à faire, et placé ici — avant que le moindre module n'ouvre un fichier — parce
 * qu'un déplacement à chaud laisserait un cache pointant sur un fichier disparu.
 */
const migration = migrerSiBesoin();
if (migration.migre) {
  console.log(`[équipes] Migration : ${migration.fichiers} fichier(s) déplacés vers l'équipe initiale.`);
}
// Joué à CHAQUE démarrage, et sans effet dès qu'il existe deux équipes : une installation
// déjà migrée avant l'ajout de cette règle doit elle aussi voir ses comptes rattachés,
// sans quoi la création de la deuxième équipe les mettrait tous dehors d'un coup.
const rattaches = await rattacherComptesSansEquipe();
if (rattaches > 0) console.log(`[équipes] ${rattaches} compte(s) local(aux) rattaché(s) à l'unique équipe.`);

const app = express();

// Le certificat TLS est géré par IIS (voir DEPLOYMENT.md) : ce service écoute en
// HTTP en clair sur localhost, joignable uniquement via le reverse proxy d'IIS,
// jamais exposé directement sur le réseau.
app.set('trust proxy', 1);

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

/**
 * Sonde de disponibilité, volontairement accessible sans session : c'est par elle que le
 * navigateur découvre, avant même l'écran de connexion, qu'il parle à une installation
 * client/serveur — et donc qu'il ne doit pas se comporter comme une installation autonome.
 * Elle ne révèle rien d'autre que l'existence du service (aucune donnée d'équipe, aucun
 * état d'avancement) : tout le reste passe par /api/data, qui exige une session.
 */
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'client-serveur', app: 'suivi-infra' }));
app.use('/api/auth', authRouter);
app.use('/api/data', dataRouter);
app.use('/api/mail', mailRouter);
app.use('/api/equipes', equipesRouter);
app.use('/api/glpi', glpiRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

const serveur = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Serveur d'authentification démarré sur http://127.0.0.1:${config.port}`);
  const equipes = listerEquipes();
  console.log(`[équipes] ${equipes.length} équipe(s) : ${equipes.map((e) => `${e.nom} (${e.id})`).join(', ')}`);
  startMailScheduler();
  startRetentionScheduler();
});

/**
 * Le port occupé est la panne la plus coûteuse à diagnostiquer, parce qu'elle ne ressemble
 * pas à une panne : le service s'arrête aussitôt, la tâche planifiée repasse en « Ready »
 * comme si elle avait fini son travail, et l'application annonce « Serveur indisponible »
 * sans rien dire de plus. Elle survient typiquement après l'installation d'une autre
 * application sur le même serveur — 4000 est un port par défaut très répandu.
 *
 * Node n'écrit alors qu'une trace de pile « EADDRINUSE », illisible pour qui cherche
 * pourquoi son planning a disparu. On la remplace par la cause et la sortie.
 */
serveur.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `ARRÊT : le port ${config.port} est déjà occupé par un autre programme.`,
        '',
        "Ce service ne peut pas démarrer tant qu'il ne peut pas écouter sur ce port. C'est",
        "souvent le fait d'une autre application installée depuis sur le même serveur.",
        '',
        'Pour voir qui occupe le port, depuis une console administrateur :',
        `    Get-Process -Id (Get-NetTCPConnection -State Listen -LocalPort ${config.port}).OwningProcess`,
        '',
        'Deux issues : arrêter ce programme, ou déplacer ce service sur un autre port —',
        '    .\\Set-SuiviInfraPort.ps1 -NewPort 4010',
        "qui change à la fois le service et la règle de relais d'IIS, les deux devant",
        'toujours désigner le même port.',
        '',
      ].join('\n')
    );
  } else {
    console.error(`ARRÊT : impossible d'écouter sur le port ${config.port} — ${err.message}`);
  }
  process.exit(1);
});
