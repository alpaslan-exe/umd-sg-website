/** Prefix a site-relative path with Astro's configured base path. */
export function url(path: string = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (/^(https?:|mailto:|tel:|#)/.test(path)) return path;
  return `${base}/${path.replace(/^\//, '')}`;
}

/** Media paths stored by the CMS are `/media/...`; map them under the base path. */
export function media(path?: string | null): string | undefined {
  if (!path) return undefined;
  return url(path);
}
