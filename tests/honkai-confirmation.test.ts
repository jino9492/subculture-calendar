import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../shared/calendar';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import type { HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { isEstimatedPeriod } from '../src/features/calendar/utils/calendar';

const source = 'https://www.arustats.com/en-us/hi3/timeline/9.2';
const raw = { version: '9.2', scheduleDates: [{ startDate: '2026-12-24 0:0:0', endDate: '2027-2-4 0:0:0' }],
  scheduleActivities: [{ row: 'EVENT 1', content: [{ startWeek: 1, endWeek: 2, miniature: { titleTop: 'Future Event' } }] }] };

test('기간까지 확인된 절대·상대 공지는 예상 표시 제거하고 날짜만 있는 공식 시작도 인정', () => {
  const version: CalendarEvent = { id: 'honkai:version:9.2', game: 'honkai', kind: 'version', title: '9.2 버전',
    startAt: '2026-12-23T15:00:00.000Z', endAt: '2027-02-03T15:00:00.000Z', sourceUrl: source,
    sourceLanguage: 'ko-kr', description: '',
    timeEvidence: { start: { at: '2026-12-23T15:00:00.000Z', basis: 'official', precision: 'date', sourceUrl: source } } };
  const notice: HonkaiArticle = { id: 'notice', title: '「미래 행사」 이벤트 안내', url: 'https://www.hoyolab.com/article/123',
    createdAt: Date.parse('2026-12-23T03:00:00Z') / 1000,
    description: '★ 테마 이벤트——「미래 행사」\n이벤트 기간: 12월 25일 10:00 ~ 1월 15일 04:00',
    englishDescription: '★ Event: Future Event' };
  const absolute = parseHonkaiPublicTimeline(raw, version, [notice], source).events[0]!;
  assert.equal(absolute.startAt, '2026-12-25T01:00:00.000Z');
  assert.equal(absolute.endAt, '2027-01-14T19:00:00.000Z');
  assert.equal(isEstimatedPeriod(absolute), false);
  const relativeNotice = { ...notice,
    description: '★ 테마 이벤트——「미래 행사」\n9.2 버전 업데이트 후~1월 15일 04:00 미래 행사 이벤트 개방.' };
  const relative = parseHonkaiPublicTimeline(raw, version, [relativeNotice], source).events[0]!;
  assert.equal(isEstimatedPeriod(relative), false);
  const unverifiedVersion = parseHonkaiPublicTimeline(raw, { ...version,
    timeEvidence: { start: { ...version.timeEvidence!.start!, basis: 'community-data' } } }, [relativeNotice], source).events[0]!;
  assert.equal(isEstimatedPeriod(unverifiedVersion), false);
  assert.equal(unverifiedVersion.timeEvidence?.start?.basis, 'community-data');
  const original = parseHonkaiPublicTimeline(raw, version, [], source).events[0]!;
  assert.equal(original.title, 'Future Event');
  assert.equal(isEstimatedPeriod(original), true);
});

test('공식 이름 대조가 완료되어도 공식 종료가 없으면 예상 기간 표시', () => {
  const version: CalendarEvent = { id: 'honkai:version:9.2', game: 'honkai', kind: 'version', title: '9.2 버전',
    startAt: '2026-12-23T15:00:00.000Z', endAt: '2027-02-03T15:00:00.000Z', sourceUrl: source,
    sourceLanguage: 'ko-kr', description: '' };
  const notice: HonkaiArticle = { id: 'notice', title: '9.2 버전 업데이트 공지', url: 'https://www.hoyolab.com/article/123',
    createdAt: Date.parse('2026-12-23T03:00:00Z') / 1000,
    description: '★ 테마 이벤트——「대조된 행사」', englishDescription: '★ Event: Future Event' };
  const result = parseHonkaiPublicTimeline(raw, version, [notice], source);
  const event = result.events[0]!;
  assert.equal(event.crossChecked, true);
  assert.equal(event.periodBasis, 'community-data');
  assert.equal(event.timeEvidence?.end?.basis, 'community-data');
  assert.equal(isEstimatedPeriod(event), true);
  assert.equal(isEstimatedPeriod({ ...event, crossChecked: undefined }), true);
  const original = parseHonkaiPublicTimeline(raw, version, [], source).events[0]!;
  assert.equal(original.crossChecked, false);
  assert.equal(isEstimatedPeriod(original), true);
});
