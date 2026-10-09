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

test('무기 공지가 먼저 수집되어도 캐릭터 세 회차와 연결하고 재구축은 제외', async () => {
  const originalFetch = globalThis.fetch;
  const articles = [
    { cid: '1', title: '「신규 무기 신청」 기간 한정 판매 설명', content:
      '<p>▼//「신규 무기 신청」</p><p>· 개방 기간: 2099/01/01 12:00 개방, 「특별 허가 헤드헌팅」 3회 진행 후 종료(「첫 픽업」부터 집계)</p>' },
    ...['첫 픽업', '두 번째 픽업', '세 번째 픽업'].map((name, index) => ({ cid: String(index + 2),
      title: `「${name}」 특별 허가 헤드헌팅`, content:
        `<p>· 개방 기간: 2099/0${index + 1}/01 12:00 ~ 2099/0${index + 2}/01 11:59(서버 시간)</p>` })),
    { cid: '5', title: '「재구축 캐릭터」 재구축 헤드헌팅#1', content:
      '<p>· 개방 기간: 2099/01/15 12:00 ~ 2099/02/15 11:59(서버 시간)</p>' },
  ];
  let publishedCount = articles.length;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/activity/')) return Response.json({ version: '99.1', startTime: '2099-01-01T06:00:00', endTime: '2099-02-12T06:00:00', activities: [] });
    if (url.pathname === '/api/bulletin') return Response.json({ code: 0, data: {
      list: articles.slice(0, publishedCount).map((article) => ({ ...article, displayTime: Math.floor(Date.now() / 1000) })), total: publishedCount } });
    const article = articles.find((item) => url.pathname === `/api/bulletin/${item.cid}`);
    if (article) return Response.json({ code: 0, data: { data: article.content } });
    throw new Error(`Unexpected fixture request: ${url.href}`);
  };
  try {
    publishedCount = 2;
    const estimated = await fetchGame('endfield');
    const pendingWeapon = estimated.events.find((event) => event.title === '「신규 무기 신청」 무기고 신청');
    assert.ok(pendingWeapon);
    assert.equal(pendingWeapon.periodBasis, 'community-cycle');
    assert.equal(pendingWeapon.endAt, '2099-04-04T03:59:00.000Z');
    assert.ok(estimated.issues.some((issue) => issue.eventId === pendingWeapon.id));
    publishedCount = articles.length;
    const confirmed = await fetchGame('endfield');
    const weapon = confirmed.events.find((event) => event.id === pendingWeapon.id);
    assert.equal(weapon?.endAt, '2099-04-01T03:59:00.000Z');
    assert.equal(weapon?.periodBasis, undefined);
    assert.equal(confirmed.skipped, 0);
    assert.equal(confirmed.issues.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
