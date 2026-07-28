'use strict';

const axios = require('axios');

// Owncast instances use the standard /hls/stream.m3u8 path and expose an
// /api/status endpoint reporting an { online } boolean. After Swim is not
// Owncast — it serves a live HLS playlist from its own origin, so its full
// URL is set explicitly and it has no statusUrl to check.
// HLS, no auth required, TV-safe (Android TV / Stremio desktop).
const CHANNELS = [
  { id: 'ntv-ccn',          url: 'https://cartooncartoons.thatsoretro.com/hls/stream.m3u8', statusUrl: 'https://cartooncartoons.thatsoretro.com/api/status' },
  { id: 'ntv-afterswim',    url: 'https://weedtux.s3.us-east-005.backblazeb2.com/hls/nsv.m3u8' },
  { id: 'ntv-verniy',       url: 'https://live.verniy.tv/hls/stream.m3u8',                   statusUrl: 'https://live.verniy.tv/api/status' },
  { id: 'ntv-retrostrange', url: 'https://live.retrostrange.com/hls/stream.m3u8',            statusUrl: 'https://live.retrostrange.com/api/status' },
];

// Only a definitive online:false drops the channel. If the status endpoint is
// unreachable we stay lenient and let the playlist resolve step be the gate,
// which avoids flapping when only the status API is briefly down.
async function isOnline(statusUrl) {
  try {
    const res = await axios.get(statusUrl, { timeout: 8000 });
    return !(res.data && res.data.online === false);
  } catch (statusErr) {
    console.warn(`[refresh] Owncast status check errored for ${statusUrl}: ${statusErr.message}`);
    return true;
  }
}

async function extract() {
  const out = [];
  for (const { id, url, statusUrl } of CHANNELS) {
    if (statusUrl && !(await isOnline(statusUrl))) continue;
    out.push({ id, url });
  }
  return out;
}

module.exports = { extract, name: 'owncast' };
