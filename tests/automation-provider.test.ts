import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGame } from '../src/features/collection';

test('엔드필드 신규 제목·21번째 이후 공지·4번째 페이지를 실제 수집 흐름에서 처리', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const news = Array.from({ length: 61 }, (_, index) => ({ cid: String(index + 1), title: `「새 보급 ${index + 1}」 특별 보급`, displayTime: Math.floor(Date.now() / 1000) }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.href);
    if (url.pathname.includes('/activity/')) return Response.json({ version: '99.1', startTime: '2099-01-01T06:00:00', endTime: '2099-02-12T06:00:00', activities: [] });
    if (url.pathname === '/api/bulletin') {
      const page = Number(url.searchParams.get('page'));
      return Response.json({ code: 0, data: { list: news.slice((page - 1) * 20, page * 20), total: news.length } });
    }
    const id = /\/api\/bulletin\/(\d+)$/.exec(url.pathname)?.[1];
    if (id) return Response.json({ code: 0, data: { data: '<p>· 이벤트 기간: 2099/01/01 11:00 ~ 2099/01/15 11:00(서버 시간)</p>' } });
    throw new Error(`Unexpected fixture request: ${url.href}`);
  };
  try {
    const result = await fetchGame('endfield');
    assert.equal(result.events.length, 61);
    assert.equal(new Set(result.events.map((event) => event.id)).size, 61);
    assert.equal(requests.filter((url) => url.includes('page=')).length, 4);
    assert.ok(result.events.some((event) => event.title === '「새 보급 61」 특별 보급'));
    assert.equal(result.skipped, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
