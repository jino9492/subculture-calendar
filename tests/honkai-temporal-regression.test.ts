import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { applyHonkaiTimeRules } from '../src/features/collection/honkai/custom/time-rules';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { parseHonkaiSchedules, type HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { supplementHonkaiAuditedSchedules } from '../src/features/collection/honkai/custom/audited-schedules';
import { reconcileSchedules } from '../src/features/collection/reconciliation';

const url = 'https://www.hoyolab.com/article/47031287';
const event = (startAt: string, endAt: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'honkai:test', game: 'honkai', kind: 'event', title: '시험', startAt, endAt, sourceUrl: url, sourceLanguage: 'ko-kr', description: '',
  timeEvidence: { start: { at: startAt, basis: 'community-data', precision: 'date', sourceUrl: url },
    end: { at: endAt, basis: 'community-data', precision: 'date', sourceUrl: url } }, ...overrides,
});
const article = (description: string, overrides: Partial<HonkaiArticle> = {}): HonkaiArticle => ({
  id: '47031287', title: '시간의 율자 신규 캐릭터', description, url, createdAt: 1791601209, ...overrides,
});
const version = event('2026-10-21T15:00:00.000Z', '2026-12-23T15:00:00.000Z', {
  id: 'honkai:version:9.1', kind: 'version', title: '9.1 버전',
});
const timeline = (v: CalendarEvent, activities: unknown[]) => ({ version: /\d+\.\d+/.exec(v.title)![0],
  scheduleDates: [{ startDate: `${new Date(Date.parse(v.startAt) + 9 * 3600000).toISOString().slice(0, 10)} 0:0:0`,
    endDate: `${new Date(Date.parse(v.endAt) + 9 * 3600000).toISOString().slice(0, 10)} 0:0:0` }], scheduleActivities: activities });
const row = (name: string, titleTop: string) => ({ row: name, content: [{ startWeek: 1, endWeek: 2, miniature: { titleTop } }] });

test('2000~2040년 과거·미래·윤년·연말에도 KST 규칙과 반복 적용 일관성', () => {
  for (let year = 2000; year <= 2040; year++) {
    for (const month of ['01', '02', '12']) {
      const startAt = `${year}-${month}-27T15:00:00.000Z`;
      const endAt = new Date(Date.parse(startAt) + 8 * 86400000).toISOString();
      for (const kind of ['event', 'banner', 'version'] as const) {
        const original = event(startAt, endAt, { kind });
        const result = applyHonkaiTimeRules([original])[0]!;
        const expected = kind === 'version' ? 17 : kind === 'banner' ? 12 : 4;
        assert.equal((new Date(result.startAt).getUTCHours() + 9) % 24, expected);
        assert.equal((new Date(result.endAt).getUTCHours() + 9) % 24, kind === 'version' ? 11 : kind === 'banner' ? 12 : 4);
        assert.equal(result.timeEvidence?.start?.ruleDateAt, startAt);
        assert.ok(isCalendarEvent(result));
        assert.deepEqual(applyHonkaiTimeRules([result])[0], result);
      }
    }
  }
});

test('동일 날짜만으로 버전 연결 금지·뒤늦은 버전 공지·예정 종료 변경 재계산', () => {
  const linked = event(version.startAt, version.endAt, { versionStartId: version.id });
  const first = applyHonkaiTimeRules([linked])[0]!;
  assert.equal(first.startAt, '2026-10-21T19:00:00.000Z');
  const next = applyHonkaiTimeRules([version, first])[1]!;
  assert.equal(next.startAt, '2026-10-22T08:00:00.000Z');
  assert.equal(applyHonkaiTimeRules([version, event(version.startAt, version.endAt)])[1]!.startAt, first.startAt);
  const updated = { ...version, startAt: '2026-10-22T09:30:00.000Z',
    timeEvidence: { ...version.timeEvidence, start: { at: '2026-10-22T09:30:00.000Z', basis: 'official' as const, precision: 'minute' as const, sourceUrl: url } } };
  assert.equal(applyHonkaiTimeRules([updated, next])[1]!.startAt, updated.startAt);
  assert.equal(applyHonkaiTimeRules([version, version, linked])[2]!.startAt, first.startAt);
});

test('과거 10시 이벤트·수동 날짜·근거 불일치·기간 역전은 원본 보존', () => {
  const historical = parseHonkaiSchedules([article('【이벤트 기간】\n5월 14일 10:00~5월 18일 04:00', {
    title: '해커 침입 이벤트', createdAt: Date.parse('2021-05-13T00:00:00Z') / 1000,
  })]).events[0]!;
  assert.equal(historical.startAt, '2021-05-14T01:00:00.000Z');
  assert.deepEqual(applyHonkaiTimeRules([historical])[0], historical);
  const manual = event(version.startAt, version.endAt);
  manual.timeEvidence!.start!.basis = 'manual'; manual.timeEvidence!.end!.basis = 'manual';
  assert.deepEqual(applyHonkaiTimeRules([manual])[0], manual);
  const stale = { ...manual, startAt: '2026-10-22T01:00:00.000Z' };
  assert.deepEqual(applyHonkaiTimeRules([stale])[0], stale);
  const short = event(version.startAt, '2026-10-22T00:00:00.000Z', { versionStartId: version.id });
  short.timeEvidence!.end = { at: short.endAt, basis: 'official', precision: 'minute', sourceUrl: url };
  assert.deepEqual(applyHonkaiTimeRules([version, short])[1], short);
});

test('실제 9.1 상세 공지의 캐릭터·장비·로그인 기간을 각각 연결', () => {
  const notice = article('9.1 버전 업데이트 후~12월 4일 12:00 기간, 「시간의 율자」 캐릭터 보급 개방.\n'
    + '9.1 버전 업데이트 후~12월 4일 12:00 기간, 「시간의 율자」 추천 장비 보급 추가.\n'
    + '9.1 버전 업데이트 후~12월 24일 04:00 기간, 로그인 이벤트 참여 시 「시간의 율자」 추천 성흔 획득.', {
    englishDescription: '★ Character: Time Ruler', description: '',
  });
  notice.description = '★ 신규 캐릭터——「시간의 율자」\n9.1 버전 업데이트 후~12월 4일 12:00 기간, 「시간의 율자」 캐릭터 보급 개방.\n'
    + '9.1 버전 업데이트 후~12월 4일 12:00 기간, 「시간의 율자」 추천 장비 보급 추가.\n'
    + '9.1 버전 업데이트 후~12월 24일 04:00 기간, 로그인 이벤트 참여 시 「시간의 율자」 추천 성흔 획득.';
  const raw = timeline(version, [row('CHARACTER SUPPLY', 'Time Ruler'), row('EQUIPMENT SUPPLY', 'Time Ruler'), row('EVENT 1', 'Time Ruler')]);
  const parsed = parseHonkaiPublicTimeline(raw, version, [notice], url).events;
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]!.endAt, '2026-12-04T03:00:00.000Z');
  assert.equal(parsed[1]!.endAt, parsed[0]!.endAt);
  assert.equal(parsed[2]!.endAt, '2026-12-23T19:00:00.000Z');
  assert.ok(parsed.every((item) => item.periodBasis === 'community-data'));
  assert.ok(applyHonkaiTimeRules([version, ...parsed]).slice(1).every((item) => item.startAt === '2026-10-22T08:00:00.000Z'));
});

test('연말 버전 상대 종료와 개방일은 다음·이전 연도로 복원', () => {
  const v = event('2025-12-30T15:00:00.000Z', '2026-03-04T15:00:00.000Z', { id: 'honkai:version:8.6', title: '8.6 버전', kind: 'version' });
  const notice = article('★ 신규 캐릭터——「새 캐릭터」\n8.6 버전 업데이트 후~1월 8일 12:00 기간 새 캐릭터 캐릭터 보급.', {
    title: '새 캐릭터', createdAt: Date.parse('2025-12-29T00:00:00Z') / 1000, englishDescription: '★ Character: New Character',
  });
  const result = parseHonkaiPublicTimeline(timeline(v, [row('CHARACTER SUPPLY', 'New Character')]), v, [notice], url).events;
  assert.equal(result[0]!.endAt, '2026-01-08T03:00:00.000Z');
  const january = event('2026-01-01T15:00:00.000Z', '2026-02-01T15:00:00.000Z', { ...v, startAt: '2026-01-01T15:00:00.000Z', endAt: '2026-02-01T15:00:00.000Z' });
  const continuation = article('★ 이벤트——「계속 행사」\n계속 행사 | 12월 31일, 로그인 이벤트!', {
    title: '계속 행사', createdAt: Date.parse('2025-12-31T00:00:00Z') / 1000, englishDescription: '★ Event: Continuing Event',
  });
  const past = parseHonkaiPublicTimeline(timeline(january, [row('EVENT 1', 'Continuing Event cont from v8.5')]), january, [continuation], url).events[0]!;
  assert.equal(past.startAt, '2025-12-30T15:00:00.000Z'); assert.equal(past.versionStartId, undefined);
});

test('과거 9.0 custom 값의 재사용 차단·정확한 공식 시각 병합 우선', () => {
  const older = { ...version, id: 'honkai:version:9.0', title: '9.0 버전' };
  const notice = article('장비 보급 | 10월 2일 무결의 사랑 사법의 시인');
  assert.deepEqual(supplementHonkaiAuditedSchedules([older], [notice]), [older]);
  const baseline = event(version.startAt, version.endAt, { identityKey: 'honkai:test:cycle' });
  const exact = { ...baseline, id: 'honkai:exact', startAt: '2026-10-22T01:00:00.000Z',
    timeEvidence: { ...baseline.timeEvidence, start: { at: '2026-10-22T01:00:00.000Z', basis: 'official' as const, precision: 'minute' as const, sourceUrl: 'https://z.example.com/notice' } } };
  baseline.timeEvidence!.start!.basis = 'official';
  const result = reconcileSchedules([baseline, exact]).events;
  assert.equal(result.length, 1); assert.equal(result[0]!.startAt, exact.startAt);
});

test('새 분류·미번역 이름은 진단으로 남기고 오래된 다른 버전 이름 연결 차단', () => {
  const raw = timeline(version, [row('NEW CATEGORY', 'Unknown'), row('EVENT 1', 'Unknown')]);
  const result = parseHonkaiPublicTimeline(raw, version, [], url);
  assert.equal(result.events.length, 0); assert.equal(result.issues.length, 2);
  const old = article('★ 이벤트——「다른 행사」', { title: '8.0 버전 업데이트 공지', englishDescription: '★ Event: Unknown' });
  assert.equal(parseHonkaiPublicTimeline(raw, version, [old], url).events.length, 0);
});

test('실제 8.6 버전 연말 경계와 다른 날짜 점검 공지의 오연결 차단', () => {
  const update = article('8.6 버전에 온 걸 환영해(12월 31일~3월 5일)!', {
    title: '8.6 버전 업데이트 공지', createdAt: 1767150002,
  });
  const wrong = article('1월 9일 11:00~17:00(UTC+9)에 업데이트 점검', { id: 'wrong', title: '8.6 버전 점검 공지', createdAt: 1767150002 });
  const v = parseHonkaiSchedules([update, wrong]).events[0]!;
  assert.equal(v.startAt, '2025-12-30T15:00:00.000Z'); assert.equal(v.endAt, '2026-03-04T15:00:00.000Z');
  assert.equal(applyHonkaiTimeRules([v])[0]!.startAt, '2025-12-31T08:00:00.000Z');
});
