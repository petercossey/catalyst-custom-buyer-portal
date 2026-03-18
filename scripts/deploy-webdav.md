# WebDAV Deploy

Use [`webdav.env.example`](./webdav.env.example) as the template for `scripts/webdav.env`, then fill in your store WebDAV credentials.

Run from the repo root:

```bash
yarn deploy:webdav
```

Useful options:

```bash
yarn deploy:webdav --env-file ./scripts/webdav.env
yarn deploy:webdav --release-name my-release
yarn deploy:webdav --skip-build
```

Notes:

- `WEBDAV_URL` must end with `/dav`
- The script builds `apps/storefront`, uploads `dist/` to WebDAV, and sets `VITE_ASSETS_ABSOLUTE_PATH` to the CDN asset URL for that release
- If `WEBDAV_CDN_BASE_URL` is omitted, the script derives the CDN asset URL automatically when possible
- If a CDN asset URL cannot be derived, the deploy fails and requires `WEBDAV_CDN_BASE_URL`
- `yarn deploy:webdav` is a thin wrapper around `node ./scripts/deploy-webdav.mjs`, so either entrypoint works if you prefer invoking the script directly
