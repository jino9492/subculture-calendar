import type { IncomingMessage, ServerResponse } from 'node:http';
import { getClientIp, isAdminPath, isAllowedAdminRequest, isTrustedProxy } from './admin-access';

export interface RequestAccess {
  adminAllowedIps: ReadonlySet<string>;
  trustedProxyIps: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
}

export const parseAllowedOrigins = (value: string | undefined): ReadonlySet<string> => {
  const origins = new Set<string>();
  for (const entry of value?.split(',') ?? []) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    let url: URL;
    try { url = new URL(trimmed); }
    catch { throw new Error('CORS_ALLOWED_ORIGINS에 올바른 HTTP 또는 HTTPS 출처를 지정해 주세요.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('CORS_ALLOWED_ORIGINS에 경로 없이 HTTP 또는 HTTPS 출처를 지정해 주세요.');
    }
    origins.add(url.origin);
  }
  return origins;
};

const isAllowedOrigin = (request: IncomingMessage, access: RequestAccess): boolean => {
  const origin = request.headers.origin;
  if (!origin || origin === 'null') return false;
  if (access.allowedOrigins.has(origin)) return true;
  const protocol = isTrustedProxy(request, access.trustedProxyIps) ? request.headers['x-forwarded-proto'] : 'http';
  return (protocol === 'http' || protocol === 'https') && origin === `${protocol}://${request.headers.host}`;
};

const apiMethods = (pathname: string): string[] | undefined => {
  if (pathname === '/api/calendar' || pathname === '/api/admin/logs') return ['GET'];
  if (pathname === '/api/admin') return ['GET', 'POST'];
  if (pathname === '/api/admin/refresh') return ['POST'];
  return undefined;
};

export const checkRequestAccess = (request: IncomingMessage, response: ServerResponse, pathname: string, access: RequestAccess): boolean => {
  const deny = (status: number, message: string): false => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ message }));
    return false;
  };
  const origin = request.headers.origin;
  if (pathname.startsWith('/api/')) {
    response.setHeader('Vary', 'Origin');
    if (origin) {
      if (!isAllowedOrigin(request, access)) return deny(403, '허용된 사이트에서 요청해 주세요.');
      response.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  const admin = isAdminPath(pathname);
  if (admin) {
    response.setHeader('Cache-Control', 'no-store');
    if (!isAllowedAdminRequest(request, access.adminAllowedIps, access.trustedProxyIps)) {
      console.warn(`관리자 접근 차단: 접속 IP=${getClientIp(request, access.trustedProxyIps) ?? '알 수 없음'}`);
      return deny(403, '관리자 페이지는 허용된 IP에서만 접근할 수 있습니다.');
    }
  }
  if (!pathname.startsWith('/api/')) return true;
  if (request.method === 'OPTIONS') {
    if (!origin) return deny(403, '허용된 사이트에서 요청해 주세요.');
    const methods = apiMethods(pathname);
    if (!methods) return deny(404, '찾을 수 없는 API입니다.');
    const requestedMethod = request.headers['access-control-request-method'];
    const requestedHeaders = request.headers['access-control-request-headers'];
    if (typeof requestedMethod !== 'string' || !methods.includes(requestedMethod)
      || (requestedHeaders !== undefined && (typeof requestedHeaders !== 'string'
        || requestedHeaders.split(',').some((header) => header.trim().toLowerCase() !== 'content-type')))) {
      return deny(403, '허용되지 않은 요청 방식입니다.');
    }
    response.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Cache-Control', 'no-store');
    response.writeHead(204);
    response.end();
    return false;
  }
  if (admin && request.method === 'POST' && (!isAllowedOrigin(request, access)
    || request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')) {
    return deny(403, '관리 페이지에서 JSON 형식으로 요청해 주세요.');
  }
  return true;
};
