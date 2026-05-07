// Lightweight HTML template substitution.
// Replaces `__BASE_HREF__` with `${basePath}/` (or `/` if no prefix configured).

export function renderTemplate(html, config) {
  const baseHref = (config?.basePath ? config.basePath : '') + '/';
  return html.replaceAll('__BASE_HREF__', baseHref);
}
