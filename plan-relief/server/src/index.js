import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { plansRouter, searchRouter } from './routes/plans.js';
import { loadPlans } from './plansStore.js';

// Lecture stricte de la bibliothèque AVANT d'ouvrir le port : un plan.json illisible
// arrête le service avec un message qui nomme le fichier (voir dataStore.js).
const count = loadPlans();

const app = express();

// Le certificat TLS est géré par IIS (voir DEPLOYMENT.md) : ce service écoute en
// HTTP en clair sur localhost, joignable uniquement via le reverse proxy d'IIS,
// jamais exposé directement sur le réseau.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(cors({ origin: config.corsOrigins, credentials: true }));
// Les modifications d'un plan renvoient sa liste d'équipements complète : quelques Mo
// pour un grand plan d'étage annoté.
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

/**
 * Sonde de disponibilité, volontairement accessible sans session. Elle ne révèle rien
 * d'autre que l'existence du service : les plans passent par /api/plans, qui exige une
 * session.
 */
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'client-serveur', app: 'plan-relief' }));
app.use('/api/auth', authRouter);
app.use('/api/plans', plansRouter);
app.use('/api/search', searchRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
  res.status(500).json({ error: 'Erreur serveur.' });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Plan Relief : service démarré sur http://127.0.0.1:${config.port} (${count} plan(s) en bibliothèque)`);
});
