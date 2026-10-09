import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl } from '../src/utils/api';

test('로컬 상대 경로와 배포 서버의 관리자·달력·로그 주소 연결', () => {
  for (const path of ['/api/calendar', '/api/admin', '/api/admin/refresh', '/api/admin/logs?game=genshin&page=2']) {
    assert.equal(apiUrl(path, ''), path);
    assert.equal(apiUrl(path, ' https://api.example.com/ '), `https://api.example.com${path}`);
  }
  assert.equal(apiUrl('/api/calendar', 'http://localhost:5173'), 'http://localhost:5173/api/calendar');
  for (const base of ['ftp://example.com', 'https://user:pass@example.com', 'https://example.com/api', 'https://example.com?query=1']) {
    assert.throws(() => apiUrl('/api/calendar', base));
  }
});
