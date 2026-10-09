import { useState } from 'react';
import { cn } from '../../../utils/cn';

interface EventImageProps { url: string; alt?: string; className?: string }
export const EventImage = ({ url, alt = '', className }: EventImageProps) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === url) return null;
  return <img src={url} alt={alt} className={cn('event-image', className)} loading="lazy" decoding="async"
    referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />;
};
