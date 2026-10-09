import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEndfieldBoundary, parseEndfieldEvents, parseEndfieldNewsList, parseWuwaKoreanBoundary, parseWuwaKoreanEvents, selectWuwaEnglishBanners } from '../src/features/collection';
import type { CalendarEvent } from '../shared/calendar';

test('명조 한국어 업데이트의 점검 시간과 상대 시작 이벤트를 한국 시간으로 처리', () => {
  const article = { id: '1', title: '「시험」 3.7 버전 업데이트 내용 안내', content:
    '<p>✦점검 시간: 2026년 9월 30일 05:00 ~ 2026년 9월 30일 12:00</p><p>[시험 축제] 미니 이벤트</p><p>✦이벤트 기간: 3.7 버전 업데이트 후 ~ 2026년 11월 11일 12:59</p>' };
  const boundary = parseWuwaKoreanBoundary(article);
  assert.ok(boundary);
  assert.equal(boundary.startAt, '2026-09-30T03:00:00.000Z');
  const parsed = parseWuwaKoreanEvents(article, [boundary]);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]?.title, '[시험 축제] 미니 이벤트');
  assert.equal(parsed.events[0]?.endAt, '2026-11-11T03:59:00.000Z');
  assert.equal(parsed.events[0]?.sourceLanguage, 'ko-kr');
});

test('명조 한국어 여러 이벤트 제목 구분과 이미지 전용 일정 제외', () => {
  const parsed = parseWuwaKoreanEvents({ id: '2', title: '버전 공지', content:
    '<p>[첫 행사] 이벤트</p><p>✦이벤트 기간: 2026년 10월 8일 05:00 ~ 2026년 10월 26일 04:59</p><p>[다음 행사] 이벤트</p><p>✦이벤트 기간: 2026년 10월 22일 11:00 ~ 2026년 11월 9일 04:59</p>' }, []);
  assert.deepEqual(parsed.events.map((event) => event.title), ['[첫 행사] 이벤트', '[다음 행사] 이벤트']);
  assert.equal(parseWuwaKoreanEvents({ id: '3', title: '이벤트 예고', content: '<img src="https://example.com/a.png" />' }, []).skipped, 1);
});

test('명조 실제 튜닝 공지의 장식 헤더와 업데이트 후·이후 시작 처리', () => {
  const boundary = { version: '3.5', startAt: '2026-07-09T03:00:00.000Z', maintenanceStart: '2026-07-08T20:00:00.000Z', sourceUrl: 'https://example.com' };
  for (const start of ['3.5 버전 업데이트 후', '3.5 버전 업데이트 이후', '2026년 7월 30일 11:00']) {
    const parsed = parseWuwaKoreanEvents({ id: '5238', title: '[노을에 깃든 이슬] 무기 이벤트 튜닝', content:
      `<p>이벤트 기간 동안 5성 무기의 튜닝 확률 한정 UP!</p><p>✦이벤트 기간✦</p><p>${start} ~ 2026년 8월 19일 12:59 (한국 시간)</p><p>✦이벤트 조건✦</p>` }, [boundary]);
    assert.equal(parsed.skipped, 0);
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0]?.kind, 'banner');
    assert.equal(parsed.events[0]?.startAt, start.startsWith('2026') ? '2026-07-30T02:00:00.000Z' : boundary.startAt);
    assert.equal(parsed.events[0]?.endAt, '2026-08-19T03:59:00.000Z');
  }
  const unresolved = parseWuwaKoreanEvents({ id: '5078', title: '[울림에 새겨진 추억] 무기 이벤트 튜닝',
    content: '<p>✦이벤트 기간✦</p><p>3.5 버전 업데이트 후 ~ 2026년 8월 19일 12:59 (한국 시간)</p>' }, []);
  assert.equal(unresolved.events.length, 0);
  assert.equal(unresolved.skipped, 1);
});

test('명조 세 엔드콘텐츠는 명시된 기간만 분류하고 단순 패치 언급은 일정 생성 제외', () => {
  for (const title of ['종말 매트릭스', '역경의 탑', '죽음의 노래와 바닷속 폐허']) {
    const parsed = parseWuwaKoreanEvents({ id: 'endgame', title: `[${title}] 시즌 안내`,
      content: '<p>✦시즌 기간✦</p><p>2026년 10월 8일 05:00 ~ 2026년 10월 26일 04:59</p>' }, []);
    assert.equal(parsed.events[0]?.kind, 'challenge');
    assert.equal(parseWuwaKoreanEvents({ id: 'patch', title: '버전 업데이트', content: `<p>[${title}] 오류 수정</p>` }, []).events.length, 0);
  }
});

test('명조 한국어 픽업 대체는 게시 시각·종류·기간이 일치하는 유일한 공지만 적용', () => {
  const banner = (id: string, title: string): CalendarEvent => ({ id, title, game: 'wuwa', kind: 'banner',
    startAt: '2026-07-30T02:00:00.000Z', endAt: '2026-08-19T03:59:00.000Z', sourceUrl: 'https://example.com', description: '', sourceLanguage: 'en' });
  const korean = banner('kr', '[노을에 깃든 이슬] 무기 이벤트 튜닝');
  const english = banner('en', "[Firstlight's Herald] Featured Weapon Convene");
  const rerun = banner('rerun', '[Everbright Polestar] Featured Weapon Convene');
  const character = banner('character', '[Blessings From Dewy Winds] Featured Resonator Convene');
  const publications = { kr: '2026-07-29 11:05:00', en: '2026-07-29 11:05:00', rerun: '2026-07-29 11:00:00', character: '2026-07-29 11:05:00' };
  assert.deepEqual(selectWuwaEnglishBanners([korean], [english, rerun, character], publications).map((event) => event.id), ['rerun', 'character']);
  assert.equal(selectWuwaEnglishBanners([korean], [english], {}).length, 1);
  assert.equal(selectWuwaEnglishBanners([korean, { ...korean, id: 'duplicate' }], [english], { ...publications, duplicate: publications.kr }).length, 1);
});

test('엔드필드 목록은 공식 직렬화 데이터만 파싱하고 구조 변경 감지', () => {
  const payload = `6:${JSON.stringify(['$', 'component', null, { value: { bulletins: [{ cid: '123', title: '시험 이벤트' }] } }])}`;
  const html = `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
  assert.deepEqual(parseEndfieldNewsList(html), [{ id: '123', title: '시험 이벤트' }]);
  assert.throws(() => parseEndfieldNewsList('<html>no data</html>'));
});

test('엔드필드 한국어 공지는 Asia UTC+8을 사용하고 Americas 날짜를 제외', () => {
  const article = { id: '4', title: '「시험 버전」 버전 업데이트 설명', content:
    '<p>Asia 서버: 2026/09/02 06:00 ~ 2026/09/02 12:00(UTC+8)</p><p>1. 「시험 보급」 기간 한정 이벤트</p><p>■ 이벤트 기간:</p><p>Asia 서버:</p><p>2026/09/17 04:00 ~ 2026/09/24 04:00(서버 시간)</p><p>2026/10/08 04:00 ~ 2026/10/15 04:00(서버 시간)</p><p>Americas / Europe 서버:</p><p>2026/10/08 04:00 ~ 2026/10/14 17:00(서버 시간)</p>' };
  const boundary = parseEndfieldBoundary(article);
  assert.ok(boundary);
  assert.equal(boundary.startAt, '2026-09-02T04:00:00.000Z');
  const parsed = parseEndfieldEvents(article, [boundary]);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[1]?.startAt, '2026-10-07T20:00:00.000Z');
  assert.equal(parsed.events[1]?.endAt, '2026-10-14T20:00:00.000Z');
});

test('엔드필드 명시된 상대 시작 연결과 미확정 종료 추정 방지', () => {
  const article = { id: '5', title: '「시험 버전」 버전 업데이트 설명', content:
    '<p>Asia 서버: 2026/09/02 06:00 ~ 2026/09/02 12:00(UTC+8)</p><p>1. 「첫 축제」 이벤트</p><p>· 이벤트 기간: 「시험 버전」 버전 업데이트 후 ~ 2026/10/15 04:00(서버 시간)</p><p>2. 「미정」 이벤트</p><p>· 이벤트 기간: 2026/10/08 04:00(서버 시간) ~ 버전 업데이트 전까지</p>' };
  const boundary = parseEndfieldBoundary(article);
  assert.ok(boundary);
  const parsed = parseEndfieldEvents(article, [boundary]);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.skipped, 1);
});
