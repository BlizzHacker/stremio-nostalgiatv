'use strict';
const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const store = require('./store');
const extractors = require('./extractors');

// Decide whether a resolved IP address falls in a private, loopback, link-local
// or otherwise non-routable range. Handles IPv4, IPv4-mapped IPv6, and IPv6.
function isPrivateIp(ip) {
  let addr = ip;
  if (net.isIP(addr) === 6) {
    const low = addr.toLowerCase();
    // IPv4-mapped IPv6, dotted form: ::ffff:127.0.0.1
    const dotted = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) addr = dotted[1];
    // IPv4-mapped IPv6, hex form (as URL normalizes it): ::ffff:7f00:1
    const hex = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      addr = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }
  if (net.isIP(addr) === 4) {
    const p = addr.split('.').map(Number);
    return (
      p[0] === 0 ||                               // 0.0.0.0/8
      p[0] === 127 ||                             // loopback
      p[0] === 10 ||                              // private
      (p[0] === 169 && p[1] === 254) ||           // link-local (incl. cloud metadata)
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || // CGNAT 100.64.0.0/10
      (p[0] === 192 && p[1] === 0 && p[2] === 0) ||   // IETF protocol assignments
      p[0] >= 224                                  // multicast / reserved
    );
  }
  const lower = addr.toLowerCase();
  return (
    lower === '::1' ||           // loopback
    lower === '::' ||            // unspecified
    lower.startsWith('fe80:') || // link-local
    lower.startsWith('fc') ||    // unique local fc00::/7
    lower.startsWith('fd') ||
    lower.startsWith('ff')       // multicast
  );
}

// Reject URLs that point at private/internal addresses to prevent SSRF.
// When the host is a name rather than an IP literal, resolve it and inspect
// every returned address so DNS entries that map to internal ranges are caught.
// Fails closed: any parse or resolution error is treated as private.
async function isPrivateUrl(urlString) {
  let host;
  try {
    host = new URL(urlString).hostname;
  } catch {
    return true;
  }
  host = host.replace(/^\[|\]$/g, ''); // strip IPv6 literal brackets
  if (host === 'localhost') return true;
  if (net.isIP(host)) return isPrivateIp(host);
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) return true;
    return records.some((r) => isPrivateIp(r.address));
  } catch {
    return true;
  }
}

async function resolveUrl(url) {
  if (await isPrivateUrl(url)) throw new Error(`Blocked private URL: ${url}`);
  const opts = {
    maxRedirects: 3,
    timeout: 10000,
    validateStatus: (status) => status >= 200 && status < 400,
  };
  let response;
  try {
    response = await axios.head(url, opts);
  } catch (headErr) {
    // Some origins reject or mishandle HEAD (405, or malformed headers that
    // break the parser) while serving the stream fine — retry with a tiny
    // ranged GET before giving up.
    response = await axios.get(url, { ...opts, headers: { Range: 'bytes=0-0' } });
  }
  const resolved = response.request.res.responseUrl || url;
  if (await isPrivateUrl(resolved)) throw new Error(`Redirect to private URL blocked: ${resolved}`);
  return resolved;
}

async function refreshWith(extractorList, resolveUrlFn, live = new Set()) {
  for (const extractor of extractorList) {
    try {
      const results = await extractor.extract();
      for (const { id, url } of results) {
        try {
          const finalUrl = await resolveUrlFn(url);
          store.set(id, finalUrl);
          live.add(id);
        } catch (urlErr) {
          // A channel that will not resolve is treated as offline for this
          // cycle and left out of the store rather than served as a dead URL.
          console.warn(`[refresh] Failed to resolve URL for ${id}: ${urlErr.message} — skipping`);
        }
      }
    } catch (extractorErr) {
      const name = extractor.name || '(unknown)';
      console.warn(`[refresh] Extractor "${name}" failed: ${extractorErr.message}`);
    }
  }
  return live;
}

async function refresh() {
  const live = new Set();
  await refreshWith(extractors, resolveUrl, live);
  // Drop channels that are no longer live so the catalog reflects real
  // availability. Skip pruning when a cycle produced nothing (e.g. a total
  // network outage) to preserve the last-known-good set instead of emptying it.
  if (live.size > 0) {
    for (const id of [...store.all().keys()]) {
      if (!live.has(id)) store.del(id);
    }
  }
}

module.exports = { refresh, refreshWith, resolveUrl, isPrivateUrl };
