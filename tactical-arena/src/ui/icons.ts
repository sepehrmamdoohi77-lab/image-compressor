const paths: Record<string, string> = {
  refresh: '<path d="M3 11a9 9 0 0 1 16-6l2 3M21 3v5h-5M21 13a9 9 0 0 1-16 6l-2-3M3 21v-5h5"/>',
  operations: '<path d="m3 9 9-6 9 6v11H3z"/><path d="M9 20v-7h6v7"/>',
  squad:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 1 1 4.9 1.8L12 13v1M12 17h.01"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M15 5V3H3v12h2"/>',
  link: '<path d="m9 15 6-6m-6-2 2-2a5 5 0 0 1 7 7l-2 2m-7 2-2 2a5 5 0 0 1-7-7l2-2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  shield: '<path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z"/><path d="m8 12 3 3 5-6"/>',
  signal: '<path d="M4 18v3M9 13v8M14 8v13M19 3v18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  minus: '<path d="M5 12h14"/>',
  run: '<circle cx="15" cy="4" r="2"/><path d="m7 9 5-2 4 5 5 1M4 21l7-8m-1-4 1 7 5 5"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-2v16m6-14v16"/>',
};
export function icon(name: string, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.operations}</svg>`;
}
export const emblem = `<svg class="emblem" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M32 3 58 16v28L32 61 6 44V16zm0 8L14 20v20l18 12 18-12V20z"/><path fill="currentColor" d="m32 17 14 25H18zm0 12-5 9h10z"/></svg>`;
export const brand = `<span class="brand">${emblem}<span>TACTICAL<b>ARENA</b></span></span>`;
export function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!,
  );
}
