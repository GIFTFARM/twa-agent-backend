import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { bot } from './bot.js';
import { chatRouter } from './routes/chat.js';
import { adminRouter } from './routes/admin.js';
import { deviceRouter } from './routes/device.js';
import { starsRouter } from './routes/stars.js';
import { runMigrations } from './migrate-on-start.js';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => res.json({ ok: true, service: 'twa-agent' }));
app.get('/api/health', (_req, res) => res.json({ status: 'healthy', uptime: process.uptime() }));

app.use('/api', chatRouter);
app.use('/api/admin', adminRouter);
app.use('/api/device', deviceRouter);
app.use('/api/stars', starsRouter);

const server = app.listen(config.port, async () => {
  console.log(`[twa-agent] HTTP on :${config.port}`);
  try {
    await runMigrations();
  } catch (e) {
    console.error('[twa-agent] migrations failed', e);
    process.exit(1);
  }
  bot.start({
    onStart: (info) => console.log(`[twa-agent] bot @${info.username} polling`),
  }).catch((e) => {
    console.error('[twa-agent] bot start failed', e);
  });
});

// Self-ping: keep Render free tier awake by hitting our own /api/health every 14 min
if (!config.disableSelfPing && config.publicUrl) {
  const url = `${config.publicUrl.replace(/\/$/, '')}/api/health`;
  const interval = 14 * 60 * 1000;
  const tick = async () => {
    try {
      const r = await fetch(url, { method: 'GET' });
      console.log(`[self-ping] ${url} → ${r.status}`);
    } catch (e) {
      console.warn('[self-ping] failed:', (e as Error).message);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, interval);
}

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
