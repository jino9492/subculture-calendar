import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoyoCalendar, parseEndfieldEvents, parseStructuredActivities, mergeScheduleSources, buildVersionEvents, supplementStructuredVersion } from '../src/features/collection';

const source = 'https://example.com/calendar';
const boundary = { version: '시험 버전', maintenanceStart: '2026-09-01T22:00:00.000Z', startAt: '2026-09-02T04:00:00.000Z',
  endAt: '2026-10-14T22:00:00.000Z', sourceUrl: source, endSourceUrl: 'https://starrailassistant.top/api/v1/activity/end-en-US.json' };

test('스타레일 엔드콘텐츠 종류와 시즌 부제를 함께 표시하고 공백 정규화', () => {
  const types = ['ChallengeTypeBoss', 'ChallengeTypeChasm', 'ChallengeTypeStory', 'ChallengeTypePeak'];
  const result = parseHoyoCalendar('starrail', { banners: [], events: [], challenges: types.map((type_name, id) => ({ id, type_name,
    name: '시즌\u00a0부제', start_time: 1790740800, end_time: 1790900000 })) }, source);
  assert.deepEqual(result.events.map((event) => event.title), ['종말의 환영 · 시즌 부제', '혼돈의 기억 · 시즌 부제', '허구 이야기 · 시즌 부제', '이상 중재 · 시즌 부제']);
});

test('저장된 한국어 콘텐츠 이름을 영어 응답에 적용해도 종류를 중복 추가하지 않음', () => {
  const result = parseHoyoCalendar('starrail', { banners: [], events: [], challenges: [{ id: 1, type_name: 'ChallengeTypeBoss',
    name: '종말의 환영 · 시즌 부제', localized: true, start_time: 1790740800, end_time: 1790900000 }] }, source, 'en-us');
  assert.equal(result.events[0]?.title, '종말의 환영 · 시즌 부제');
});

test('누락된 천사 이벤트를 원본 구조화 기간과 공식 한국어 이름으로 보완', () => {
  const result = parseStructuredActivities({ activities: [{ name: 'Angels Support Operation', startTime: '2026-09-09T11:00:00', endTime: '2026-11-30T03:59:59' }] }, source);
  assert.equal(result.events[0]?.title, '천사 응원하기 대작전');
  assert.equal(result.events[0]?.startAt, '2026-09-09T03:00:00.000Z');
  assert.equal(result.events[0]?.endAt, '2026-11-29T19:59:59.000Z');
  assert.equal(result.events[0]?.displayLanguage, 'ko-kr');
  assert.equal(result.issues.length, 0);
  const translated = result.events[0];
  assert.ok(translated);
  const native = { ...translated, id: 'native', sourceLanguage: 'ko-kr', endAt: '2026-11-29T19:59:00.000Z' };
  const merged = mergeScheduleSources([native], result.events);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, native.id);
  assert.equal(merged[0]?.endAt, native.endAt);
  assert.equal(merged[0]?.collectionSources?.length, 2);
});

test('알 수 없는 원본 이름은 추측해 번역하지 않고 관리자 확인 대상으로 표시', () => {
  const result = parseStructuredActivities({ activities: [{ name: 'New Unknown Event', startTime: '2099-01-01T11:00:00', endTime: '2099-01-08T03:59:59' }] }, source);
  assert.equal(result.events.length, 1);
  assert.equal(result.issues[0]?.eventId, result.events[0]?.id);
  assert.equal(result.issues.length, 1);
  assert.equal(parseStructuredActivities({ activities: [{ name: 'Angels Support Operation', startTime: '2026-02-30T11:00:00', endTime: '2026-11-30T03:59:59' }] }, source).events.length, 0);
});

test('엔드필드 원본 종료를 이벤트 파싱 전에 연결해 상대 종료와 전체 버전 기간 처리', () => {
  const { endAt: omittedEnd, ...initialBoundary } = boundary;
  assert.ok(omittedEnd);
  const version = supplementStructuredVersion(buildVersionEvents('endfield', [initialBoundary]), {
    version: '1.6', startTime: '2026-09-02T06:00:00', endTime: '2026-10-15T06:00:00', activities: [],
  }, boundary.endSourceUrl, 'endfield')[0];
  assert.ok(version);
  const result = parseEndfieldEvents({ id: 'summary', title: '「시험 버전」 업데이트', content:
    '<p>1. 「찬란한 색채」 재구축 헤드헌팅#1</p><p>· 개방 기간: 2026/09/24 12:00(서버 시간) ~ 버전 업데이트 전까지</p>'
    + '<p>2. 스토리 이벤트 「겨울꿈」</p><p>· 이벤트 기간: 「시험 버전」 버전 기간</p>' }, [{ ...initialBoundary, endAt: version.endAt }]);
  assert.equal(result.skipped, 0);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0]?.kind, 'banner');
  assert.equal(result.events[0]?.endAt, version.endAt);
  assert.equal(result.events[1]?.startAt, boundary.startAt);
});

test('출석 체크 제목을 앞 이벤트 이름으로 잘못 연결하지 않음', () => {
  const result = parseEndfieldEvents({ id: 'summary', title: '「시험 버전」 업데이트', content:
    '<p>7. 「옛 도시의 종소리」 이벤트</p><p>· 이벤트 기간: 2026/09/24 12:00 ~ 버전 업데이트 전까지</p>'
    + '<p>8. 「능수도에 스미는 가을」 기간 한정 출석 체크</p><p>· 이벤트 기간: 2026/10/01 12:00 ~ 버전 업데이트 전까지</p>' }, [boundary]);
  assert.deepEqual(result.events.map((event) => event.title), ['「옛 도시의 종소리」 이벤트', '「능수도에 스미는 가을」 기간 한정 출석 체크']);
});

test('개방 시간 헤더와 점검 전 문구를 읽고 묶인 재구축 캐릭터·무기 픽업 분리', () => {
  const result = parseEndfieldEvents({ id: '3839', title: '「찬란한 색채」 재구축 헤드헌팅#1 및 「점묘 신청」 재구축 신청#1 개방', content:
    '<p>「찬란한 색채」 재구축 헤드헌팅#1 개방 기간, 6성 오퍼레이터 획득 확률이 증가합니다!</p>'
    + '<p>「점묘 신청」 재구축 신청#1 개방 기간, 6성 무기 획득 확률이 증가합니다!</p>'
    + '<p>▼//개방 시간</p><p>2026/09/24 12:00(서버 시간) ~ 버전 업데이트 점검 전</p>' }, [boundary]);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.events.map((event) => event.title), ['「찬란한 색채」 재구축 헤드헌팅#1', '「점묘 신청」 재구축 신청#1']);
  assert.ok(result.events.every((event) => event.kind === 'banner' && event.endAt === boundary.endAt));
});

test('웹 이벤트 접속 링크와 본문 설명을 일정 제목으로 사용하지 않음', () => {
  const result = parseEndfieldEvents({ id: 'web', title: '「프로토콜의 초대: 귀환」 웹 이벤트', content:
    '<p>&gt;&gt;「프로토콜의 초대: 귀환」 웹 이벤트로 이동하기&lt;&lt;</p>'
    + '<p>▼//이벤트 기간</p><p>2026/10/01 12:00 ~ 2026/10/15 04:00(서버 시간)</p>' }, [boundary]);
  assert.equal(result.events[0]?.title, '「프로토콜의 초대: 귀환」 웹 이벤트');
});

test('상시 스테이지 개방과 함께 열리는 기간 한정 보상 이벤트를 구분', () => {
  const result = parseEndfieldEvents({ id: 'summary', title: '「시험 버전」 업데이트', content:
    '<p>2. 「그림자 이정표」 도전 콘텐츠 업데이트, 「그림자 형상 각인」 시리즈 스테이지 개방</p>'
    + '<p>· 개방 시간: 2026/10/05 12:00(서버 시간)</p>'
    + '<p>콘텐츠 업데이트 후, 「기억의 흔적 · 그림자 각인」 기간 한정 도전 이벤트가 함께 개방됩니다.</p>'
    + '<p>· 이벤트 기간: 2026/10/05 12:00 ~ 2026/10/19 04:00(서버 시간)</p>' }, [boundary]);
  assert.equal(result.skipped, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.title, '「기억의 흔적 · 그림자 각인」 이벤트');
});

test('콜론 없는 이벤트 기간을 읽되 조건부 무기 픽업 종료는 추정하지 않음', () => {
  const parsed = parseEndfieldEvents({ id: '7013', title: '「융합! 버블!」 웹 이벤트', content:
    '<p>▼//이벤트 기간</p><p>2026/10/01 12:00(서버 시간) ~ 버전 업데이트 전까지</p>' }, [boundary]);
  assert.equal(parsed.events[0]?.endAt, boundary.endAt);
  const conditional = parseEndfieldEvents({ id: 'summary', title: '「시험 버전」 업데이트', content:
    '<p>「한기 신청」 무기고 신청 개방</p><p>· 개방 기간: 버전 업데이트 후 개방, 특별 허가 헤드헌팅 3회 진행 후 종료</p>' }, [boundary]);
  assert.equal(conditional.events.length, 0);
  assert.equal(conditional.skipped, 1);
});
