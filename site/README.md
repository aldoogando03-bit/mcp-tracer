# mcp-tracer website

The landing page for [mcp-tracer](../README.md): a single scrolling page, in English and Spanish, built with Vite, React, TypeScript and [Motion](https://motion.dev). It is a separate package from the MCP server and is not published to npm.

## Develop

```bash
cd site
npm ci
npm run dev      # http://localhost:5173
npm run build    # type-check, then build to dist/
npm run preview  # serve dist/
```

Add `?lang=es` to the URL to open the page in Spanish; the language toggle remembers the last choice.

## Deploy on Vercel

1. In Vercel, choose **Add New… > Project** and import the `mcp-tracer` GitHub repository.
2. Set **Root Directory** to `site`. Vercel detects the **Vite** preset: the build command is `npm run build` and the output directory is `dist`.
3. Click **Deploy**. Every push to `main` deploys again, and pull requests get preview URLs.

## Notes

- Content and translations live in `src/content.ts`. `EXAMPLE_SCRIPT` must stay identical to `examples/small-office-dhcp/script.js`.
- Fonts are self-hosted with Fontsource (Latin subsets), so the page makes no third-party requests.
- Animations use `m` components inside `LazyMotion`, transform strings, and follow `prefers-reduced-motion`.
