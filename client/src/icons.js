import { createIcons, icons } from 'lucide';

export function refreshIcons() {
  createIcons({
    icons,
    attrs: {
      'stroke-width': 2,
      'aria-hidden': 'true'
    }
  });
}
