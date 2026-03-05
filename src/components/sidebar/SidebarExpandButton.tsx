'use client';

import { useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SIDEBAR_ICON_WIDTH } from './sidebar.config';

interface SidebarExpandButtonProps {
  onExpand: () => void;
}

export function SidebarExpandButton({ onExpand }: SidebarExpandButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fixed top-0 left-0 z-[51] flex h-14 items-center justify-end"
      style={{ width: `calc(${SIDEBAR_ICON_WIDTH} + 2rem)`, paddingRight: '0.25rem' }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onExpand}
            aria-label="Expandir menu"
            style={{
              opacity: hovered ? 1 : 0,
              transform: hovered ? 'translateX(0)' : 'translateX(-6px)',
              transition: 'opacity 150ms ease, transform 150ms ease',
            }}
            className="border-border bg-background text-foreground/70 hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md border shadow-md"
          >
            <PanelLeft size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Expandir menu
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
