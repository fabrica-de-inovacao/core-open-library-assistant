import { BookOpenText, Clock } from 'lucide-react';

export const SIDEBAR_ICON_WIDTH = '3.25rem';

export interface NavRoute {
  href: string;
  label: string;
  icon: React.ReactElement;
  exact?: boolean;
}

export const NAV_ROUTES: NavRoute[] = [
  { href: '/workspace', label: 'Workspace', icon: <BookOpenText size={15} />, exact: true },
  { href: '/workspace/history', label: 'Minhas Revisões', icon: <Clock size={15} /> },
];
