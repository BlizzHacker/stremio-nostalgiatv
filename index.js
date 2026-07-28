'use strict';
require('dotenv').config();
const express = require('express');
const { getRouter } = require('stremio-addon-sdk');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const addonInterface = require('./src/addon');
const channels = require('./src/channels');
const store = require('./src/store');
const { refresh } = require('./src/refresh');

const PORT = process.env.PORT || 7000;

const app = express();

// Trust the reverse proxy (Caddy) so req.ip reflects the forwarded client IP.
// Set this to the number of proxies in front of the app. If Cloudflare sits in
// front of Caddy, configure Caddy's trusted_proxies for Cloudflare and raise
// this to match — do NOT read client-supplied headers like cf-connecting-ip
// directly, which any request can forge to evade rate limiting.
app.set('trust proxy', 1);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
  );
  next();
});

// Rate limiting — 120 requests per 15 minutes per client IP.
// Keyed on the default req.ip, which trust proxy derives from X-Forwarded-For.
// This cannot be spoofed by an arbitrary request header the way the previous
// cf-connecting-ip key could.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
}));

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Display grouping for the landing page — collapses the CN/Adult Swim sources
// into one visual group while keeping Toonami and Pluto separate.
function channelGroup(id) {
  if (id.startsWith('ntv-toonamiaftermath-')) return 'Toonami Aftermath';
  if (id.startsWith('ntv-pluto-')) return 'Pluto TV';
  return 'Adult Swim / CN';
}

// Live channel status — single source of truth for the landing page list.
// A channel is live when the latest refresh cycle resolved a URL for it.
app.get('/status', (req, res) => {
  const list = channels.map((ch) => ({
    id: ch.id,
    name: ch.name,
    group: channelGroup(ch.id),
    live: store.get(ch.id) !== null,
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    generatedAt: new Date().toISOString(),
    total: list.length,
    live: list.filter((c) => c.live).length,
    channels: list,
  });
});

// Stremio addon routes
app.use(getRouter(addonInterface));

// Static assets — served at root so /favicon.ico, /site.webmanifest, etc. resolve correctly
// Also aliased at /public to match image paths used in index.html (/public/images/...)
const publicDir = express.static(path.join(process.cwd(), 'public'));
app.use(publicDir);
app.use('/public', publicDir);

// Trigger immediate refresh at startup (node-cron v4 removed runOnInit)
refresh().catch((err) => console.warn('[startup] Initial refresh failed:', err.message));

// Schedule subsequent refreshes every 5 minutes
// noOverlap: true requires the callback to return the Promise
cron.schedule('*/5 * * * *', () => {
  return refresh().catch((err) => console.warn('[cron] Refresh failed:', err.message));
}, { noOverlap: true });

app.listen(PORT, () => {
  console.log(`Nostalgia TV running on http://127.0.0.1:${PORT}/manifest.json`);
});
