import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { collectCalendar, isPendingScheduleName, reconcileSchedules } from '../src/features/collection';
import { readAdminState, mergeManagedEvents } from '../server/admin-store';
import { calendarRange, packTimeRange } from '../src/features/calendar/utils/calendar';
import { isCalendarEvent, GAME_IDS, EVENT_KINDS } from '../shared/calendar';

const expected = [
  ['genshin', '베스나', '2026-09-23T12:00:00+09:00', '2026-10-13T18:59:00+09:00'],
  ['genshin', '보댜니차', '2026-09-23T12:00:00+09:00', '2026-10-13T18:59:00+09:00'],
  ['genshin', '나비의 우화 · 파도의 찬송가', '2026-09-23T12:00:00+09:00', '2026-10-13T18:59:00+09:00'],
  ['genshin', '검에 서린 설원의 여정', '2026-09-23T12:00:00+09:00', '2026-11-03T15:59:00+09:00'],
  ['genshin', '테이블 극단·모험 전야제', '2026-09-23T12:00:00+09:00', '2026-11-03T15:59:00+09:00'],
  ['starrail', '이상 중재 · 낙엽귀근', '2026-09-28T12:00:00+09:00', '2026-11-11T07:00:00+09:00'],
  ['starrail', '러브, 고스트 + 로봇', '2026-09-28T12:00:00+09:00', '2026-11-11T04:59:00+09:00'],
  ['starrail', '혼돈의 기억 · 적자생존', '2026-11-02T05:00:00+09:00', '2026-12-14T04:59:00+09:00'],
  ['starrail', '허구 이야기 · 취상 작문', '2026-10-19T05:00:00+09:00', '2026-11-30T04:59:00+09:00'],
  ['starrail', '종말의 환영 · 지배와 망각', '2026-10-05T05:00:00+09:00', '2026-11-16T04:59:00+09:00'],
  ['starrail', '혼돈의 기억 · 내세로의 도하', '2026-09-28T12:00:00+09:00', '2026-11-02T04:59:00+09:00'],
  ['starrail', '스타피스 페스티벌: 원 테이크', '2026-10-21T13:00:00+09:00', '2026-11-11T04:59:00+09:00'],
  ['starrail', '「탐식」을 제압하고, 원력을 모아라', '2026-09-28T12:00:00+09:00', '2026-11-11T07:00:00+09:00'],
  ['starrail', '별의 선물', '2026-09-28T12:00:00+09:00', '2026-11-11T04:59:59+09:00'],
  ['starrail', '허구 이야기 · 입계의 서막', '2026-09-14T05:00:00+09:00', '2026-10-19T04:59:59+09:00'],
] as const;
const format = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const { calendar, issues } = await collectCalendar(!process.argv.includes('--cached'), { cause: 'manual' });
const collected = calendar.events;
const events = mergeManagedEvents(collected, await readAdminState()).filter((event) => !isPendingScheduleName(event));
assert.ok(events.every(isCalendarEvent));
const sortEvents = (items: typeof collected) => [...items].sort((a, b) => a.id.localeCompare(b.id));
assert.ok(isDeepStrictEqual(sortEvents(reconcileSchedules(collected).events), sortEvents(collected)), '재병합 시 일정 또는 근거 변경');
const range = calendarRange(events);
let lanesChecked = 0;
if (range) for (const game of GAME_IDS) for (const kind of EVENT_KINDS) {
  for (const lane of packTimeRange(events.filter((event) => event.game === game && event.kind === kind), range.first, range.last)) {
    lanesChecked++;
    for (const [index, segment] of lane.entries()) {
      assert.ok(segment.start >= 0 && segment.end <= range.days.length && segment.end > segment.start);
      const previous = lane[index - 1];
      if (previous) assert.ok(previous.end <= segment.start);
    }
  }
}
const checked = expected.map(([game, title, startAt, endAt]) => {
  const matches = events.filter((event) => event.game === game && event.title === title);
  const event = matches.length === 1 ? matches[0] : undefined;
  const evidenceValid = title === '허구 이야기 · 입계의 서막' ? Boolean(event) : title === '별의 선물' ? event?.timeEvidence?.end?.basis === 'schedule-rule'
    : event?.timeEvidence?.start && event.timeEvidence.start.basis !== 'community-data'
    && (title === '이상 중재 · 낙엽귀근' || event.timeEvidence.end?.basis === 'official');
  return { game, title, passed: Boolean(event && evidenceValid && Math.abs(Date.parse(event.startAt) - Date.parse(startAt)) < 60000
    && Math.abs(Date.parse(event.endAt) - Date.parse(endAt)) < 60000),
    start: event ? format(event.startAt) : null, end: event ? format(event.endAt) : null, evidence: event?.timeEvidence,
    expectedStart: format(startAt), expectedEnd: format(endAt) };
});
const suspected = events.filter((event) => Date.parse(event.endAt) > Date.now()).flatMap((event) => {
  if (checked.some((row) => row.game === event.game && row.title === event.title && row.passed)) return [];
  const fields = (['start', 'end'] as const).filter((field) => {
    const evidence = event.timeEvidence?.[field];
    if (evidence && evidence.basis !== 'community-data') return false;
    const at = field === 'start' ? event.startAt : event.endAt;
    return event.collectionSources?.some((source) => Math.abs(Date.parse(field === 'start' ? source.startAt : source.endAt) - Date.parse(at)) >= 3600000);
  });
  const estimated = event.periodBasis === 'community-cycle' || event.versionEndBasis === 'default-42-days' || event.versionEndBasis === 'announced-date';
  return fields.length || estimated ? [{ game: event.game, title: event.title, start: format(event.startAt), end: format(event.endAt),
    reason: estimated ? '기간 추정 또는 시각 미확정' : `공식 근거 없이 출처 간 ${fields.join('·')} 차이`,
    sourceUrl: event.timeEvidence?.start?.sourceUrl ?? event.sourceUrl }] : [];
});
const report = { checkedAt: format(new Date().toISOString()), events: events.length, lanesChecked,
  sources: calendar.sources, checked, suspected, timingIssues: issues.filter((issue) => issue.id.startsWith('timing:')) };
await writeFile(new URL('../.cache/time-audit.json', import.meta.url), JSON.stringify(report, null, 2));
const lines = [
  '# 일정 시각 검증', '', `${report.checkedAt} 한국 시간 · ${events.length}개 일정 · ${lanesChecked}개 행 검증`, '',
  '분 단위 공식 공지와 초 단위 데이터의 1분 미만 차이는 정밀도 차이로 허용.', '',
  '| Task | 적용 시작 (한국 시간) | 적용 종료 (한국 시간) | 확인 |', '|---|---|---|---|',
  ...checked.map((row) => `| ${row.title} | ${row.start ?? '누락'} | ${row.end ?? '누락'} | ${row.passed ? '일치' : '확인 필요'} |`), '',
  '## 실제 시각 확인 필요', '', '| Task | 적용 시작 | 적용 종료 | 사유 |', '|---|---|---|---|',
  ...suspected.map((row) => `| ${row.title} | ${row.start} | ${row.end} | ${row.reason} |`), '',
];
await writeFile(new URL('../docs/time-audit.md', import.meta.url), lines.join('\n'));
console.log(JSON.stringify(report, null, 2));
if (checked.some((row) => !row.passed) || calendar.sources.some((source) => source.state === 'stale' || source.state === 'error')) process.exitCode = 1;
