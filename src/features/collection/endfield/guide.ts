import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { isImageUrl, isRecord, type CalendarEvent } from '../../../../shared/calendar';
import { fetchHtml } from '../http';
import { isSameScheduleCycle } from '../reconciliation';
import { isPendingScheduleName } from '../names';

export const ENDFIELD_GUIDE_URL = 'https://endfield.gryphline.com/version_briefing/latest?source_from=official';
export interface EndfieldGuideEntry { id: string; korean: string; english: string; imageUrl: string; kind: 'event' | 'challenge' }
export interface EndfieldGuide { version: string; sourceUrl: string; entries: EndfieldGuideEntry[] }

const readLiteral = (source: string, start: number, quote: string) => {
  let value = '';
  for (let index = start; index < source.length; index++) {
    const character = source[index]!;
    if (character === quote) return value;
    if (character !== '\\') { value += character; continue; }
    const escaped = source[++index];
    if (escaped === 'x' || escaped === 'u') {
      const length = escaped === 'x' ? 2 : 4;
      const hex = source.slice(index + 1, index + 1 + length);
      if (hex.length !== length || !/^[\da-f]+$/i.test(hex)) throw new Error('Invalid guide escape');
      value += String.fromCharCode(parseInt(hex, 16));
      index += length;
    } else {
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', "'": "'", '"': '"', '/': '/' };
      if (!escaped || !Object.hasOwn(escapes, escaped)) throw new Error('Unsupported guide escape');
      value += escapes[escaped];
    }
  }
  throw new Error('Unterminated guide data');
};

export const endfieldGuideScriptUrl = (html: string, pageUrl = ENDFIELD_GUIDE_URL) => {
  const urls = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => new URL(match[1]!, pageUrl));
  const matches = urls.filter((url) => url.protocol === 'https:' && url.hostname === 'web-static.hg-cdn.com'
    && /^\/endfield\/webview\/_version_briefing\/[^/]+\/version-[^/]+\.js$/.test(url.pathname));
  if (matches.length !== 1) throw new Error('Version guide script missing or ambiguous');
  return matches[0]!.href;
};

export const parseEndfieldGuide = (source: string, scriptUrl: string): EndfieldGuide => {
  const assets = new Map<string, string>();
  const directory = new URL('.', scriptUrl);
  for (const match of source.matchAll(/["']([^"']+)["']\s*:\s*[\w$]+\.p\s*\+\s*["'](assets\/imgs\/[^"']+)["']/g)) {
    const url = new URL(match[2]!, directory);
    if (url.origin === directory.origin && url.pathname.startsWith(directory.pathname) && isImageUrl(url.href)) {
      if (assets.has(match[1]!) && assets.get(match[1]!) !== url.href) throw new Error('Ambiguous guide asset');
      assets.set(match[1]!, url.href);
    }
  }
  const candidates: EndfieldGuide[] = [];
  // 공개 번들을 실행하지 않고 JSON 문자열과 이미지 리소스 사전만 추출
  for (const match of source.matchAll(/JSON\.parse\(\s*(['"])/g)) {
    let data: unknown;
    try { data = JSON.parse(readLiteral(source, match.index! + match[0].length, match[1]!)); }
    catch { continue; }
    if (!isRecord(data) || !isRecord(data.meta) || typeof data.meta.version !== 'string'
      || !Array.isArray(data.gameplay) || !Array.isArray(data.story)) continue;
    const entries: EndfieldGuideEntry[] = [];
    for (const item of [...data.gameplay, ...data.story].filter(isRecord)) {
      if (typeof item.id !== 'string' || !item.id || !isRecord(item.name)
        || typeof item.name['ko-kr'] !== 'string' || !/[가-힣]/.test(item.name['ko-kr'])) continue;
      const keys = [item.visual, item.thumbnail].filter(isRecord).map((media) => media.assetKey);
      const imageUrl = keys.flatMap((key) => typeof key === 'string' && assets.has(key) ? [assets.get(key)!] : [])[0];
      if (!imageUrl) continue;
      entries.push({ id: item.id, korean: item.name['ko-kr'], english: typeof item.name['en-us'] === 'string' ? item.name['en-us'] : '',
        imageUrl, kind: item.id === 'activity_seasontower_0' ? 'challenge' : 'event' });
    }
    if (entries.length && new Set(entries.map((entry) => entry.id)).size === entries.length)
      candidates.push({ version: data.meta.version, sourceUrl: ENDFIELD_GUIDE_URL, entries });
  }
  if (candidates.length !== 1) throw new Error('Version guide data missing or ambiguous');
  return candidates[0]!;
};

const validGuide = (value: unknown): value is EndfieldGuide => isRecord(value) && typeof value.version === 'string'
  && value.sourceUrl === ENDFIELD_GUIDE_URL && Array.isArray(value.entries) && value.entries.length > 0
  && value.entries.every((entry) => isRecord(entry) && typeof entry.id === 'string' && typeof entry.korean === 'string'
    && /[가-힣]/.test(entry.korean) && typeof entry.english === 'string' && isImageUrl(entry.imageUrl)
    && (entry.kind === 'event' || entry.kind === 'challenge'));

export const fetchEndfieldGuide = async (dependencies: { loadHtml?: typeof fetchHtml; read?: () => Promise<unknown>;
  write?: (guide: EndfieldGuide) => Promise<void> } = {}) => {
  const loadHtml = dependencies.loadHtml ?? fetchHtml;
  const cacheUrl = new URL('../../../../.cache/endfield-guide.json', import.meta.url);
  try {
    const scriptUrl = endfieldGuideScriptUrl(await loadHtml(new URL(ENDFIELD_GUIDE_URL)));
    const guide = parseEndfieldGuide(await loadHtml(new URL(scriptUrl)), scriptUrl);
    try {
      if (dependencies.write) await dependencies.write(guide);
      else {
        await mkdir(new URL('.', cacheUrl), { recursive: true });
        const temporary = new URL(`${cacheUrl.href}.tmp`);
        await writeFile(temporary, JSON.stringify(guide));
        await rename(temporary, cacheUrl);
      }
    } catch (error) { console.error('[endfield] guide cache save failed', error); }
    return { guide, stale: false };
  } catch (error) {
    console.error('[endfield] version guide unavailable', error);
    try {
      const cached: unknown = dependencies.read ? await dependencies.read() : JSON.parse(await readFile(cacheUrl, 'utf8'));
      if (validGuide(cached)) return { guide: cached, stale: true };
    } catch { /* 이전 가이드가 없으면 기존 일정 이미지 유지 */ }
    return { guide: null, stale: true };
  }
};

const nameKey = (name: string) => name.normalize('NFKC').replace(/[’‘]/g, "'").replace(/[「」\[\]]/g, '').replace(/\s+/g, '').toLowerCase();
const entryFor = (event: CalendarEvent, entries: EndfieldGuideEntry[]) => {
  if (event.game !== 'endfield' || !['event', 'challenge'].includes(event.kind)) return undefined;
  let name = event.title;
  const foreign = event.localizationKey?.startsWith('sra:endfield:event:');
  if (foreign) {
    try { name = decodeURIComponent(event.localizationKey!.slice('sra:endfield:event:'.length)); }
    catch { return undefined; }
  }
  const quoted = [...name.matchAll(/「([^」]+)」|\[([^\]]+)\]/g)].map((match) => match[1] ?? match[2]!);
  const subjects = quoted.length === 1 ? quoted : [name];
  const matches = entries.filter((entry) => entry.kind === event.kind && (subjects.some((subject) => nameKey(subject) === nameKey(foreign ? entry.english : entry.korean))
    || entry.id === 'activity_seasontower_0' && event.kind === 'challenge' && /^전쟁의 메아리 · /.test(event.title)));
  return matches.length === 1 ? matches[0] : undefined;
};

export const applyEndfieldGuide = (events: CalendarEvent[], guide: EndfieldGuide): CalendarEvent[] => {
  const matches = new Map(events.flatMap((event) => {
    const entry = entryFor(event, guide.entries);
    return entry ? [[event.id, entry] as const] : [];
  }));
  const folded = new Map<string, CalendarEvent[]>();
  const removed = new Set<string>();
  for (const event of events) {
    const entry = matches.get(event.id);
    if (!entry || !event.localizationKey?.startsWith('sra:endfield:event:')) continue;
    const native = events.filter((candidate) => candidate.game === 'endfield' && candidate.sourceLanguage.startsWith('ko')
      && matches.get(candidate.id)?.id === entry.id && candidate.kind === event.kind && isSameScheduleCycle(candidate, event, false));
    if (native.length !== 1) continue;
    const id = native[0]!.id;
    folded.set(id, [...(folded.get(id) ?? []), event]);
    removed.add(event.id);
  }
  return events.filter((event) => !removed.has(event.id)).map((event) => {
    const entry = matches.get(event.id);
    if (!entry) return event;
    const sources = [event, ...(folded.get(event.id) ?? [])].flatMap((member) => member.collectionSources
      ?? [{ id: member.id, title: member.title, startAt: member.startAt, endAt: member.endAt, sourceUrl: member.sourceUrl }]);
    const foreign = event.localizationKey?.startsWith('sra:endfield:event:') && isPendingScheduleName(event);
    return { ...event, imageUrls: [entry.imageUrl],
      ...(foreign ? { title: entry.korean, displayLanguage: 'ko-kr' as const } : {}),
      ...(folded.has(event.id) ? { collectionSources: [...new Map(sources.map((source) => [source.id, source])).values()].sort((a, b) => a.id.localeCompare(b.id)) } : {}) };
  });
};
