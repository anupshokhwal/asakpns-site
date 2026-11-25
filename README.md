# asakpns-site

Company website for ASAKPNS, live at https://asakpns.com.

Plain HTML and CSS, no build step. Hosted on Cloudflare as the `asakpns` Worker (static assets).
Every push to `main` deploys automatically once Cloudflare is connected to this repository.

- `public/index.html`: home page
- `public/privacy.html`: privacy policy (website and apps)
- `public/styles.css`: brand colors and layout
- `public/favicon.svg`: browser-tab icon
- `public/sitemap.xml`, `public/robots.txt`: for search engines
- `wrangler.jsonc`: Cloudflare config (Worker name and the folder to publish)
