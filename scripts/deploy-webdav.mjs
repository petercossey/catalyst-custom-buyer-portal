#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AuthType, createClient } from 'webdav';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    releaseName: undefined,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--env-file') {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === '--release-name') {
      args.releaseName = argv[index + 1];
      index += 1;
    } else if (arg === '--skip-build') {
      args.skipBuild = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.envFile === undefined && existsSync(path.join(repoRoot, 'scripts', 'webdav.env'))) {
    args.envFile = path.join(repoRoot, 'scripts', 'webdav.env');
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node ./scripts/deploy-webdav.mjs [options]

Options:
  --env-file <path>      Load deployment variables from a file
  --release-name <name>  Override the generated release folder name
  --skip-build           Upload the existing dist output without building
  -h, --help             Show this help

Environment variables:
  WEBDAV_URL
  WEBDAV_USERNAME
  WEBDAV_PASSWORD
  WEBDAV_AUTH_TYPE           Optional: auto, password, digest
  WEBDAV_CDN_BASE_URL        Optional: override the derived CDN asset base URL
  WEBDAV_CONTENT_BASE_PATH   Optional, defaults to /content/b2b-buyer-portal-deployments
  WEBDAV_RELEASE_NAME        Optional fallback if --release-name is not provided
  STORE_APP_DIR              Optional, defaults to apps/storefront
`);
}

function loadEnvFile(filePath) {
  if (filePath === undefined) {
    return {};
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Env file not found: ${absolutePath}`);
  }

  return dotenv.parse(readFileSync(absolutePath, 'utf8'));
}

function getShortGitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'nogit';
  }
}

function createReleaseName() {
  const isoTimestamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `${isoTimestamp}-${getShortGitSha()}`;
}

function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function removeTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function deriveRemoteConfiguration({ webdavUrl, contentBasePath, releaseName }) {
  const normalizedDavUrl = removeTrailingSlash(webdavUrl);

  if (!normalizedDavUrl.endsWith('/dav')) {
    throw new Error('WEBDAV_URL must end with /dav so the public /content URL can be derived.');
  }

  const normalizedContentBasePath = removeTrailingSlash(ensureLeadingSlash(contentBasePath));
  const publicBaseUrl = `${normalizedDavUrl.slice(0, -4)}${normalizedContentBasePath}/${releaseName}/`;
  const davTargetPath = `${normalizedContentBasePath}/${releaseName}`;

  return {
    davBaseUrl: normalizedDavUrl,
    davTargetPath,
    publicBaseUrl,
  };
}

function deriveCdnBaseUrl({ publicBaseUrl, explicitCdnBaseUrl }) {
  if (explicitCdnBaseUrl) {
    return `${removeTrailingSlash(explicitCdnBaseUrl)}/`;
  }

  const publicUrl = new URL(publicBaseUrl);
  const hostMatch = publicUrl.hostname.match(/^store-([^.]+)\.mybigcommerce\.com$/u);

  if (!hostMatch) {
    return undefined;
  }

  return `https://cdn11.bigcommerce.com/s-${hostMatch[1]}${publicUrl.pathname}`;
}

function resolveAssetBaseUrl({ publicBaseUrl, explicitCdnBaseUrl }) {
  const derivedCdnBaseUrl = deriveCdnBaseUrl({
    publicBaseUrl,
    explicitCdnBaseUrl,
  });

  if (derivedCdnBaseUrl) {
    return derivedCdnBaseUrl;
  }

  throw new Error(
    'Unable to determine a CDN asset base URL. Set WEBDAV_CDN_BASE_URL explicitly.',
  );
}

function parseAuthType(value) {
  switch ((value ?? 'auto').toLowerCase()) {
    case 'auto':
      return AuthType.Auto;
    case 'password':
    case 'basic':
      return AuthType.Password;
    case 'digest':
      return AuthType.Digest;
    default:
      throw new Error(`Unsupported WEBDAV_AUTH_TYPE value: ${value}`);
  }
}

function createWebDavClient({ davBaseUrl, username, password, authType }) {
  return createClient(davBaseUrl, {
    authType,
    username,
    password,
  });
}

async function ensureRemoteDirectory({ client, remotePath }) {
  try {
    await client.createDirectory(remotePath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create remote directory ${remotePath}: ${formatError(error)}`);
  }
}

function collectFiles(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(absolutePath);
    }

    if (entry.isFile()) {
      return [absolutePath];
    }

    return [];
  });
}

function guessContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  return contentTypes[extension] ?? 'application/octet-stream';
}

async function uploadFile({ client, remoteRootPath, localFilePath, localRootPath }) {
  const relativePath = path.relative(localRootPath, localFilePath).split(path.sep).join('/');
  const remotePath = `${remoteRootPath}/${relativePath}`;
  const remoteDirectory = path.posix.dirname(remotePath);

  await ensureRemoteDirectory({
    client,
    remotePath: remoteDirectory,
  });

  try {
    await client.putFileContents(remotePath, readFileSync(localFilePath), {
      overwrite: true,
      contentLength: statSync(localFilePath).size,
      headers: {
        'Content-Type': guessContentType(localFilePath),
      },
    });
  } catch (error) {
    throw new Error(`Failed to upload ${relativePath}: ${formatError(error)}`);
  }

  console.log(`uploaded=${relativePath}`);
}

function readManifestEntries(distPath) {
  const manifestPath = path.join(distPath, '.vite', 'manifest.json');

  if (!existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  return Object.values(manifest)
    .filter((entry) => entry && entry.isEntry && entry.file)
    .map((entry) => entry.file);
}

function runBuild({ appDir, assetBaseUrl }) {
  const buildEnv = {
    ...process.env,
    VITE_IS_LOCAL_ENVIRONMENT: 'FALSE',
    VITE_ASSETS_ABSOLUTE_PATH: assetBaseUrl,
  };

  const result = spawnSync('yarn', ['build'], {
    cwd: appDir,
    stdio: 'inherit',
    env: buildEnv,
  });

  if (result.status !== 0) {
    throw new Error(`Build failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function formatError(error) {
  if (error instanceof Error) {
    const details = [];

    if ('response' in error && error.response && typeof error.response === 'object') {
      const status = error.response.status;
      const statusText = error.response.statusText;

      if (status) {
        details.push(`${status}${statusText ? ` ${statusText}` : ''}`);
      }
    }

    if ('request' in error && error.request && typeof error.request === 'object') {
      const method = error.request.method;
      const url = error.request.url;

      if (method || url) {
        details.push([method, url].filter(Boolean).join(' '));
      }
    }

    return details.length > 0 ? `${error.message} (${details.join(', ')})` : error.message;
  }

  return String(error);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = loadEnvFile(args.envFile);
  const env = {
    ...fileEnv,
    ...process.env,
  };

  const webdavUrl = env.WEBDAV_URL;
  const webdavUsername = env.WEBDAV_USERNAME;
  const webdavPassword = env.WEBDAV_PASSWORD;
  const webdavAuthType = parseAuthType(env.WEBDAV_AUTH_TYPE);
  const webdavCdnBaseUrl = env.WEBDAV_CDN_BASE_URL;
  const contentBasePath =
    env.WEBDAV_CONTENT_BASE_PATH ?? '/content/b2b-buyer-portal-deployments';
  const releaseName = args.releaseName ?? env.WEBDAV_RELEASE_NAME ?? createReleaseName();
  const appDir = path.resolve(repoRoot, env.STORE_APP_DIR ?? 'apps/storefront');
  const distDir = path.join(appDir, 'dist');

  for (const [key, value] of Object.entries({
    WEBDAV_URL: webdavUrl,
    WEBDAV_USERNAME: webdavUsername,
    WEBDAV_PASSWORD: webdavPassword,
  })) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const { davBaseUrl, davTargetPath, publicBaseUrl } = deriveRemoteConfiguration({
    webdavUrl,
    contentBasePath,
    releaseName,
  });
  const assetBaseUrl = resolveAssetBaseUrl({
    publicBaseUrl,
    explicitCdnBaseUrl: webdavCdnBaseUrl,
  });

  if (!args.skipBuild) {
    runBuild({ appDir, assetBaseUrl });
  }

  if (!existsSync(distDir)) {
    throw new Error(`Build output not found: ${distDir}`);
  }

  const client = createWebDavClient({
    davBaseUrl,
    authType: webdavAuthType,
    username: webdavUsername,
    password: webdavPassword,
  });

  await ensureRemoteDirectory({
    client,
    remotePath: davTargetPath,
  });

  const files = collectFiles(distDir);

  for (const filePath of files) {
    await uploadFile({
      client,
      remoteRootPath: davTargetPath,
      localFilePath: filePath,
      localRootPath: distDir,
    });
  }

  const entryFiles = readManifestEntries(distDir);

  console.log(`release_name=${releaseName}`);
  console.log(`asset_url=${assetBaseUrl}`);
  console.log(`public_url=${publicBaseUrl}`);
  console.log(`dav_target=${davBaseUrl}${davTargetPath}`);

  if (entryFiles.length > 0) {
    console.log(`entry_files=${entryFiles.join(',')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
