import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CalendarEvent } from '../shared/calendar';
import { applyHonkaiTimeRules } from '../src/features/collection/honkai/custom/time-rules';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { applyScheduleTimeRules } from '../src/features/collection/schedule-time-rules';
import { supplementHonkaiAuditedSchedules } from '../src/features/collection/honkai/custom/audited-schedules';

const url = 'https://www.arustats.com/en-us/hi3/timeline/9.0';
const dateEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 'honkai:test', game: 'honkai', kind: 'event', title: '시험',
  startAt: '2026-08-19T15:00:00.000Z', endAt: '2026-10-21T15:00:00.000Z', sourceUrl: url, description: '', sourceLanguage: 'ko-kr',
  timeEvidence: { start: { at: '2026-08-19T15:00:00.000Z', basis: 'community-data', precision: 'date', sourceUrl: url },
    end: { at: '2026-10-21T15:00:00.000Z', basis: 'community-data', precision: 'date', sourceUrl: url } }, ...overrides });
const version = dateEvent({ id: 'honkai:version:9.0', kind: 'version', title: '9.0 버전', startAt: '2026-08-20T08:00:00.000Z',
  timeEvidence: { start: { at: '2026-08-20T08:00:00.000Z', basis: 'official', precision: 'minute', sourceUrl: url },
    end: { at: '2026-10-21T15:00:00.000Z', basis: 'official', precision: 'date', sourceUrl: url } } });

test('버전과 함께 시작하는 이벤트·픽업은 17시, 일일 이벤트는 04시', () => {
  for (const kind of ['event', 'banner'] as const) {
    const event = applyHonkaiTimeRules([version, dateEvent({ kind, versionStartId: version.id })])[1]!;
    assert.equal(event.startAt, '2026-08-20T08:00:00.000Z');
    assert.equal(event.endAt, kind === 'banner' ? '2026-10-22T02:00:00.000Z' : '2026-10-21T19:00:00.000Z');
    assert.equal(event.timeEvidence?.start?.basis, 'schedule-rule');
    assert.deepEqual(applyHonkaiTimeRules([version, event])[1], event);
  }
  const startAt = '2026-09-30T15:00:00.000Z';
  const event = dateEvent({ startAt, timeEvidence: { ...dateEvent().timeEvidence,
    start: { at: startAt, basis: 'official', precision: 'date', sourceUrl: url } } });
  assert.equal(applyHonkaiTimeRules([version, event])[1]?.startAt, '2026-09-30T19:00:00.000Z');
});

test('명시된 공식 시각·수동 시각·다른 게임은 유지', () => {
  const event = dateEvent({ startAt: '2026-09-30T03:00:01.000Z', endAt: '2026-10-21T02:00:02.000Z',
    timeEvidence: { start: { at: '2026-09-30T03:00:01.000Z', basis: 'official', precision: 'second', sourceUrl: url },
      end: { at: '2026-10-21T02:00:02.000Z', basis: 'manual', precision: 'second', sourceUrl: url } } });
  assert.deepEqual(applyHonkaiTimeRules([version, event])[1], event);
  assert.deepEqual(applyHonkaiTimeRules([dateEvent({ game: 'genshin' })])[0], dateEvent({ game: 'genshin' }));
  assert.equal(applyScheduleTimeRules(version).endAt, version.endAt);
});

test('버전 종료 날짜에 11시 적용, 원래 날짜 보존 및 공식·수동 종료 우선', () => {
  const corrected = applyHonkaiTimeRules([version])[0]!;
  assert.equal(corrected.endAt, '2026-10-22T02:00:00.000Z');
  assert.equal(corrected.timeEvidence?.end?.ruleDateAt, version.endAt);
  assert.equal(corrected.timeEvidence?.end?.basis, 'schedule-rule');
  assert.deepEqual(applyHonkaiTimeRules([corrected])[0], corrected);
  for (const basis of ['official', 'manual'] as const) {
    const precise = { ...version, endAt: '2026-10-22T01:30:00.000Z', timeEvidence: {
      ...version.timeEvidence, end: { at: '2026-10-22T01:30:00.000Z', basis, precision: 'minute' as const, sourceUrl: url } } };
    assert.deepEqual(applyHonkaiTimeRules([precise])[0], precise);
  }
});

test('버전 마지막 픽업만 11시 제한하고 중간·다음 버전 픽업은 12시 유지', () => {
  const last = dateEvent({ kind: 'banner', versionStartId: version.id });
  const middleEnd = '2026-10-01T15:00:00.000Z';
  const middle = { ...last, id: 'middle', endAt: middleEnd, timeEvidence: { ...last.timeEvidence,
    end: { at: middleEnd, basis: 'community-data' as const, precision: 'date' as const, sourceUrl: url } } };
  const beyond = { ...last, id: 'beyond', endAt: '2026-11-01T15:00:00.000Z', timeEvidence: { ...last.timeEvidence,
    end: { at: '2026-11-01T15:00:00.000Z', basis: 'community-data' as const, precision: 'date' as const, sourceUrl: url } } };
  const nextStart = '2026-10-22T08:00:00.000Z';
  const next = { ...last, id: 'next', startAt: nextStart, versionStartId: undefined, endAt: '2026-11-01T03:00:00.000Z',
    timeEvidence: { start: { at: nextStart, basis: 'official' as const, precision: 'minute' as const, sourceUrl: url },
      end: { at: '2026-11-01T03:00:00.000Z', basis: 'official' as const, precision: 'minute' as const, sourceUrl: url } } };
  const original = [version, last, middle, beyond, next];
  const result = applyHonkaiTimeRules(original);
  assert.equal(result[1]!.endAt, '2026-10-22T02:00:00.000Z');
  assert.equal(result[2]!.endAt, '2026-10-02T03:00:00.000Z');
  assert.equal(result[3]!.endAt, result[1]!.endAt);
  assert.deepEqual(result[4], next);
  assert.deepEqual(applyHonkaiTimeRules(result), result);
  assert.equal(applyHonkaiTimeRules([result[1]!])[0]!.endAt, '2026-10-22T03:00:00.000Z');
});

test('명시된 12시 픽업도 마지막 경계 제한 및 버전 변경 시 원래 종료 복원', () => {
  const endAt = '2026-10-22T03:00:00.000Z';
  const banner = dateEvent({ kind: 'banner', versionStartId: version.id, endAt,
    timeEvidence: { ...dateEvent().timeEvidence, end: { at: endAt, basis: 'official', precision: 'minute', sourceUrl: url } } });
  const result = applyHonkaiTimeRules([version, banner]);
  assert.equal(result[1]!.endAt, '2026-10-22T02:00:00.000Z');
  assert.equal(result[1]!.timeEvidence?.end?.ruleOriginalAt, endAt);
  assert.deepEqual(applyHonkaiTimeRules(result), result);
  assert.equal(applyHonkaiTimeRules([result[1]!])[0]!.endAt, endAt);
  const manual = { ...banner, timeEvidence: { ...banner.timeEvidence, end: { ...banner.timeEvidence!.end!, basis: 'manual' as const } } };
  assert.equal(applyHonkaiTimeRules([version, manual])[1]!.endAt, endAt);
});

test('부생 코스튬 날짜를 장비에 연결하지 않고 이전 버전 로그인 시작을 보존', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/honkai-timeline.json', import.meta.url), 'utf8'));
  const articles = [{ id: '1', title: '주간 이벤트', url, createdAt: 1787000000,
    description: '푸른 산과 흰 깃털 | 8월 28일, 부생·도진의 날개 전용 코스튬 「태허의 학」 복각!\n꿈의 틈새로 비친 빛 | 8월 13일, 7일 로그인 시 수정 획득!' }];
  const events = parseHonkaiPublicTimeline(raw, version, articles, url).events;
  assert.equal(events.find((event) => event.title === '부생·도진의 날개 · 장비 보급')?.startAt, '2026-08-19T15:00:00.000Z');
  assert.equal(events.find((event) => event.title === '태허의 학 · 코스튬 보급')?.startAt, '2026-08-27T15:00:00.000Z');
  assert.equal(events.find((event) => event.title === '꿈의 틈새로 비친 빛')?.startAt, '2026-08-12T15:00:00.000Z');
});

test('한국어 상세 공지의 세나디아 정확한 기간을 예상 기간보다 우선', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/honkai-timeline.json', import.meta.url), 'utf8'));
  const articles = [{ id: '46171269', title: '신규 S급 협력 캐릭터 「세나디아」 등장', createdAt: 1786000000,
    url: 'https://www.hoyolab.com/article/46171269', description: '9.0 버전 업데이트 후~10월 2일 12:00 기간 협력 보급 개방.' }];
  const event = applyHonkaiTimeRules([version, ...parseHonkaiPublicTimeline(raw, version, articles, url).events])[1]!;
  assert.equal(event.startAt, version.startAt); assert.equal(event.endAt, '2026-10-02T03:00:00.000Z');
  assert.equal(event.periodBasis, undefined); assert.equal(event.timeEvidence?.end?.basis, 'official');
});

test('한국 공식 개방 안내가 있는 누락 장비 슬롯만 보완하고 중복 생성 방지', () => {
  const articles = [{ id: 'cafe-1785453', title: '주간 공지', createdAt: 1790000000, url,
    description: '장비 보급 | 10월 2일, 신의 열쇠 「무결의 사랑」 및 「사법의 시인」 성흔 세트 획득 확률 UP!' }];
  const events = supplementHonkaiAuditedSchedules([version], articles);
  assert.equal(events.length, 2); assert.equal(events[1]?.periodBasis, 'community-data');
  assert.deepEqual(supplementHonkaiAuditedSchedules(events, articles), events);
  assert.deepEqual(supplementHonkaiAuditedSchedules([version], []), [version]);
});
