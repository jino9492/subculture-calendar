import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get, type IncomingHttpHeaders } from 'node:http';
import { Socket } from 'node:net';
import { isAdminPath, isAllowedAdminRequest, parseAdminAllowedIps } from '../server/admin-access';

const request = (address: string | undefined, headers: IncomingHttpHeaders = { host: 'localhost:5173' }) => {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: address });
  return { socket, headers };
};

test('관리 페이지와 모든 관리자 API 하위 경로 보호', () => {
  for (const path of ['/admin', '/admin/', '/admin/nested', '/api/admin', '/api/admin/refresh', '/api/admin/future']) assert.ok(isAdminPath(path));
  for (const path of ['/', '/api/calendar', '/administrator', '/api/admin-other']) assert.equal(isAdminPath(path), false);
});

test('설정된 실제 IP만 허용하고 루프백도 목록에 없으면 차단', () => {
  const allowedIps = parseAdminAllowedIps(' 192.168.0.2, 203.0.113.2, 2001:db8::1,192.168.0.2, ');
  assert.equal(allowedIps.size, 3);
  for (const address of ['192.168.0.2', '203.0.113.2', '::ffff:192.168.0.2', '::ffff:c0a8:2', '2001:0DB8:0:0:0:0:0:1']) {
    assert.ok(isAllowedAdminRequest(request(address, { host: 'calendar.example:5173' }), allowedIps));
  }
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.0.3', undefined]) {
    assert.equal(isAllowedAdminRequest(request(address, { host: 'localhost:5173', 'x-forwarded-for': '192.168.0.2', forwarded: 'for=192.168.0.2' }), allowedIps), false);
  }
});

test('빈 목록은 모두 차단하고 잘못된 IP 설정은 거부', () => {
  for (const value of [undefined, '', ' , ']) {
    assert.equal(isAllowedAdminRequest(request('127.0.0.1'), parseAdminAllowedIps(value)), false);
  }
  for (const value of ['localhost', '*', '192.168.0.0/24', '999.1.1.1', '127.0.0.1,invalid']) {
    assert.throws(() => parseAdminAllowedIps(value), /ADMIN_ALLOWED_IPS/);
  }
});

test('IPv4 매핑 설정과 IPv6 루프백 표기를 정규화', () => {
  const allowedIps = parseAdminAllowedIps('::ffff:192.168.0.2,0:0:0:0:0:0:0:1');
  assert.ok(isAllowedAdminRequest(request('192.168.0.2'), allowedIps));
  assert.ok(isAllowedAdminRequest(request('::1'), allowedIps));
});

test('HTTP 연결에서 모든 관리자 경로의 IP 제한과 공개 경로 유지', async () => {
  let allowedIps = parseAdminAllowedIps('127.0.0.1');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    res.writeHead(isAdminPath(path) && !isAllowedAdminRequest(req, allowedIps) ? 403 : 200);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const status = (path: string, headers?: IncomingHttpHeaders) => new Promise<number | undefined>((resolve, reject) => {
      get(base + path, { headers }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    const paths = ['/admin', '/%61dmin', '/admin/nested', '/api/admin', '/api/admin/refresh', '/api/admin/logs'];
    for (const path of paths) {
      assert.equal(await status(path), 200);
      assert.equal(await status(path, { host: 'calendar.example' }), 200);
    }
    allowedIps = parseAdminAllowedIps('192.168.0.2');
    for (const path of paths) {
      assert.equal(await status(path, { 'x-forwarded-for': '192.168.0.2', forwarded: 'for=192.168.0.2' }), 403);
    }
    assert.equal(await status('/api/calendar', { host: 'external.example' }), 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
