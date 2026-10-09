import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { parseAdminAllowedIps } from '../server/admin-access';
import { checkRequestAccess, parseAllowedOrigins, type RequestAccess } from '../server/request-access';

test('CORS 출처는 HTTP·HTTPS 도메인만 허용', () => {
  assert.deepEqual([...parseAllowedOrigins(' https://subculture-calendar.pages.dev/, http://localhost:5173 ')], ['https://subculture-calendar.pages.dev', 'http://localhost:5173']);
  assert.equal(parseAllowedOrigins(undefined).size, 0);
  for (const value of ['*', 'null', 'ftp://example.com', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com?query=1', 'https://example.com#hash']) {
    assert.throws(() => parseAllowedOrigins(value), /CORS_ALLOWED_ORIGINS/);
  }
});

test('Pages CORS·관리자 preflight·HTTPS 출처·프록시 IP 제한을 실제 HTTP 요청으로 검증', async () => {
  const pages = 'https://subculture-calendar.pages.dev';
  const access: RequestAccess = {
    adminAllowedIps: parseAdminAllowedIps('127.0.0.1'),
    trustedProxyIps: parseAdminAllowedIps(''),
    allowedOrigins: parseAllowedOrigins(pages),
  };
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!checkRequestAccess(req, res, pathname, access)) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const send = (path: string, method = 'GET', headers: IncomingHttpHeaders = {}) => new Promise<{ status: number | undefined; headers: IncomingHttpHeaders }>((resolve, reject) => {
      const req = request(base + path, { method, headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
    const publicResponse = await send('/api/calendar', 'GET', { origin: pages });
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers['access-control-allow-origin'], pages);
    assert.equal(publicResponse.headers.vary, 'Origin');
    const blockedOrigin = await send('/api/calendar', 'GET', { origin: 'https://evil.example' });
    assert.equal(blockedOrigin.status, 403);
    assert.equal(blockedOrigin.headers['access-control-allow-origin'], undefined);
    assert.equal((await send('/api/calendar')).status, 200);

    const preflight = { origin: pages, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' };
    const options = await send('/api/admin', 'OPTIONS', preflight);
    assert.equal(options.status, 204);
    assert.equal(options.headers['access-control-allow-methods'], 'GET, POST');
    assert.equal(options.headers['access-control-allow-headers'], 'Content-Type');
    assert.equal(options.headers['cache-control'], 'no-store');
    assert.equal((await send('/api/calendar', 'OPTIONS', preflight)).status, 403);
    assert.equal((await send('/api/admin', 'OPTIONS', { ...preflight, 'access-control-request-headers': 'x-custom' })).status, 403);
    assert.equal((await send('/api/missing', 'OPTIONS', preflight)).status, 404);
    assert.equal((await send('/api/admin', 'OPTIONS')).status, 403);

    assert.equal((await send('/api/admin', 'POST', { origin: pages, 'content-type': 'application/json; charset=utf-8' })).status, 200);
    assert.equal((await send('/api/admin', 'POST', { origin: base, 'content-type': 'application/json' })).status, 200);
    assert.equal((await send('/api/admin', 'POST', { 'content-type': 'application/json' })).status, 403);
    assert.equal((await send('/api/admin', 'POST', { origin: pages, 'content-type': 'application/json-invalid' })).status, 403);

    const httpsHeaders = { host: 'api.example.com', origin: 'https://api.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.168.0.2', 'content-type': 'application/json' };
    assert.equal((await send('/api/admin', 'POST', httpsHeaders)).status, 403);
    access.trustedProxyIps = parseAdminAllowedIps('127.0.0.1');
    access.adminAllowedIps = parseAdminAllowedIps('192.168.0.2,127.0.0.1');
    assert.equal((await send('/api/admin', 'POST', httpsHeaders)).status, 200);
    assert.equal((await send('/api/admin', 'POST', { ...httpsHeaders, 'x-forwarded-proto': 'https,http' })).status, 403);
    assert.equal((await send('/api/admin', 'POST', { ...httpsHeaders, 'x-forwarded-for': '192.168.0.3' })).status, 403);
    assert.equal((await send('/api/admin', 'OPTIONS', { ...preflight, 'x-forwarded-for': '192.168.0.2' })).status, 204);
    for (const forwarded of [undefined, '192.168.0.3', '192.168.0.2,203.0.113.2']) {
      for (const path of ['/admin', '/api/admin', '/api/admin/logs', '/api/admin/refresh']) {
        assert.equal((await send(path, 'GET', { 'x-forwarded-for': forwarded })).status, 403);
      }
      assert.equal((await send('/api/admin', 'OPTIONS', { ...preflight, 'x-forwarded-for': forwarded })).status, 403);
    }
    assert.equal((await send('/api/calendar', 'GET', { origin: pages })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
