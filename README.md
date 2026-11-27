# asakpns-site

Company website for ASAKPNS, live at https://asakpns.com.

Plain HTML and CSS, no build step. Hosted on Cloudflare as the `asakpns` Worker (static assets).
Every push to `main` deploys automatically once Cloudflare is connected to this repository.

- `public/index.html`: home page
- `public/privacy.html`: privacy policy (website and apps)
- `public/styles.css`: brand colors and layout
- `public/favicon.svg`: browser-tab icon
- `public/sitemap.xml`, `public/robots.txt`: for search engines
- `public/og-image.png`: preview image when the site is shared (WhatsApp, LinkedIn, X)
- `public/apple-touch-icon.png`, `public/logo-512.png`: icon and logo for phones and Google
- SEO: page titles and descriptions, Open Graph tags and Organization structured data are in each page's `<head>`. `www.asakpns.com` redirects to `asakpns.com` (src/index.js).
- `wrangler.jsonc`: Cloudflare config (Worker name and the folder to publish)

Deployed automatically by Cloudflare Workers Builds on every push to `main`.
