import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://winest.vercel.app',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.endsWith('/members/yunaria') &&
        !page.endsWith('/members/yunaria/') &&
        !page.includes('/members/yunaria/'),
    }),
  ],
});
