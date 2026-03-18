# WebDAV Deploy

Use [`webdav.env.example`](./webdav.env.example) as the template for `scripts/webdav.env`, then fill in your store WebDAV credentials.

Run from the repo root:

```bash
node ./scripts/deploy-webdav.mjs
```

Useful options:

```bash
node ./scripts/deploy-webdav.mjs --env-file ./scripts/webdav.env
node ./scripts/deploy-webdav.mjs --release-name my-release
node ./scripts/deploy-webdav.mjs --skip-build
```

Notes:

- `WEBDAV_URL` must end with `/dav`
- The script builds `apps/storefront`, uploads `dist/` to WebDAV, and prints the public URL
- If `WEBDAV_CDN_BASE_URL` is omitted, the CDN URL is derived automatically when possible
