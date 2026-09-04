import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const md = (dir: string) =>
  glob({
    pattern: '**/[^_]*.md',
    base: `./src/content/${dir}`,
    // Post files are named YYYY-MM-DD-slug.md; the URL uses just the slug.
    generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
  });

const board = defineCollection({
  loader: md('board'),
  schema: z.object({
    name: z.string(),
    position: z.string(),
    order: z.number().default(99),
    email: z.string().email().or(z.literal('')).optional(),
    photo: z.string().optional(),
    pronouns: z.string().optional(),
    year: z.string().optional(),
    major: z.string().optional(),
    summary: z.string().optional(),
    fun_fact: z.string().optional(),
    vacant: z.boolean().default(false),
    group: z.enum(['executive', 'directors', 'secretaries']).default('directors'),
  }),
});

const committees = defineCollection({
  loader: md('committees'),
  schema: z.object({
    name: z.string(),
    order: z.number().default(99),
    chair: z.string().optional(),
    chairEmail: z.string().email().or(z.literal('')).optional(),
    viceChair: z.string().optional(),
    meets: z.string().optional(),
    summary: z.string().optional(),
  }),
});

const initiatives = defineCollection({
  loader: md('initiatives'),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    status: z.enum(['active', 'upcoming', 'past']).default('active'),
    featured: z.boolean().default(false),
    order: z.number().default(99),
    image: z.string().optional(),
    tagline: z.string().optional(),
    cta_label: z.string().optional(),
    cta_url: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  }),
});

const posts = defineCollection({
  loader: md('posts'),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    image: z.string().optional(),
    image_alt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    author: z.string().optional(),
  }),
});

const events = defineCollection({
  loader: md('events'),
  schema: z.object({
    title: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().optional(),
    all_day: z.boolean().default(false),
    location: z.string().optional(),
    url: z.string().optional(),
    summary: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const documents = defineCollection({
  loader: md('documents'),
  schema: z.object({
    title: z.string(),
    category: z.enum(['Governing', 'Meetings', 'Elections', 'Resources']),
    url: z.string(),
    date: z.string().optional(),
    summary: z.string().optional(),
    order: z.number().default(99),
    mirror_url: z.string().optional(),
  }),
});

const services = defineCollection({
  loader: md('services'),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string().optional(),
    cta: z.string().optional(),
    order: z.number().default(99),
    icon: z.string().default('star'),
  }),
});

export const collections = { board, committees, initiatives, posts, events, documents, services };
