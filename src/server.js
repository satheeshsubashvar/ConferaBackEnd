import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import sessionsRoutes from './routes/sessions.js';
import tracksRoutes from './routes/tracks.js';
import categoriesRoutes from './routes/categories.js';
import speakerCenterRoutes from './routes/speakerCenter.js';
import sponsorCenterRoutes from './routes/sponsorCenter.js';
import sessionQARoutes from './routes/sessionQA.js';
import webPagesRoutes from './routes/webPages.js';
import exhibitorsRoutes from './routes/exhibitors.js';
import publicRoutes from './routes/public.js';
import portalAuthRoutes from './routes/portalAuth.js';
import uploadsRoutes from './routes/uploads.js';
import engagementRoutes from './routes/engagement.js';
import attendeesRoutes from './routes/attendees.js';
import settingsRoutes from './routes/settings.js';
import analyticsRoutes from './routes/analytics.js';
import mediaCenterRoutes from './routes/mediaCenter.js';
import emsModulesRoutes from './routes/emsModules.js';
import { initDatabase } from './data/store.js';
import { UPLOADS_DIR } from './middleware/upload.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serves uploaded files directly (e.g. /uploads/<uuid>.png). In
// production behind a reverse proxy, this can instead be served by
// nginx/the platform's static file layer for better performance —
// swapping that out doesn't change any URLs since buildUploadUrl()
// already returns full URLs based on UPLOADS_BASE_URL.
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/events/:eventId/sessions', sessionsRoutes);
app.use('/api/events/:eventId/tracks', tracksRoutes);
app.use('/api/events/:eventId/categories', categoriesRoutes);
app.use('/api/events/:eventId/speaker-center', speakerCenterRoutes);
app.use('/api/events/:eventId/sponsor-center', sponsorCenterRoutes);
app.use('/api/events/:eventId/session-qa', sessionQARoutes);
app.use('/api/events/:eventId/web-pages', webPagesRoutes);
app.use('/api/events/:eventId/exhibitors', exhibitorsRoutes);
app.use('/api/events/:eventId/engagement', engagementRoutes);
app.use('/api/events/:eventId/attendees', attendeesRoutes);
app.use('/api/events/:eventId/settings', settingsRoutes);
app.use('/api/events/:eventId/analytics', analyticsRoutes);
app.use('/api/events/:eventId/ems-modules', emsModulesRoutes);
app.use('/api/events/:eventId', mediaCenterRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/portal-auth', portalAuthRoutes);
app.use('/api/uploads', uploadsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Confera Admin API listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
