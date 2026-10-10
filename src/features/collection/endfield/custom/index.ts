import type { CalendarEvent } from '../../../../../shared/calendar';
import type { CollectionArticle, VersionBoundary } from '../../parsers';
import { parseEndfieldApiEvents } from '../localized';
import { endfieldWeaponPeriod } from './weapon-banners';

export const parseEndfieldEvents = (article: CollectionArticle, boundaries: VersionBoundary[], banners: CalendarEvent[] = []) =>
  parseEndfieldApiEvents(article, boundaries, (heading, text, version) => {
    const period = /신청/.test(heading) ? endfieldWeaponPeriod(text, version, banners) : null;
    return period ? { ...period, title: `${/「[^」]+」/.exec(heading)?.[0] ?? heading} 무기고 신청` } : null;
  });
