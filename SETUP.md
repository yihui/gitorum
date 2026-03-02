# Gitorum — Admin Setup Guide

This guide walks you through setting up Gitorum as a forum administrator.

---

## 1. Prerequisites

1. **A GitHub repository with Discussions enabled**
   - Go to your repo → Settings → General → scroll to "Features" → check "Discussions"
   - Create Discussion categories that map to your forum categories (e.g. "General", "Help", "Announcements")

2. **Node.js 18+** installed locally for development

---

## 2. Environment Variables

Gitorum is configured entirely through environment variables. **Secret variables (tokens, keys, client secrets) should never be stored in `.env` files committed to version control.** Instead, set them via your hosting platform's dashboard (see [Deployment](#6-deployment)).

The `.env.example` file documents all supported variables but does not contain real values. For local development, you can create a `.env` file — just make sure it stays in `.gitignore` (which it is by default).

### Required

| Variable | Description |
|----------|-------------|
| `GITHUB_REPO_OWNER` | GitHub username or org that owns the Discussions repo |
| `GITHUB_REPO_NAME` | Name of the repo with Discussions enabled |

### GitHub App (required for API access)

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Your GitHub App's numeric ID |
| `GITHUB_APP_PRIVATE_KEY` | Contents of the `.pem` private key (paste as-is or replace newlines with `\n`) |
| `GITHUB_APP_INSTALLATION_ID` | The installation ID for your repository |

### OAuth (for user sign-in / posting)

| Variable | Description |
|----------|-------------|
| `GITHUB_OAUTH_CLIENT_ID` | From your GitHub OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | From your GitHub OAuth App |
| `BASE_URL` | Your production URL (e.g. `https://forum.example.com`) |

### Customization (optional)

| Variable | Description |
|----------|-------------|
| `FORUM_TITLE` | Custom forum title (default: `Gitorum`) |
| `FORUM_LOGO_URL` | URL to a custom logo image (replaces the default SVG icon) |
| `FORUM_FOOTER_HTML` | Custom footer content in Markdown format (rendered and sanitized before display) |

### Secrets Best Practices

- **Never commit secrets to git.** The `.env` file is in `.gitignore` by default.
- **Use your hosting platform's environment variable settings** to configure secrets in production (Cloudflare dashboard, Vercel dashboard, etc.).
- **Rotate secrets regularly.** GitHub App private keys and OAuth client secrets can be regenerated from the GitHub settings pages.
- **Keep the private key secure.** The `.pem` file downloaded when creating a GitHub App contains the private key. Store it securely and delete it after copying the value to your hosting platform.

---

## 3. Setting Up a GitHub App (Required)

A GitHub App provides automatic short-lived token generation (tokens expire after 1 hour and are renewed automatically). When a token's rate limit is exhausted, Gitorum will automatically generate a new one and retry the request.

### Step 1: Create the GitHub App

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
   (Direct link: https://github.com/settings/apps/new)

2. Fill in the form:
   - **GitHub App name**: `Gitorum Forum` (or any unique name)
   - **Homepage URL**: Your forum's URL
   - **Webhook**: Uncheck "Active" (not needed)

3. Set **Permissions**:
   - Under "Repository permissions":
     - **Discussions**: Read-only
     - **Metadata**: Read-only (auto-selected)
   - No other permissions needed

4. Under "Where can this GitHub App be installed?": Select "Only on this account"

5. Click **Create GitHub App**

### Step 2: Generate a Private Key

1. On the App settings page, scroll to "Private keys"
2. Click **Generate a private key**
3. A `.pem` file will download — keep it safe and delete it after copying the value

### Step 3: Install the App on Your Repo

1. Go to your App's page → "Install App" tab
2. Click **Install** next to your account
3. Select "Only select repositories" → choose your Discussions repository
4. Click **Install**

### Step 4: Gather the IDs

You need three values:

| Variable | Where to find it |
|----------|-----------------|
| `GITHUB_APP_ID` | Your App's settings page → "App ID" at the top |
| `GITHUB_APP_PRIVATE_KEY` | Contents of the `.pem` file (paste as-is, or replace newlines with `\n`) |
| `GITHUB_APP_INSTALLATION_ID` | Go to Settings → Integrations → your app → the number in the URL (e.g. `https://github.com/settings/installations/12345678` → `12345678`) |

### Step 5: Set Environment Variables

Set these on your **hosting platform's dashboard** (not in `.env` files):

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----
GITHUB_APP_INSTALLATION_ID=12345678
```

> **Note:** The private key can be pasted as-is (with real newlines) or with newlines escaped as `\n` — both formats are accepted. Most platforms (Cloudflare, Vercel) support multi-line secrets in their dashboard UI. If setting via shell, wrap the value in double quotes.

When these are set, Gitorum will automatically generate short-lived installation tokens for read requests and renew them when they expire or hit rate limits.

---

## 4. Setting Up GitHub OAuth (for user sign-in)

This allows users to sign in and create threads/replies.

1. Go to **Settings → Developer settings → OAuth Apps → New OAuth App**
   (Direct link: https://github.com/settings/developers)

2. Fill in the form:
   - **Application name**: `Gitorum`
   - **Homepage URL**: `https://yourdomain.com`
   - **Authorization callback URL**: `https://yourdomain.com/auth/callback`

3. Click **Register application**

4. Copy the **Client ID** and generate a **Client Secret**

5. Set on your **hosting platform's dashboard**:
   ```
   GITHUB_OAUTH_CLIENT_ID=xxxxxxxxxxxxxxxxxx
   GITHUB_OAUTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxx
   BASE_URL=https://yourdomain.com
   ```

---

## 5. Caching Strategy

### Server-Side In-Memory Cache (built-in)

All GitHub API read operations are cached in memory on the SvelteKit server:

| Data | TTL |
|------|-----|
| Categories | 2 minutes |
| Thread lists | 1 minute |
| Thread detail | 1 minute |
| Search results | 1 minute |
| Repo ID | 1 hour |

This deduplicates GitHub API calls within a single server process, so repeated page loads within the TTL window hit the cache rather than the API.

### Why CDN/browser caching is disabled

Every page in Gitorum includes an auth-aware header (showing either "Sign in with GitHub" or the signed-in user's avatar). Because the same URL serves different HTML depending on whether the visitor is logged in, responses are sent with `Cache-Control: no-store` — meaning no CDN or browser will cache the HTML.

Without this, CDNs such as Cloudflare would serve the same cached anonymous page to logged-in users, because CDNs do not vary their cache key by cookie value by default.

Page **performance** is not significantly impacted: the in-memory cache absorbs repeated GitHub API calls, so the server can respond quickly without hitting the API on every request. The only cost is that each browser request reaches the SvelteKit server rather than a CDN edge node.

**Is per-group caching possible?** Technically, a CDN *Vary* on a cookie is possible but most CDNs (including Cloudflare) do not support it out of the box. Maintaining two separate cache namespaces (logged-in / logged-out) would require a custom CDN Worker and additional complexity. The in-memory cache is sufficient for a forum workload.

---

## 6. Deployment

### Cloudflare Pages (recommended)

1. Push your code to GitHub
2. Go to Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. Select your repository and configure:
   - **Build command**: `npm run build`
   - **Build output directory**: `.svelte-kit/cloudflare`
   - **Node.js version**: `18` or later
4. **Add all environment variables in Settings → Environment variables** — this is where secrets (App private key, OAuth client secret) should be set
5. Set the OAuth callback URL in your GitHub OAuth App to match your production domain

### Vercel

1. Push your code to GitHub
2. Import the repo in Vercel dashboard
3. Vercel auto-detects SvelteKit — no special config needed
4. **Add all environment variables in Project Settings → Environment Variables** — this is where secrets should be set
5. Set the OAuth callback URL in your GitHub OAuth App to match your production domain

---

## 7. Environment Variables Reference

The following variables are supported. **Set secret values on your hosting platform, not in code.**

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `GITHUB_REPO_OWNER` | Yes | No | Repository owner |
| `GITHUB_REPO_NAME` | Yes | No | Repository name |
| `GITHUB_APP_ID` | Yes | No | GitHub App numeric ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes | **Yes** | GitHub App private key (PEM format; paste as-is or `\n`-escaped) |
| `GITHUB_APP_INSTALLATION_ID` | Yes | No | GitHub App installation ID |
| `GITHUB_OAUTH_CLIENT_ID` | For auth | No | OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | For auth | **Yes** | OAuth App client secret |
| `BASE_URL` | For auth | No | Production URL for OAuth callback |
| `FORUM_TITLE` | No | No | Custom forum title |
| `FORUM_LOGO_URL` | No | No | Custom logo image URL |
| `FORUM_FOOTER_HTML` | No | No | Custom footer (Markdown) |
