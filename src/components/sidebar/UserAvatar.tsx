import { CircleUser } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  src?: string | null;
  alt?: string;
  className?: string;
  iconSize?: number;
}

export function UserAvatar({ src, alt = 'Avatar', className, iconSize = 16 }: UserAvatarProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        className={cn('border-border/50 shrink-0 rounded-full border', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'border-border/50 bg-muted flex shrink-0 items-center justify-center rounded-full border',
        className
      )}
    >
      <CircleUser size={iconSize} className="text-muted-foreground" />
    </div>
  );
}
