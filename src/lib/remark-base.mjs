/**
 * Remark plugin: rewrite root-relative URLs in Markdown (`/media/x.jpg`, `/initiatives/y`)
 * to include Astro's base path, so content written in the CMS works on project pages.
 */
export default function remarkBase({ base = '/' } = {}) {
  const prefix = base.replace(/\/$/, '');
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && typeof node.url === 'string' && node.url.startsWith('/') && !node.url.startsWith('//')) {
      node.url = prefix + node.url;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return (tree) => { if (prefix) walk(tree); };
}
