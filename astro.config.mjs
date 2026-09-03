// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkBase from './src/lib/remark-base.mjs';

// SITE_URL / BASE_PATH are injected by the GitHub Actions workflow so the
// same code works as a project page (owner.github.io/repo) today and as an
// org page or custom domain later without editing this file.
const site = process.env.SITE_URL ?? 'https://alpaslan-exe.github.io';
const base = (process.env.BASE_PATH ?? '/umd-sg-website').replace(/\/$/, '') || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: { format: 'directory' },
  markdown: { processor: unified({ remarkPlugins: [[remarkBase, { base }]] }) },
});
