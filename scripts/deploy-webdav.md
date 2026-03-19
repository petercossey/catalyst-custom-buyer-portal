# WebDAV Deploy

Use [`webdav.env.example`](./webdav.env.example) as the template for `scripts/webdav.env`, then fill in your store WebDAV credentials.

This deploy flow is intended for custom Buyer Portal releases that Catalyst loads from an external base URL, not for the hosted `headless.js -> storefrontScript(...)` path.

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
- The build is forced to use stable entry filenames by setting `VITE_DISABLE_BUILD_HASH=TRUE`
- Cache invalidation happens through the unique release directory, not hashed entry filenames
- If `WEBDAV_CDN_BASE_URL` is omitted, the script derives the CDN asset URL automatically when possible
- If a CDN asset URL cannot be derived, the deploy fails and requires `WEBDAV_CDN_BASE_URL`
- `yarn deploy:webdav` is a thin wrapper around `node ./scripts/deploy-webdav.mjs`, so either entrypoint works if you prefer invoking the script directly

Expected output contract for Catalyst:

- Use the emitted `asset_url` as `PROD_BUYER_PORTAL_BASE_URL`
- Load entry files directly from that base URL
- Do not fetch `.vite/manifest.json` for this deployment path

The stable entry filenames for this contract are:

- `index.js`
- `index-legacy.js`
- `polyfills-legacy.js`

Example:

```text
asset_url=https://cdn11.bigcommerce.com/s-<store-hash>/content/b2b-buyer-portal-deployments/20260319T012345Z-abc1234/
```

Catalyst should then load:

```text
https://cdn11.bigcommerce.com/s-<store-hash>/content/b2b-buyer-portal-deployments/20260319T012345Z-abc1234/index.js
https://cdn11.bigcommerce.com/s-<store-hash>/content/b2b-buyer-portal-deployments/20260319T012345Z-abc1234/index-legacy.js
https://cdn11.bigcommerce.com/s-<store-hash>/content/b2b-buyer-portal-deployments/20260319T012345Z-abc1234/polyfills-legacy.js
```
