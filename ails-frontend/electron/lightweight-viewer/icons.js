// Same Lucide outline shapes used by the React desktop chrome, without loading React.
const paths = {
  edit: '<path d="m16 3 5 5M4 16 17 3a2 2 0 0 1 4 4L8 20l-5 1Z"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7M5 12h14"/>',
  'arrow-right': '<path d="m12 5 7 7-7 7M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>', square: '<rect width="16" height="16" x="4" y="4" rx="1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v6h6M8 13h8M8 17h8"/>',
  folder: '<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="6" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><path d="M6 8v10a1 1 0 0 0 1 1h7M6 9h8"/>',
  book: '<path d="M12 7v14m0-14C9 4 5 3 2 3v17c3 0 7 0 10 2 3-2 7-2 10-2V3c-3 0-7 1-10 4Z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  chat: '<path d="M21 15a4 4 0 0 1-4 4H7l-5 3V6a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l4 2"/>',
  scan: '<path d="M4 7V4h3m10 0h3v3m0 10v3h-3M7 20H4v-3M7 8h10M7 12h10M7 16h6"/>',
  settings: '<path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6m6-16-4 20"/>',
  list: '<rect x="3" y="5" width="4" height="4" rx="1"/><rect x="3" y="15" width="4" height="4" rx="1"/><path d="M12 7h9M12 17h9"/>',
}
export function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) node.setAttribute(key, value)
  node.innerHTML = paths[name] || paths.file
  return node
}
