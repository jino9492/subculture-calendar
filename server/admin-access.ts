import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export const isAdminPath = (pathname: string): boolean => pathname === '/admin' || pathname.startsWith('/admin/')
  || pathname === '/api/admin' || pathname.startsWith('/api/admin/');

const normalizeIp = (address: string): string | undefined => {
  if (address.includes('%')) return undefined;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return undefined;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  // IPv4 매핑 IPv6 주소를 IPv4 목록과 동일하게 비교
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
};

export const parseAdminAllowedIps = (value: string | undefined): ReadonlySet<string> => {
  const addresses = new Set<string>();
  for (const entry of value?.split(',') ?? []) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const address = normalizeIp(trimmed);
    if (!address) throw new Error(`ADMIN_ALLOWED_IPS에 올바르지 않은 IP가 있습니다: ${trimmed}`);
    addresses.add(address);
  }
  return addresses;
};

export const isAllowedAdminRequest = (request: Pick<IncomingMessage, 'socket'>, allowedIps: ReadonlySet<string>): boolean => {
  const address = request.socket.remoteAddress;
  const normalized = address ? normalizeIp(address) : undefined;
  return normalized !== undefined && allowedIps.has(normalized);
};
