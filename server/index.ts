import './env';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { getAdminCalendar, getCalendar } from './calendar-service';
import { isAdminAction } from '../shared/admin';
import { saveAdminAction } from './admin-store';
import { rememberKoreanNames } from '../src/features/collection';
import { parseAdminAllowedIps } from './admin-access';
import { checkRequestAccess, parseAllowedOrigins } from './request-access';
import { startCollectionRuntime, stopCollectionRuntime, collectionLogPage } from './collection-runtime';

const isProduction = process.argv.includes('--production');
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';
const access = {
  adminAllowedIps: parseAdminAllowedIps(process.env.ADMIN_ALLOWED_IPS),
  trustedProxyIps: parseAdminAllowedIps(process.env.TRUSTED_PROXY_IPS, 'TRUSTED_PROXY_IPS'),
  allowedOrigins: parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
};
const vite = isProduction ? undefined : await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
const mimeTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!checkRequestAccess(request, response, pathname, access)) return;
    if (pathname === '/api/admin/logs') {
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(collectionLogPage(new URL(request.url ?? '/', 'http://localhost').searchParams)));
      return;
    }
    if (pathname === '/api/admin' || pathname === '/api/admin/refresh') {
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(value));
      };
      if (request.method === 'GET' && pathname === '/api/admin') { send(200, await getAdminCalendar()); return; }
      if (request.method !== 'POST') { response.writeHead(405, { Allow: pathname === '/api/admin' ? 'GET, POST' : 'POST' }); response.end(); return; }
      if (pathname === '/api/admin/refresh') { send(200, await getAdminCalendar(true)); return; }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        length += buffer.length;
        if (length > 65536) { send(413, { message: '입력 내용이 너무 큽니다.' }); return; }
        chunks.push(buffer);
      }
      let action: unknown;
      try { action = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(400, { message: '입력 형식을 확인해 주세요.' }); return; }
      if (!isAdminAction(action)) { send(400, { message: '제목, 출처 URL, 시작·종료 시간을 확인해 주세요.' }); return; }
      const current = await getAdminCalendar();
      const resetEvent = action.action === 'reset' ? current.management.overrides[action.id]?.event : undefined;
      await saveAdminAction(action, current.collectedEvents);
      try {
        if (action.action === 'save' && !action.hidden && action.event.localizationKey) await rememberKoreanNames(action.event.game, [action.event]);
        else if (resetEvent?.localizationKey) await rememberKoreanNames(resetEvent.game, [], resetEvent.localizationKey);
      } catch (error) { console.error('Korean name update failed', error); }
      send(200, await getAdminCalendar());
      return;
    }
    if (pathname === '/api/calendar') {
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
      const calendar = await getCalendar();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(calendar));
      return;
    }
    if (pathname.startsWith('/api/')) { response.writeHead(404); response.end(); return; }
    if (vite) { vite.middlewares(request, response); return; }
    const root = resolve('dist');
    const file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    const target = extname(file) ? file : resolve(root, 'index.html');
    try {
      const contents = await readFile(target);
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(target)] ?? 'application/octet-stream' });
      response.end(contents);
    } catch { response.writeHead(404); response.end('찾을 수 없는 페이지입니다.'); }
  } catch (error) {
    console.error('Request failed', error);
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: '요청을 처리하지 못했습니다.' }));
  }
});
await startCollectionRuntime();
server.listen(port, host, () => console.info(`Server: http://${host.includes(':') ? `[${host}]` : host}:${port}`));
const shutdown = () => { server.close(); void vite?.close(); void stopCollectionRuntime(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
