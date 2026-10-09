import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWuwaStructuredCalendar, parseEndfieldEvents, parseEndfieldBoundary, buildVersionEvents } from '../src/features/collection';

const sourceUrl = 'https://example.com/source';
const cover = 'https://web-static.hg-cdn.com/upload/image/banner.jpg';
const boundary = { version: '시험 버전', maintenanceStart: '2026-09-01T22:00:00.000Z', startAt: '2026-09-02T04:00:00.000Z',
  endAt: '2026-10-14T22:00:00.000Z', sourceUrl };
const wuwa = (tabImg: unknown) => parseWuwaStructuredCalendar({ servers: [{ label: 'Asia', utc: '+8' }], list: [{ id: 2, child: [{
  id: 100700044, title: '흩날리는 선율', tabImg, time: [['2026-11-04T04:00:00+08:00', '2026-11-11T03:59:59.999+08:00']],
}] }] }, { versions: [] }, sourceUrl, {}, 'ko-kr', Date.parse('2026-10-09T00:00:00+09:00')).events[0];

test('명조 리소스 경로를 실제 CDN의 AVIF 주소로 변환하고 완성 URL 보존', () => {
  assert.deepEqual(wuwa('UiActivity/Image/ActivityTabIcon/T_ActivityTab_14')?.imageUrls,
    ['https://static-cloudflare-f8p1t7z8.wutheringwaves.wiki/transform/kuro/gameclient/Content/Aki/UI/UIResources/UiActivity/Image/ActivityTabIcon/T_ActivityTab_14.avif']);
  assert.deepEqual(wuwa(cover)?.imageUrls, [cover]);
  for (const path of ['../secret', 'UiActivity/../secret', '//example.com/image', 'javascript:alert(1)', undefined]) {
    const event = wuwa(path);
    assert.ok(event);
    assert.equal(event.imageUrls, undefined);
  }
});

test('엔드필드 개별 이벤트와 묶인 재구축 픽업 공지에 표지 연결', () => {
  const event = parseEndfieldEvents({ id: '1', title: '「시험」 이벤트', imageUrl: cover,
    content: '<p>▼//이벤트 기간</p><p>2026/10/01 12:00 ~ 2026/10/15 04:00(서버 시간)</p>' }, [boundary]);
  assert.deepEqual(event.events[0]?.imageUrls, [cover]);
  const banners = parseEndfieldEvents({ id: '2', title: '「찬란한 색채」 재구축 헤드헌팅#1 및 「점묘 신청」 재구축 신청#1 개방', imageUrl: cover,
    content: '<p>▼//개방 시간</p><p>2026/09/24 12:00(서버 시간) ~ 버전 업데이트 점검 전</p>' }, [boundary]);
  assert.equal(banners.events.length, 2);
  assert.ok(banners.events.every((item) => item.imageUrls?.[0] === cover));
});

test('엔드필드 종합 업데이트 표지는 버전에만 연결하고 개별 이벤트에 전파하지 않음', () => {
  const article = { id: '3', title: '「시험 버전」 버전 업데이트 설명', imageUrl: cover,
    content: '<p>Asia 서버: 2026/09/02 06:00 ~ 2026/09/02 12:00(UTC+8)</p>'
      + '<p>1. 「시험」 이벤트</p><p>· 이벤트 기간: 2026/10/01 12:00 ~ 2026/10/15 04:00(서버 시간)</p>' };
  const parsedBoundary = parseEndfieldBoundary(article);
  assert.ok(parsedBoundary);
  assert.deepEqual(buildVersionEvents('endfield', [parsedBoundary])[0]?.imageUrls, [cover]);
  assert.equal(parseEndfieldEvents(article, [boundary]).events[0]?.imageUrls, undefined);
});
