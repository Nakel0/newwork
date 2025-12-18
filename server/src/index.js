import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(cookieParser());
app.use('/api', express.json({ limit: '1mb' }));

const staticRoot = path.resolve(__dirname, '../../');
app.use(express.static(staticRoot));

app.get('/', (_req, res) => {
  res.sendFile(path.join(staticRoot, 'landing.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`CloudMigrate Pro server listening on :${port}`);
});
