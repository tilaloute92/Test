import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { dataRouter } from './routes/data.js';

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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Serveur d'authentification démarré sur http://127.0.0.1:${config.port}`);
});
