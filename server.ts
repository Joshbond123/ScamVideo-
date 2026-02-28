import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDb, readJson, updateJson, writeJson, PATHS, appendJson } from './server/db';
import { deleteApiKey, insertApiKey, listApiKeys, patchApiKey } from './server/services/supabaseKeyStore';
import { startScheduler, runJob, requestSchedulerRefresh } from './server/scheduler';
import { verifyTokenAndGetPages } from './server/services/facebookService';
import { ApiKey, Schedule } from './src/types';

async function startServer() {
  await initDb();
  
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

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

  app.delete('/api/settings/catbox', async (req, res) => {
    const current = await readJson<any>(PATHS.settings);
    await writeJson(PATHS.settings, { ...current, catboxHash: '' });
    res.json({ success: true });
  });

  app.get('/api/keys/:provider', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    try {
      res.json(await listApiKeys(provider));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/keys/:provider', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    const { name, key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key value is required' });

    try {
      const existing = await listApiKeys(provider);
      const newKey: ApiKey = {
        id: Math.random().toString(36).substr(2, 9),
        provider,
        name: name?.trim() || `Key #${existing.length + 1}`,
        key,
        successCount: 0,
        failCount: 0,
        status: 'active'
      };
      const inserted = await insertApiKey(newKey);
      res.json(inserted);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/keys/:provider/:id', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    const id = req.params.id;
    const { name, key, status } = req.body;
    let updatedKey: ApiKey | null = null;

    try {
      const existing = await listApiKeys(provider);
      const current = existing.find((k) => k.id === id);
      if (!current) return res.status(404).json({ error: 'Key not found' });

      const idx = existing.findIndex((k) => k.id === id);
      updatedKey = {
        ...current,
        name: typeof name === 'string' ? (name.trim() || `Key #${idx + 1}`) : current.name,
        key: typeof key === 'string' && key.trim() ? key.trim() : current.key,
        status: status === 'inactive' ? 'inactive' : 'active'
      };
      await patchApiKey(provider, id, updatedKey);
      res.json(updatedKey);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/keys/:provider/:id', async (req, res) => {
    const provider = req.params.provider as ApiKey['provider'];
    const id = req.params.id;
    try {
      await deleteApiKey(provider, id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Facebook
  app.post('/api/facebook/connect', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Facebook token is required' });
      const pages = await verifyTokenAndGetPages(token);
      await updateJson<any[]>(PATHS.facebook.pages, (existing) => {
        const merged = [...existing];
        pages.forEach((page) => {
          const idx = merged.findIndex((ep) => ep.id === page.id);
          if (idx === -1) {
            merged.push(page);
          } else {
            merged[idx] = { ...merged[idx], ...page };
          }
        });
        return merged;
      });
      res.json(pages);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/facebook/pages/:id/refresh', async (req, res) => {
    const pageId = req.params.id;
    const pages = await readJson<any[]>(PATHS.facebook.pages);
    const page = pages.find((p) => p.id === pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    try {
      const refreshedPage = (await verifyTokenAndGetPages(page.accessToken)).find((p) => p.id === pageId);
      const updated = {
        ...page,
        ...refreshedPage,
        status: 'valid',
        lastChecked: new Date().toISOString()
      };

      await updateJson<any[]>(PATHS.facebook.pages, (allPages) => allPages.map((p) => p.id === pageId ? updated : p));
      res.json(updated);
    } catch {
      const updated = {
        ...page,
        status: 'expired',
        lastChecked: new Date().toISOString()
      };

      await updateJson<any[]>(PATHS.facebook.pages, (allPages) => allPages.map((p) => p.id === pageId ? updated : p));
      res.json(updated);
    }
  });



  app.put('/api/facebook/pages/:id', async (req, res) => {
    const pageId = req.params.id;
    const { name, accessToken } = req.body;

    const pages = await readJson<any[]>(PATHS.facebook.pages);
    const page = pages.find((p) => p.id === pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const updated = {
      ...page,
      name: typeof name === 'string' && name.trim() ? name.trim() : page.name,
      accessToken: typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : page.accessToken,
      lastChecked: new Date().toISOString()
    };

    await updateJson<any[]>(PATHS.facebook.pages, (allPages) => allPages.map((p) => p.id === pageId ? updated : p));
    res.json(updated);
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
    requestSchedulerRefresh();
    res.json(schedule);
  });

  app.delete('/api/schedules/:type/:id', async (req, res) => {
    const type = req.params.type as 'video' | 'post';
    await updateJson<Schedule[]>(PATHS.schedules[type], (schedules) => schedules.filter(s => s.id !== req.params.id));
    requestSchedulerRefresh();
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startScheduler();
  });
}

startServer();
