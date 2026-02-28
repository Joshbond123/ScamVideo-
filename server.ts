import express from 'express';
import { createServer as createViteServer } from 'vite';
import { initDb, readJson, updateJson, writeJson, PATHS, appendJson } from './server/db';
import { startScheduler, runJob } from './server/scheduler';
import { verifyTokenAndGetPages } from './server/services/facebookService';
import { ApiKey, Schedule } from './src/types';

async function startServer() {
  await initDb();
  
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  
  // Settings & Keys
  app.get('/api/settings', async (req, res) => {
    res.json(await readJson(PATHS.settings));
  });

  app.post('/api/settings', async (req, res) => {
    await writeJson(PATHS.settings, req.body);
    res.json({ success: true });
  });

  app.get('/api/keys/:provider', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    res.json(await readJson(PATHS.keys[provider]));
  });

  app.post('/api/keys/:provider', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    const { name, key } = req.body;
    const newKey: ApiKey = {
      id: Math.random().toString(36).substr(2, 9),
      provider,
      name,
      key,
      successCount: 0,
      failCount: 0,
      status: 'active'
    };
    await appendJson(PATHS.keys[provider], newKey);
    res.json(newKey);
  });

  app.delete('/api/keys/:provider/:id', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    const id = req.params.id;
    await updateJson<ApiKey[]>(PATHS.keys[provider], (keys) => keys.filter(k => k.id !== id));
    res.json({ success: true });
  });

  // Facebook
  app.post('/api/facebook/connect', async (req, res) => {
    try {
      const { token } = req.body;
      const pages = await verifyTokenAndGetPages(token);
      await updateJson<any[]>(PATHS.facebook.pages, (existing) => {
        const newPages = pages.filter(p => !existing.find(ep => ep.id === p.id));
        return [...existing, ...newPages];
      });
      res.json(pages);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/facebook/pages', async (req, res) => {
    res.json(await readJson(PATHS.facebook.pages));
  });

  app.delete('/api/facebook/pages/:id', async (req, res) => {
    await updateJson<any[]>(PATHS.facebook.pages, (pages) => pages.filter(p => p.id !== req.params.id));
    res.json({ success: true });
  });

  // Scheduling
  app.get('/api/schedules/:type', async (req, res) => {
    const type = req.params.type as 'video' | 'post';
    res.json(await readJson(PATHS.schedules[type]));
  });

  app.post('/api/schedules/:type', async (req, res) => {
    const type = req.params.type as 'video' | 'post';
    const schedule: Schedule = {
      ...req.body,
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    await appendJson(PATHS.schedules[type], schedule);
    res.json(schedule);
  });

  app.delete('/api/schedules/:type/:id', async (req, res) => {
    const type = req.params.type as 'video' | 'post';
    await updateJson<Schedule[]>(PATHS.schedules[type], (schedules) => schedules.filter(s => s.id !== req.params.id));
    res.json({ success: true });
  });

  // Content
  app.get('/api/content/published-videos', async (req, res) => {
    res.json(await readJson(PATHS.content.published_videos));
  });

  app.get('/api/content/published-posts', async (req, res) => {
    res.json(await readJson(PATHS.content.published_posts));
  });

  // Logs
  app.get('/api/logs', async (req, res) => {
    res.json(await readJson(PATHS.logs));
  });

  // Manual Run
  app.post('/api/run/:type/:id', async (req, res) => {
    const type = req.params.type as 'video' | 'post';
    const schedules = await readJson<Schedule[]>(PATHS.schedules[type]);
    const schedule = schedules.find(s => s.id === req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    
    // Run in background
    runJob(schedule).catch(console.error);
    res.json({ message: 'Job started' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startScheduler();
  });
}

startServer();
