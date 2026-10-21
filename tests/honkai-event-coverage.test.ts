import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCalendarEvent, type CalendarEvent } from '../shared/calendar';
import { parseHonkaiPublicTimeline } from '../src/features/collection/honkai/public';
import { parseHonkaiSchedules, type HonkaiArticle } from '../src/features/collection/honkai/parsers';
import { applyHonkaiTimeRules } from '../src/features/collection/honkai/custom/time-rules';
import { isEstimatedPeriod } from '../src/features/calendar/utils/calendar';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/honkai-9.1-events.json', import.meta.url), 'utf8'));
const version: CalendarEvent = { id: 'honkai:version:9.1', title: '9.1 버전', game: 'honkai', kind: 'version',
  startAt: '2026-10-22T08:00:00.000Z', endAt: '2026-12-23T15:00:00.000Z', sourceLanguage: 'ko-kr',
  sourceUrl: 'https://cafe.naver.com/honkai3rd/1785865', description: '',
  timeEvidence: { start: { at: '2026-10-22T08:00:00.000Z', basis: 'official', precision: 'minute',
    sourceUrl: 'https://cafe.naver.com/honkai3rd/1785865' } } };
const source = 'https://www.arustats.com/en-us/hi3/timeline/9.1';

test('실제 9.1 공지의 보상형 이름과 공식 개방일을 연결하고 미확인 콘텐츠도 보존', () => {
  const weekly = { ...fixture.article, id: 'weekly', description: '타임캡슐 | 희귀 코스튬 기간 한정 재입하!' };
  const result = parseHonkaiPublicTimeline(fixture.timeline, version, [fixture.article, weekly], source);
  const events = applyHonkaiTimeRules([version, ...result.events]).filter((event) => event.kind === 'event');
  assert.equal(events.filter((event) => event.crossChecked).length, 10);
  assert.ok(events.every(isCalendarEvent));
  assert.ok(events.filter((event) => event.timeEvidence?.end?.basis === 'community-data'
    || event.timeEvidence?.end?.basis === 'schedule-rule').every(isEstimatedPeriod));
  assert.ok(events.filter((event) => !event.crossChecked).every(isEstimatedPeriod));
  const starts = Object.fromEntries(events.map((event) => [event.title, event.startAt]));
  assert.equal(starts['성화의 여정~ 가을밤의 인연'], version.startAt);
  assert.equal(starts['꿈에서 온 선물'], version.startAt);
  assert.equal(starts['달콤한 모래사장'], version.startAt);
  assert.equal(starts['은빛 바다의 추억'], version.startAt);
  assert.equal(starts['꿈을 줍는 여정'], '2026-10-15T19:00:00.000Z');
  assert.equal(starts['단풍빛 불꽃~ 가을 야유회'], '2026-10-28T19:00:00.000Z');
  assert.equal(starts['바다가 불꽃의 소리로 노래하고 있어'], '2026-11-01T19:00:00.000Z');
  assert.ok(result.issues.some((issue) => issue.title === 'Annual Recap'));
  assert.ok(parseHonkaiSchedules([fixture.article]).issues.some((issue) => issue.title === '늦가을의 빛'));
  const original = parseHonkaiPublicTimeline(fixture.timeline, version, [], source).events;
  assert.equal(original.length, fixture.timeline.scheduleActivities.reduce((count: number, row: { content: unknown[] }) => count + row.content.length, 0));
  assert.ok(original.every((event) => !event.crossChecked && isEstimatedPeriod(event)));
});

test('새 버전의 별표 제목과 로그인 항목을 한영 섹션·개방일 대조로 자동 연결', () => {
  const article: HonkaiArticle = { id: 'future', title: '9.3 버전 이벤트 일람', createdAt: fixture.article.createdAt,
    url: fixture.article.url, description: ' ☆☆☆로그인 시리즈 이벤트☆☆☆\n10월 29일, 「새 로그인」 이벤트 개방.',
    englishDescription: ' ☆☆☆ Login Events ☆☆☆\nOn OCT 29, the event "New Login" begins.' };
  const raw = { ...fixture.timeline, version: '9.3', scheduleActivities: [{ row: 'EVENT 1',
    content: [{ startWeek: 2, endWeek: 4, miniature: { titleTop: 'New Login' } }] }] };
  const v = { ...version, id: 'honkai:version:9.3', title: '9.3 버전' };
  const event = parseHonkaiPublicTimeline(raw, v, [article], source).events[0]!;
  assert.equal(event.title, '새 로그인');
  assert.equal(event.startAt, '2026-10-28T15:00:00.000Z');
  const mismatch = { ...article, englishDescription: article.englishDescription!.replace('OCT 29', 'NOV 5') };
  assert.equal(parseHonkaiPublicTimeline(raw, v, [mismatch], source).events[0]!.crossChecked, false);
  const noKorean = { ...article, description: '☆☆☆로그인 시리즈 이벤트☆☆☆' };
  assert.equal(parseHonkaiPublicTimeline(raw, v, [noKorean], source).events[0]!.title, 'New Login');
});
