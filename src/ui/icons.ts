const shapes: Record<string, string> = {
  robot: '<rect x="4" y="7" width="16" height="14" rx="4"/><path d="M12 3v4M8 17h8M1 12v5M23 12v5"/><circle cx="8.5" cy="12" r=".6"/><circle cx="15.5" cy="12" r=".6"/>',
  cube: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9"/>',
  bone: '<path d="M7.5 5A2.5 2.5 0 1 0 3 7c-1 3 2 5 4 3l7 7c-2 2 0 5 3 4a2.5 2.5 0 1 0 2-4.5L11 9c2-2 0-5-3-4Z"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  collapse: '<path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="4"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  rotate: '<path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6"/><path d="m10 8 6 4-6 4V8Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-8 2 4-14"/>',
};
export function icon(name: string, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.cube}</svg>`;
}
