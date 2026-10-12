import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_IDS, isCalendarEvent } from '../shared/calendar';
import { GAMES } from '../src/features/calendar/utils/games';
import { migrateFilterPreferences } from '../src/features/calendar/utils/filterPreferences';
import { parseHonkaiNews, parseHonkaiPost, parseHonkaiSchedules, type HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { formatEventStart, formatEventEnd } from '../src/features/calendar/utils/calendar';
import { parseHonkaiCafeList, parseHonkaiCafeArticle } from '../src/features/collection/honkai/cafe';

const article = (overrides: Partial<HonkaiArticle> = {}): HonkaiArticle => ({ id: '123', title: '「시험」 이벤트 안내',
  description: '【이벤트 기간】\n10월 12일 10:00 ~ 10월 19일 04:00',
  url: 'https://www.hoyolab.com/article/123', createdAt: Date.parse('2026-10-10T03:00:00Z') / 1000, ...overrides });

test('붕괴3rd는 게임 목록 첫 항목이며 기존 전체 선택만 자동 확장', () => {
  assert.equal(GAME_IDS[0], 'honkai'); assert.equal(GAMES.honkai.name, '붕괴3rd');
  const existing = GAME_IDS.filter((game) => game !== 'honkai');
  assert.deepEqual(migrateFilterPreferences({ games: existing, kinds: ['challenge'] }, 3), { games: [...GAME_IDS], kinds: ['challenge'] });
  assert.deepEqual(migrateFilterPreferences({ games: [], kinds: [] }, 3), { games: [], kinds: [] });
  assert.deepEqual(migrateFilterPreferences({ games: ['wuwa'], kinds: ['banner'] }, 3), { games: ['wuwa'], kinds: ['banner'] });
  assert.deepEqual(migrateFilterPreferences({ games: ['genshin', 'starrail', 'zenless', 'wuwa'], kinds: ['challenge'] }, 1),
    { games: [...GAME_IDS], kinds: ['challenge', 'weekly'] });
});

test('붕괴3rd 한국 서버 시각과 보급·초 단위·연말 전환', () => {
  const event = parseHonkaiSchedules([article()]).events[0]!;
  assert.equal(event.startAt, '2026-10-12T01:00:00.000Z'); assert.equal(event.endAt, '2026-10-18T19:00:00.000Z');
  assert.ok(isCalendarEvent(event));
  const banner = parseHonkaiSchedules([article({ title: '캐릭터 보급 안내', createdAt: Date.parse('2026-12-20T00:00:00Z') / 1000,
    description: '【보급 기간】\n12월 31일 12:00:01 ~ 1월 7일 04:00:59' })]).events[0]!;
  assert.equal(banner.kind, 'banner'); assert.equal(banner.endAt, '2027-01-06T19:00:59.000Z');
  assert.equal(banner.timeEvidence?.end?.precision, 'second');
});

test('붕괴3rd 공지에 없는 종료·점검 시각과 잘못된 날짜를 생성하지 않음', () => {
  for (const description of ['이벤트 기간: 10월 12일 개방', '이벤트 기간: 버전 업데이트 후~10월 19일 04:00',
    '이벤트 기간: 2월 30일 10:00 ~ 3월 5일 04:00', '이벤트 기간: 10월 19일 04:00 ~ 10월 12일 10:00']) {
    const result = parseHonkaiSchedules([article({ description })]);
    assert.equal(result.events.length, 0); assert.equal(result.issues.length, 1);
  }
  const version = parseHonkaiSchedules([article({ title: '9.0 버전 업데이트 공지',
    description: '9.0 버전에 온 걸 환영해(8월 20일~10월 22일)!' })]).events[0]!;
  assert.equal(version.versionEndBasis, 'announced-date'); assert.equal(version.timeEvidence?.start?.precision, 'date');
  assert.ok(isCalendarEvent(version));
  assert.ok(formatEventStart(version).includes('날짜 기준')); assert.ok(formatEventEnd(version).includes('날짜 기준'));
  assert.ok(!formatEventEnd(version).includes('00:00'));
});

test('커뮤니티·오프라인 이벤트 제외 및 잘못된 언어·응답 거부', () => {
  assert.equal(parseHonkaiSchedules([article({ description: '댓글 추첨 이벤트 기간: 10월 12일 10:00 ~ 10월 19일 04:00' })]).events.length, 0);
  assert.throws(() => parseHonkaiNews({ error: 'unavailable' }));
  assert.throws(() => parseHonkaiNews([{ id: '123' }]));
  assert.throws(() => parseHonkaiPost({ retcode: 0, data: { post: { post: { post_id: '123', lang: 'en-us', content: 'English' } } } }, article()));
  assert.equal(parseHonkaiPost({ retcode: 0, data: { post: { post: { post_id: '123', lang: 'ko-kr', content: '<p>한국어 본문</p>' } } } }, article()).description, '한국어 본문');
});

test('공식 카페의 운영자·게시판·글 ID를 대조하고 공개 본문만 수집', () => {
  const official = { cafeId: 29145934, articleId: 1785453, menuId: 15, subject: '☆☆한 주간의 이벤트 업데이트☆☆',
    memberKey: 'TIDjSPSPnZZGfInzDc0UWhuSgywYqDQue253NTP6fZM', writeDateTimestamp: Date.parse('2026-09-30T07:50:25Z') };
  const result = parseHonkaiCafeList({ message: { status: '200', result: { cafeId: 29145934, hasNext: false,
    articleList: [official, { ...official, memberKey: 'user' }, { ...official, menuId: 1 }] } } }, 15);
  assert.equal(result.items.length, 1);
  const raw = { result: { cafeId: 29145934, articleId: official.articleId, article: { id: official.articleId, menu: { id: 15 },
    writer: { memberKey: official.memberKey }, contentHtml: '<p>별들의 격투 | 10월 1일, 이벤트 개방!</p>' } } };
  const parsed = parseHonkaiCafeArticle(raw, result.items[0]!);
  assert.equal(parsed.url, 'https://cafe.naver.com/honkai3rd/1785453');
  assert.equal(parsed.id, 'cafe-1785453');
  const calendar = parseHonkaiSchedules([parsed]);
  assert.equal(calendar.events.length, 0); assert.equal(calendar.issues[0]?.title, '별들의 격투');
  assert.match(calendar.issues[0]!.reason, /기간 미공개/);
  assert.throws(() => parseHonkaiCafeArticle({ result: { ...raw.result, cafeId: 1 } }, result.items[0]!));
});

test('공식 점검 종료로 버전 시작을 보완하고 중복 출처의 버전은 한 번 표시', () => {
  const version = article({ title: '9.0 버전 업데이트 공지', description: '9.0 버전에 온 걸 환영해 (8월 20일~10월 22일)!' });
  const maintenance = article({ id: 'cafe-1784631', title: '9.0 버전 점검 공지, 신규 이벤트 예고',
    description: '8월 20일 11:00~17:00(UTC+9)에 업데이트 점검에 들어갈 예정이야.' });
  const events = parseHonkaiSchedules([version, { ...version, id: 'cafe-1784752' }, maintenance]).events;
  assert.equal(events.length, 1); assert.equal(events[0]?.startAt, '2026-08-20T08:00:00.000Z');
  assert.equal(events[0]?.timeEvidence?.start?.precision, 'minute');
  assert.equal(events[0]?.timeEvidence?.end?.precision, 'date');
});
