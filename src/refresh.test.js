'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let refresh;
try { refresh = require('./refresh'); } catch { refresh = null; }
let store;
try { store = require('./store'); } catch { store = null; }

const stubResolveUrl = async (url) => 'https://resolved.example.com/final.m3u8';

const failingExtractor = {
  name: 'failing',
  extract: async () => { throw new Error('network error'); },
};

const workingExtractor = {
  name: 'working',
  extract: async () => [{ id: 'ntv-test', url: 'https://original.example.com/stream' }],
};

describe('refresh (CACHE-01, CACHE-02, CACHE-03)', () => {
  beforeEach(() => {
    if (store) store.clear();
  });

  test('CACHE-01: refreshWith with a working extractor writes results to the store', async () => {
    assert.ok(refresh, 'refresh.js not found');
    assert.ok(store, 'store.js not found');
    assert.equal(typeof refresh.refreshWith, 'function', 'refresh.refreshWith must be a function');
    await refresh.refreshWith([workingExtractor], stubResolveUrl);
    assert.ok(store.get('ntv-test') !== null, 'store should have entry for ntv-test after refresh');
  });

  test('CACHE-02: refreshWith stores the resolveUrlFn return value, not the original extractor URL', async () => {
    assert.ok(refresh, 'refresh.js not found');
    assert.ok(store, 'store.js not found');
    await refresh.refreshWith([workingExtractor], stubResolveUrl);
    assert.equal(
      store.get('ntv-test'),
      'https://resolved.example.com/final.m3u8',
      'stored URL must be the resolveUrlFn return value'
    );
  });

  test('CACHE-03: working extractor writes to store even when failing extractor throws first', async () => {
    assert.ok(refresh, 'refresh.js not found');
    assert.ok(store, 'store.js not found');
    await refresh.refreshWith([failingExtractor, workingExtractor], stubResolveUrl);
    assert.ok(
      store.get('ntv-test') !== null,
      'working extractor result should be in store despite failing extractor'
    );
  });

  test('CACHE-03: refreshWith resolves without error even when all extractors fail', async () => {
    assert.ok(refresh, 'refresh.js not found');
    await assert.doesNotReject(
      () => refresh.refreshWith([failingExtractor], stubResolveUrl),
      'refreshWith must not throw when all extractors fail'
    );
  });

  test('CACHE-03: does not store a channel when resolveUrlFn throws (dead stream is dropped)', async () => {
    assert.ok(refresh, 'refresh.js not found');
    assert.ok(store, 'store.js not found');
    const throwingResolve = async () => { throw new Error('Parse Error: Content-Length can\'t be present with Transfer-Encoding'); };
    await refresh.refreshWith([workingExtractor], throwingResolve);
    assert.equal(
      store.get('ntv-test'),
      null,
      'a channel that fails to resolve must not be stored as a dead URL'
    );
  });

  test('refreshWith reports resolved channels in the live set', async () => {
    assert.ok(refresh, 'refresh.js not found');
    const live = new Set();
    await refresh.refreshWith([workingExtractor], stubResolveUrl, live);
    assert.ok(live.has('ntv-test'), 'live set must contain successfully resolved channel IDs');
  });
});

describe('isPrivateUrl (SSRF guard, SEC-01)', () => {
  const blocked = [
    'http://127.0.0.1/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/x',
    'http://0.0.0.0/x',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'http://[fe80::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://localhost/x',
    'not-a-valid-url',
  ];
  const allowed = [
    'http://8.8.8.8/x',
    'https://1.1.1.1/stream.m3u8',
  ];

  for (const url of blocked) {
    test(`blocks ${url}`, async () => {
      assert.ok(refresh, 'refresh.js not found');
      assert.equal(await refresh.isPrivateUrl(url), true, `${url} should be treated as private`);
    });
  }

  for (const url of allowed) {
    test(`allows ${url}`, async () => {
      assert.ok(refresh, 'refresh.js not found');
      assert.equal(await refresh.isPrivateUrl(url), false, `${url} should be allowed`);
    });
  }
});
