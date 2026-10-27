const BAD_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'style', 'audio', 'video']);

export function sanitizeSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return '';
    const walk = (el: Element) => {
      for (const child of [...el.children]) {
        if (BAD_TAGS.has(child.localName.toLowerCase())) child.remove();
        else walk(child);
      }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const v = a.value.trim().toLowerCase();
        if (n.startsWith('on') || ((n === 'href' || n.endsWith(':href')) && /^(javascript|data):/.test(v))) el.removeAttribute(a.name);
      }
    };
    walk(root);
    return new XMLSerializer().serializeToString(root);
  } catch {
    return '';
  }
}
