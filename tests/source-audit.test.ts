import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoyoAnnouncementUrl, parseHoyoAnnouncements, supplementHoyoCalendar, parseHoyoCalendar, parseEndfieldEvents, parseWuwaKoreanEvents } from '../src/features/collection';

const announcement = (title: string, content: string, id = 1) => parseHoyoAnnouncements({ retcode: 0, data: { list: [{ ann_id: id, lang: 'ko-kr', title, content }] } }, 'https://example.com/ann');

test('HoYo 공개 공지는 한국어·아시아 서버로 요청하고 잘못된 응답 거부', () => {
  for (const game of ['genshin', 'starrail', 'zenless'] as const) {
    const url = hoyoAnnouncementUrl(game);
    assert.equal(url.searchParams.get('lang'), 'ko-kr');
    assert.equal(url.searchParams.get('uid'), '0');
    assert.ok(url.searchParams.get('region')?.includes(game === 'zenless' ? 'jp' : 'asia'));
  }
  assert.throws(() => parseHoyoAnnouncements({ retcode: -100 }, 'https://example.com'));
  assert.equal(parseHoyoAnnouncements({ retcode: 0, data: { list: [{ ann_id: 1, lang: 'en-us', title: 'English', content: 'text' }] } }, 'https://example.com').length, 0);
});

test('인게임 공지의 인코딩된 서버 시간으로 기간 0 이벤트 보완', () => {
  const parsed = parseHoyoCalendar('genshin', { events: [{ id: 1, name: '격투 모드: 자동 대전', start_time: 0, end_time: 0 }], banners: [], challenges: [] }, 'https://example.com/calendar');
  const articles = announcement('「일곱 성인의 소환」 격투 모드: 자동 대전', '<p>〓이벤트 기간〓</p><p>&lt;t class="t_lc"&gt;2026/10/10 10:00&lt;/t&gt; ~ &lt;t class="t_lc"&gt;2026/10/26 03:59&lt;/t&gt;</p>');
  const result = supplementHoyoCalendar('genshin', parsed, articles, []);
  assert.equal(result.skipped, 0);
  assert.equal(result.issues.length, 0);
  assert.equal(result.events[0]?.startAt, '2026-10-10T02:00:00.000Z');
  assert.equal(result.events[0]?.endAt, '2026-10-25T19:59:00.000Z');
  assert.equal(result.events[0]?.title, '격투 모드: 자동 대전');
});

test('예정 픽업 여러 개를 추가하고 구조화 API에 있는 기간은 중복 보완 제외', () => {
  const period = '<p>기원 기간</p><p>2026/10/13 18:00 ~ 2026/11/03 14:59</p>';
  const articles = [...announcement('「첫 기원」 기원: 캐릭터', period, 1), ...announcement('「둘째 기원」 기원: 캐릭터', period, 2), ...announcement('「신의 주조」 기원: 무기', period, 3)];
  const empty = { events: [], issues: [], skipped: 0 };
  const result = supplementHoyoCalendar('genshin', empty, articles, []);
  assert.equal(result.events.length, 3);
  assert.equal(supplementHoyoCalendar('genshin', result, articles, []).events.length, 3);
  const first = result.events[0];
  assert.ok(first);
  assert.equal(supplementHoyoCalendar('genshin', { ...empty, events: [first] }, articles, []).events.length, 3);
});

test('공지 게시 기간·보상 기간·이미지·확인되지 않은 상대 시작을 일정 기간으로 오인하지 않음', () => {
  for (const content of ['<p>게시 기간: 2026/10/10 10:00 ~ 2026/10/26 03:59</p>',
    '<p>〓이벤트 보상〓</p><p>2026/10/10 10:00 ~ 2026/10/26 03:59</p>',
    '<p>〓이벤트 기간〓</p><img src="https://example.com/date.png">',
    '<p>〓이벤트 기간〓</p><p>7.1 버전 업데이트 후 ~ 2026/10/26 03:59</p>']) {
    assert.equal(supplementHoyoCalendar('genshin', { events: [], issues: [], skipped: 0 }, announcement('「시험」 이벤트', content), []).events.length, 0);
  }
});

test('지맥 제압전은 기간 한정 이벤트로 분류', () => {
  const result = parseHoyoCalendar('genshin', { events: [{ id: 1, name: '지맥 제압전', type_name: 'ActTypeHardChallenge', start_time: 1790740800, end_time: 1790900000 }], banners: [], challenges: [] }, 'https://example.com/calendar');
  assert.equal(result.events[0]?.kind, 'event');
});

test('엔드필드 개별 공지 본문의 버전과 상대 시작 연결', () => {
  const boundary = { version: '시험', startAt: '2026-09-02T04:00:00.000Z', maintenanceStart: '2026-09-01T22:00:00.000Z', sourceUrl: 'https://example.com/start' };
  const result = parseEndfieldEvents({ id: '1', title: '「시험 픽업」 특별 허가 헤드헌팅', content: '<p>· 개방 기간: 「시험」 버전 업데이트 후 ~ 2026/09/24 11:59(서버 시간)</p>' }, [boundary]);
  assert.equal(result.events[0]?.startAt, boundary.startAt);
  assert.equal(result.events[0]?.endAt, '2026-09-24T03:59:00.000Z');
});

test('엔드필드 상대 종료는 다음 점검 공지가 있을 때만 연결', () => {
  const next = { version: '다음', startAt: '2026-09-02T04:00:00.000Z', maintenanceStart: '2026-09-01T22:00:00.000Z', sourceUrl: 'https://example.com/next' };
  const article = { id: '1', title: '「시험」 이벤트', content: '<p>· 이벤트 기간: 2026/08/09 12:00(서버 시간) ~ 버전 업데이트 전까지</p>' };
  assert.equal(parseEndfieldEvents(article, []).skipped, 1);
  const result = parseEndfieldEvents(article, [next]);
  assert.equal(result.events[0]?.endAt, next.maintenanceStart);
  assert.ok(result.events[0]?.description.includes(next.sourceUrl));
});

test('명조 이미지 전용 엔드콘텐츠 공지를 누락 확인 대상으로 기록', () => {
  const result = parseWuwaKoreanEvents({ id: '1', title: '「종말 매트릭스」의 새로운 도전 주기 안내', content: '<img src="https://example.com/period.png">' }, []);
  assert.equal(result.events.length, 0);
  assert.equal(result.skipped, 1);
});

test('엔드필드 이벤트 설명을 다음 일정 제목으로 사용하지 않음', () => {
  const result = parseEndfieldEvents({ id: '1', title: '버전 안내', content: '<p>1. 「이성 보급」 기간 한정 이벤트</p><p>· 이벤트 설명: 「이전 행사」 이벤트 안내</p><p>■ 이벤트 기간:</p><p>2026/10/08 04:00 ~ 2026/10/15 04:00</p>' }, []);
  assert.equal(result.events[0]?.title, '「이성 보급」 기간 한정 이벤트');
});
