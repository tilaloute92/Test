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

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/data', dataRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Serveur d'authentification démarré sur http://127.0.0.1:${config.port}`);
});
