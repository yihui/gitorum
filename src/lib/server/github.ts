import { graphql } from '@octokit/graphql';
import { env } from '$env/dynamic/private';

const COMMENTS_PER_PAGE = 100; // GitHub GraphQL max per request

// ---------------------------------------------------------------------------
// In-memory cache (server-side, survives across requests within one process)
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | undefined {
	const entry = cache.get(key) as CacheEntry<T> | undefined;
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		cache.delete(key);
		return undefined;
	}
	return entry.data;
}

function setCache<T>(key: string, data: T, ttlSeconds: number): void {
	cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ---------------------------------------------------------------------------
// Rate-limit error detection
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {
	constructor(message: string = 'GitHub API rate limit exceeded') {
		super(message);
		this.name = 'RateLimitError';
	}
}

function isRateLimitError(err: unknown): boolean {
	if (err instanceof Error) {
		const msg = err.message.toLowerCase();
		return msg.includes('rate limit') || msg.includes('api rate limit');
	}
	return false;
}

// ---------------------------------------------------------------------------
// GitHub App installation token support
// ---------------------------------------------------------------------------

interface AppToken {
	token: string;
	expiresAt: number;
}

/**
 * Encode a DER length value.
 */
function derLength(len: number): number[] {
	if (len < 128) return [len];
	if (len < 256) return [0x81, len];
	return [0x82, (len >> 8) & 0xff, len & 0xff];
}

/**
 * Convert a PKCS#1 RSA private key (DER) to PKCS#8 (unencrypted PrivateKeyInfo).
 * GitHub App private keys are downloaded in PKCS#1 format; Web Crypto requires PKCS#8.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
	// AlgorithmIdentifier: SEQUENCE { OID rsaEncryption (1.2.840.113549.1.1.1), NULL }
	const algorithmId = new Uint8Array([
		0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
	]);
	const versionBytes = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0
	const octetHeader = new Uint8Array([0x04, ...derLength(pkcs1.length)]);
	const innerLen =
		versionBytes.length + algorithmId.length + octetHeader.length + pkcs1.length;
	const seqHeader = new Uint8Array([0x30, ...derLength(innerLen)]);

	const pkcs8 = new Uint8Array(seqHeader.length + innerLen);
	let offset = 0;
	pkcs8.set(seqHeader, offset);
	offset += seqHeader.length;
	pkcs8.set(versionBytes, offset);
	offset += versionBytes.length;
	pkcs8.set(algorithmId, offset);
	offset += algorithmId.length;
	pkcs8.set(octetHeader, offset);
	offset += octetHeader.length;
	pkcs8.set(pkcs1, offset);
	return pkcs8;
}

let appTokenCache: AppToken | null = null;

function hasAppConfig(): boolean {
	return !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID);
}

/**
 * Generate a JWT for a GitHub App, then exchange it for an installation token.
 * If `forceRefresh` is true, bypass the cache to get a fresh token (used on
 * rate-limit to rotate tokens automatically).
 */
async function getAppInstallationToken(forceRefresh = false): Promise<string | null> {
	const appId = env.GITHUB_APP_ID;
	const privateKeyRaw = env.GITHUB_APP_PRIVATE_KEY;
	const installationId = env.GITHUB_APP_INSTALLATION_ID;

	if (!appId || !privateKeyRaw || !installationId) return null;

	// Return cached token if still valid (with 60s buffer) and not forced
	if (!forceRefresh && appTokenCache && Date.now() < appTokenCache.expiresAt - 60_000) {
		return appTokenCache.token;
	}

	// Build JWT using Web Crypto (works in Node 18+ and edge runtimes)
	const now = Math.floor(Date.now() / 1000);
	const payload = { iat: now - 60, exp: now + 600, iss: appId };

	// Support both literal-\n (escaped) and actual newlines so the PEM can be
	// pasted as-is from the downloaded .pem file without any manual escaping.
	const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

	const isPkcs1 = privateKey.includes('-----BEGIN RSA PRIVATE KEY-----');
	const pemBody = privateKey
		.replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
		.replace(/-----END RSA PRIVATE KEY-----/, '')
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s/g, '');
	const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
	// GitHub App keys are PKCS#1; Web Crypto requires PKCS#8.
	const keyBytes = isPkcs1 ? pkcs1ToPkcs8(binaryKey) : binaryKey;
	// .slice() on ArrayBufferLike returns ArrayBufferLike, but Web Crypto requires a plain
	// ArrayBuffer. The cast is safe because both pkcs1ToPkcs8 and Uint8Array.from() always
	// allocate a regular ArrayBuffer (never a SharedArrayBuffer).
	const keyBuffer = keyBytes.buffer.slice(
		keyBytes.byteOffset,
		keyBytes.byteOffset + keyBytes.byteLength
	) as ArrayBuffer;

	let cryptoKey: CryptoKey;
	try {
		cryptoKey = await crypto.subtle.importKey(
			'pkcs8',
			keyBuffer,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['sign']
		);
	} catch (err) {
		console.error(
			`Failed to import GitHub App private key (detected format: ${isPkcs1 ? 'PKCS#1' : 'PKCS#8'}):`,
			err
		);
		return null;
	}

	const enc = new TextEncoder();
	const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
	const body = btoa(JSON.stringify(payload))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
	const sigInput = enc.encode(`${header}.${body}`);
	const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, sigInput);
	const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
	const jwt = `${header}.${body}.${sig}`;

	try {
		const res = await fetch(
			`https://api.github.com/app/installations/${installationId}/access_tokens`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: 'application/vnd.github+json',
					'User-Agent': 'Gitorum'
				}
			}
		);

		if (!res.ok) {
			console.error('Failed to get installation token:', res.status, await res.text());
			return null;
		}

		const data = await res.json();
		appTokenCache = {
			token: data.token,
			expiresAt: new Date(data.expires_at).getTime()
		};
		return data.token;
	} catch (err) {
		console.error('Error fetching installation token:', err);
		return null;
	}
}

// ---------------------------------------------------------------------------
// GraphQL client helpers
// ---------------------------------------------------------------------------

function getRequiredEnv(key: string): string {
	const value = env[key];
	if (!value) throw new Error(`Missing environment variable: ${key}`);
	return value;
}

/** Best available server-side read token (GitHub App). */
async function getServerToken(): Promise<string | null> {
	return await getAppInstallationToken();
}

/** Returns the best available token for read operations (App token or user OAuth). */
async function getReadToken(userToken?: string | null): Promise<string | null> {
	return (await getServerToken()) || userToken || null;
}

/**
 * Execute a read query with automatic retry on rate limit.
 * If a GitHub App is configured and the first attempt hits a rate limit,
 * forces a token refresh and retries once.
 */
async function executeGraphQLRead<T>(
	token: string,
	queryFn: (gql: ReturnType<typeof graphql.defaults>) => Promise<T>
): Promise<T> {
	const gql = graphql.defaults({ headers: { authorization: `bearer ${token}` } });
	try {
		return await queryFn(gql);
	} catch (err) {
		if (isRateLimitError(err) && hasAppConfig()) {
			appTokenCache = null;
			const freshToken = await getAppInstallationToken(true);
			if (freshToken) {
				const freshGql = graphql.defaults({ headers: { authorization: `bearer ${freshToken}` } });
				return await queryFn(freshGql);
			}
		}
		if (isRateLimitError(err)) {
			throw new RateLimitError();
		}
		throw err;
	}
}

export function getUserClient(token: string) {
	return graphql.defaults({ headers: { authorization: `bearer ${token}` } });
}

export function getRepoOwner(): string {
	return getRequiredEnv('GITHUB_REPO_OWNER');
}

export function getRepoName(): string {
	return getRequiredEnv('GITHUB_REPO_NAME');
}

// ---------------------------------------------------------------------------
// Exported data functions (GraphQL via GitHub App or user token)
// ---------------------------------------------------------------------------

export async function fetchCategories(userToken?: string | null) {
	const cacheKey = 'categories';
	const cached = getCached<any[]>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!) {
				repository(owner: $owner, name: $repo) {
					discussionCategories(first: 20) {
						nodes { id name description emoji emojiHTML slug }
					}
				}
			}`,
			{ owner, repo }
		)
	);
	// Replace the shortcode emoji (e.g. ":speaking_head:") with the actual
	// Unicode character extracted from the emojiHTML field (e.g. "<div>🗣</div>").
	const categories = result.repository.discussionCategories.nodes.map((cat: any) => ({
		...cat,
		emoji: cat.emojiHTML ? cat.emojiHTML.replace(/<[^>]*>/g, '').trim() : cat.emoji
	}));

	setCache(cacheKey, categories, 120);
	return categories;
}

// ---------------------------------------------------------------------------
// Page-cursor cache for numbered pagination (server-side, per process)
// Key: `${categoryId}:${orderBy}`, Value: Map<pageNum, endCursor>
// map.get(N) is the endCursor of page N (used as "after" to fetch page N+1).
// ---------------------------------------------------------------------------
const pageCursorCache = new Map<string, Map<number, string>>();

// Comment-page cursor cache: Map<threadNumber, string[]>
// cursors[i] = endCursor after comment page i+1 (used to fetch page i+2).
const commentCursorCache = new Map<number, string[]>();

export async function fetchCategoryBySlug(slug: string, userToken?: string | null) {
	const categories = await fetchCategories(userToken);
	return categories.find((c: any) => c.slug === slug) || null;
}

export async function fetchThreadsByCategory(
	categoryId: string,
	first: number = 20,
	after?: string,
	orderBy: string = 'UPDATED_AT',
	userToken?: string | null
) {
	const cacheKey = `threads:${categoryId}:${first}:${after || ''}:${orderBy}`;
	const cached = getCached<any>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $categoryId: ID!, $first: Int!, $after: String, $orderBy: DiscussionOrderField!) {
				repository(owner: $owner, name: $repo) {
					discussions(first: $first, categoryId: $categoryId, after: $after, orderBy: { field: $orderBy, direction: DESC }) {
						totalCount
						pageInfo { hasNextPage endCursor }
						nodes {
							id number title createdAt isAnswered
							author { login avatarUrl url }
							labels(first: 10) { nodes { name color } }
							comments { totalCount }
							reactions { totalCount }
						}
					}
				}
			}`,
			{ owner, repo, categoryId, first, after: after || null, orderBy }
		)
	);
	const discussions = result.repository.discussions;

	setCache(cacheKey, discussions, 60);
	return discussions;
}

/**
 * Fetch discussions without category filter (for the homepage).
 */
export async function fetchAllDiscussions(
	first: number = 20,
	after?: string,
	orderBy: string = 'UPDATED_AT',
	userToken?: string | null
) {
	const cacheKey = `allThreads:${first}:${after || ''}:${orderBy}`;
	const cached = getCached<any>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $first: Int!, $after: String, $orderBy: DiscussionOrderField!) {
				repository(owner: $owner, name: $repo) {
					discussions(first: $first, after: $after, orderBy: { field: $orderBy, direction: DESC }) {
						totalCount
						pageInfo { hasNextPage endCursor }
						nodes {
							id number title createdAt isAnswered
							author { login avatarUrl url }
							category { id name slug emoji emojiHTML }
							labels(first: 10) { nodes { name color } }
							comments { totalCount }
							reactions { totalCount }
						}
					}
				}
			}`,
			{ owner, repo, first, after: after || null, orderBy }
		)
	);
	const discussions = result.repository.discussions;
	for (const d of discussions.nodes) parseCategoryEmoji(d.category);

	setCache(cacheKey, discussions, 60);
	return discussions;
}

// ---------------------------------------------------------------------------
// Bidirectional pagination: fetch from end using `last`, build cursors from
// whichever end is closer, and use `last: N` for pages near the end.
// ---------------------------------------------------------------------------
const CURSOR_BATCH_SIZE = 100;

/** Lightweight query for totalCount (cached 60s). */
async function getDiscussionTotalCount(
	categoryId: string | null,
	userToken?: string | null
): Promise<number> {
	const cacheKey = `totalCount:${categoryId || 'all'}`;
	const cached = getCached<number>(cacheKey);
	if (cached !== undefined) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);
	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const categoryParam = categoryId ? ', $categoryId: ID!' : '';
	const categoryArg = categoryId ? ', categoryId: $categoryId' : '';
	const variables: Record<string, unknown> = { owner, repo };
	if (categoryId) variables.categoryId = categoryId;

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!${categoryParam}) {
				repository(owner: $owner, name: $repo) {
					discussions(first: 1${categoryArg}) { totalCount }
				}
			}`,
			variables
		)
	);
	const count = result.repository.discussions.totalCount;
	setCache(cacheKey, count, 60);
	return count;
}

/**
 * Fetch threads for a category from the end using `last` parameter.
 * Returns the last N items in the connection (for pages near the end).
 */
async function fetchThreadsByCategoryFromEnd(
	categoryId: string,
	last: number,
	orderBy: string = 'UPDATED_AT',
	userToken?: string | null
) {
	const cacheKey = `threadsLast:${categoryId}:${last}:${orderBy}`;
	const cached = getCached<any>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);
	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $categoryId: ID!, $last: Int!, $orderBy: DiscussionOrderField!) {
				repository(owner: $owner, name: $repo) {
					discussions(last: $last, categoryId: $categoryId, orderBy: { field: $orderBy, direction: DESC }) {
						totalCount
						nodes {
							id number title createdAt isAnswered
							author { login avatarUrl url }
							labels(first: 10) { nodes { name color } }
							comments { totalCount }
							reactions { totalCount }
						}
					}
				}
			}`,
			{ owner, repo, categoryId, last, orderBy }
		)
	);
	const discussions = result.repository.discussions;
	setCache(cacheKey, discussions, 60);
	return discussions;
}

/**
 * Fetch all discussions from the end using `last` parameter.
 */
async function fetchAllDiscussionsFromEnd(
	last: number,
	orderBy: string = 'UPDATED_AT',
	userToken?: string | null
) {
	const cacheKey = `allThreadsLast:${last}:${orderBy}`;
	const cached = getCached<any>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);
	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $last: Int!, $orderBy: DiscussionOrderField!) {
				repository(owner: $owner, name: $repo) {
					discussions(last: $last, orderBy: { field: $orderBy, direction: DESC }) {
						totalCount
						nodes {
							id number title createdAt isAnswered
							author { login avatarUrl url }
							category { id name slug emoji emojiHTML }
							labels(first: 10) { nodes { name color } }
							comments { totalCount }
							reactions { totalCount }
						}
					}
				}
			}`,
			{ owner, repo, last, orderBy }
		)
	);
	const discussions = result.repository.discussions;
	for (const d of discussions.nodes) parseCategoryEmoji(d.category);
	setCache(cacheKey, discussions, 60);
	return discussions;
}

/**
 * Fetch a specific page by using `last: N` and slicing.
 * Works when totalCount - (page-1)*perPage ≤ 100.
 * The `last` result contains items from the requested page onward to the end;
 * we slice the first `perPage` items which are exactly the requested page.
 */
async function fetchPageUsingLast(
	categoryId: string | null,
	page: number,
	perPage: number,
	totalCount: number,
	orderBy: string,
	userToken?: string | null
) {
	const lastParam = Math.min(totalCount - (page - 1) * perPage, CURSOR_BATCH_SIZE);
	const data = categoryId
		? await fetchThreadsByCategoryFromEnd(categoryId, lastParam, orderBy, userToken)
		: await fetchAllDiscussionsFromEnd(lastParam, orderBy, userToken);

	const pageNodes = data.nodes.slice(0, Math.min(perPage, data.nodes.length));
	const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

	return {
		totalCount: data.totalCount,
		nodes: pageNodes,
		pageInfo: { hasNextPage: page < totalPages, endCursor: null }
	};
}

// ---------------------------------------------------------------------------
// Forward cursor building (from start): fetch 100 edges at a time
// ---------------------------------------------------------------------------
async function fetchCursorEdges(
	batchSize: number,
	after: string | undefined,
	orderBy: string,
	categoryId: string | null,
	userToken?: string | null
): Promise<Array<{ cursor: string }>> {
	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);
	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const categoryParam = categoryId ? ', $categoryId: ID!' : '';
	const categoryArg = categoryId ? ', categoryId: $categoryId' : '';
	const variables: Record<string, unknown> = { owner, repo, first: batchSize, after: after || null, orderBy };
	if (categoryId) variables.categoryId = categoryId;

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $first: Int!, $after: String, $orderBy: DiscussionOrderField!${categoryParam}) {
				repository(owner: $owner, name: $repo) {
					discussions(first: $first${categoryArg}, after: $after, orderBy: { field: $orderBy, direction: DESC }) {
						edges { cursor }
					}
				}
			}`,
			variables
		)
	);
	return result.repository.discussions.edges;
}

// ---------------------------------------------------------------------------
// Backward cursor building (from end): fetch 100 edges using `last`
// ---------------------------------------------------------------------------
async function fetchCursorEdgesFromEnd(
	batchSize: number,
	before: string | undefined,
	orderBy: string,
	categoryId: string | null,
	userToken?: string | null
): Promise<Array<{ cursor: string }>> {
	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);
	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const categoryParam = categoryId ? ', $categoryId: ID!' : '';
	const categoryArg = categoryId ? ', categoryId: $categoryId' : '';
	const variables: Record<string, unknown> = { owner, repo, last: batchSize, before: before || null, orderBy };
	if (categoryId) variables.categoryId = categoryId;

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $last: Int!, $before: String, $orderBy: DiscussionOrderField!${categoryParam}) {
				repository(owner: $owner, name: $repo) {
					discussions(last: $last${categoryArg}, before: $before, orderBy: { field: $orderBy, direction: DESC }) {
						edges { cursor }
					}
				}
			}`,
			variables
		)
	);
	return result.repository.discussions.edges;
}

// ---------------------------------------------------------------------------
// Cursor cache helpers
// ---------------------------------------------------------------------------

function getCachedCursor(storeKey: string, pageNum: number): string | undefined {
	return pageCursorCache.get(storeKey)?.get(pageNum);
}

function cacheCursor(storeKey: string, pageNum: number, cursor?: string | null): void {
	if (!cursor) return;
	let map = pageCursorCache.get(storeKey);
	if (!map) {
		map = new Map();
		pageCursorCache.set(storeKey, map);
	}
	map.set(pageNum, cursor);
}

/**
 * Build page-boundary cursors from the START of the connection.
 * Each batch of 100 edges yields ~5 page cursors (100 / perPage).
 */
async function buildCursorsFromStart(
	storeKey: string,
	targetPage: number,
	perPage: number,
	orderBy: string,
	categoryId: string | null,
	userToken?: string | null
): Promise<void> {
	if (getCachedCursor(storeKey, targetPage - 1)) return;

	// Find the highest consecutive page cursor from start
	let lastBuiltPage = 0;
	for (let p = 1; p < targetPage; p++) {
		if (getCachedCursor(storeKey, p)) {
			lastBuiltPage = p;
		} else {
			break;
		}
	}

	while (lastBuiltPage < targetPage - 1) {
		const afterCursor = lastBuiltPage > 0 ? getCachedCursor(storeKey, lastBuiltPage) : undefined;
		const edges = await fetchCursorEdges(CURSOR_BATCH_SIZE, afterCursor, orderBy, categoryId, userToken);
		if (edges.length === 0) break;

		// Extract page boundary cursors: every perPage-th edge
		for (let i = perPage - 1; i < edges.length; i += perPage) {
			const pageNum = lastBuiltPage + Math.floor(i / perPage) + 1;
			cacheCursor(storeKey, pageNum, edges[i].cursor);
		}

		lastBuiltPage += Math.floor(edges.length / perPage);
		if (edges.length < CURSOR_BATCH_SIZE) break;
	}
}

/**
 * Build page-boundary cursors from the END of the connection.
 * Uses `last` + `before` to walk backward through the list.
 * Each batch of 100 edges yields ~5 page cursors.
 */
async function buildCursorsFromEnd(
	storeKey: string,
	targetPage: number,
	perPage: number,
	totalCount: number,
	orderBy: string,
	categoryId: string | null,
	userToken?: string | null
): Promise<void> {
	if (getCachedCursor(storeKey, targetPage - 1)) return;

	let fetchedFromEnd = 0;
	let beforeCursor: string | undefined = undefined;

	while (!getCachedCursor(storeKey, targetPage - 1)) {
		const edges = await fetchCursorEdgesFromEnd(
			CURSOR_BATCH_SIZE, beforeCursor, orderBy, categoryId, userToken
		);
		if (edges.length === 0) break;

		// This batch covers items at positions:
		//   batchStart .. batchEnd (1-indexed)
		const batchStart = totalCount - fetchedFromEnd - edges.length + 1;
		const batchEnd = totalCount - fetchedFromEnd;

		// Page boundary: position P (multiple of perPage) is endCursor of page P/perPage
		const firstBoundary = Math.ceil(batchStart / perPage) * perPage;
		for (let pos = firstBoundary; pos <= batchEnd; pos += perPage) {
			const pageNum = Math.floor(pos / perPage);
			const idx = pos - batchStart; // 0-indexed in edges
			if (idx >= 0 && idx < edges.length) {
				cacheCursor(storeKey, pageNum, edges[idx].cursor);
			}
		}

		fetchedFromEnd += edges.length;
		// Use first edge's cursor as `before` for the next backward batch
		beforeCursor = edges[0].cursor;

		if (edges.length < CURSOR_BATCH_SIZE) break;
	}
}

/**
 * Unified page fetcher. Picks the cheapest strategy:
 * 1. Page 1 → forward fetch (no cursor)
 * 2. Cached cursor → forward fetch
 * 3. Pages near end (≤100 items from end) → `last: N` fetch (O(1) API calls)
 * 4. Otherwise → build cursor chain from closer end, then forward fetch
 */
async function fetchDiscussionPage(
	storeKey: string,
	categoryId: string | null,
	page: number,
	perPage: number,
	orderBy: string,
	userToken?: string | null
) {
	const fetchData = (after?: string) => categoryId
		? fetchThreadsByCategory(categoryId, perPage, after, orderBy, userToken)
		: fetchAllDiscussions(perPage, after, orderBy, userToken);

	// Page 1: no cursor needed
	if (page === 1) {
		const data = await fetchData();
		cacheCursor(storeKey, 1, data?.pageInfo?.endCursor);
		return data;
	}

	// Check cached forward cursor
	const cached = getCachedCursor(storeKey, page - 1);
	if (cached) {
		const data = await fetchData(cached);
		cacheCursor(storeKey, page, data?.pageInfo?.endCursor);
		return data;
	}

	// Need totalCount to determine strategy
	const totalCount = await getDiscussionTotalCount(categoryId, userToken);
	const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
	const effectivePage = Math.min(page, totalPages);

	// Can fetch from end directly? (within 100 items)
	const itemsFromEnd = totalCount - (effectivePage - 1) * perPage;
	if (itemsFromEnd <= CURSOR_BATCH_SIZE) {
		return fetchPageUsingLast(categoryId, effectivePage, perPage, totalCount, orderBy, userToken);
	}

	// Build cursor chain from whichever end is closer
	const distFromStart = effectivePage - 1;
	const distFromEnd = totalPages - effectivePage;

	if (distFromEnd < distFromStart) {
		await buildCursorsFromEnd(storeKey, effectivePage, perPage, totalCount, orderBy, categoryId, userToken);
	} else {
		await buildCursorsFromStart(storeKey, effectivePage, perPage, orderBy, categoryId, userToken);
	}

	// Use the built cursor
	const cursor = getCachedCursor(storeKey, effectivePage - 1);
	if (cursor) {
		const data = await fetchData(cursor);
		cacheCursor(storeKey, effectivePage, data?.pageInfo?.endCursor);
		return data;
	}

	// Last resort: fetch from end if possible
	if (itemsFromEnd > 0) {
		return fetchPageUsingLast(categoryId, effectivePage, perPage, totalCount, orderBy, userToken);
	}

	// Absolute fallback
	return fetchData();
}

/**
 * Fetch a specific page of threads for a category.
 * Uses bidirectional pagination: `last` for pages near the end (O(1)),
 * cursor building from the closer end for other pages.
 */
export async function fetchThreadsByPage(
	categoryId: string,
	page: number,
	perPage: number = 20,
	orderBy: string = 'UPDATED_AT',
	userToken?: string | null
) {
	return fetchDiscussionPage(`${categoryId}:${orderBy}`, categoryId, page, perPage, orderBy, userToken);
}

/**
 * Fetch a specific page of all discussions (homepage, no category filter).
 */
export async function fetchAllDiscussionsByPage(
	page: number,
	perPage: number = 20,
	orderBy: string = 'UPDATED_AT',
	userToken?: string | null
) {
	return fetchDiscussionPage(`all:${orderBy}`, null, page, perPage, orderBy, userToken);
}

export async function fetchThread(number: number, commentPage: number = 1, userToken?: string | null): Promise<any> {
	const cacheKey = `thread:${number}:cp:${commentPage}`;
	const cached = getCached<any>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	// For page 1 we fetch full thread metadata + first page of comments.
	if (commentPage === 1) {
		const result: any = await executeGraphQLRead(token, (gql) =>
			gql(
				`query($owner: String!, $repo: String!, $number: Int!) {
					repository(owner: $owner, name: $repo) {
						discussion(number: $number) {
							id number title body bodyHTML createdAt isAnswered url
							author { login avatarUrl url }
							category { name slug }
							labels(first: 10) { nodes { name color } }
							reactionGroups {
								content
								reactors(first: 100) {
									totalCount
									nodes { ... on User { login } }
								}
							}
							comments(first: ${COMMENTS_PER_PAGE}) {
								totalCount
								pageInfo { hasNextPage endCursor }
								nodes {
									id body bodyHTML createdAt isMinimized url
									author { login avatarUrl url }
									reactionGroups {
										content
										reactors(first: 100) {
											totalCount
											nodes { ... on User { login } }
										}
									}
									replies(first: 20) {
										nodes {
											id body bodyHTML createdAt url
											author { login avatarUrl url }
										}
									}
								}
							}
						}
					}
				}`,
				{ owner, repo, number }
			)
		);
		const thread = result.repository.discussion;
		thread.comments.nodes = thread.comments.nodes.filter((c: any) => !c.isMinimized);
		const totalCommentPages = Math.max(1, Math.ceil(thread.comments.totalCount / COMMENTS_PER_PAGE));

		// Cache cursor for page 2
		if (thread.comments.pageInfo.endCursor) {
			const existing = commentCursorCache.get(number) || [];
			if (existing.length === 0) {
				commentCursorCache.set(number, [thread.comments.pageInfo.endCursor]);
			}
		}

		const data = { ...thread, commentPage: 1, totalCommentPages };
		setCache(cacheKey, data, 60);
		return data;
	}

	// Page > 1: ensure page-1 data is loaded so we have cursor chain started.
	let cursors = commentCursorCache.get(number) || [];
	if (cursors.length === 0) {
		await fetchThread(number, 1, userToken);
		cursors = commentCursorCache.get(number) || [];
	}

	// Build cursor chain up to commentPage - 1.
	if (cursors.length < commentPage - 1) {
		for (let p = cursors.length + 1; p < commentPage; p++) {
			const prevCursor = cursors[p - 2];
			if (!prevCursor) break;
			const intermediate: any = await executeGraphQLRead(token, (gql) =>
				gql(
					`query($owner: String!, $repo: String!, $number: Int!, $after: String!) {
						repository(owner: $owner, name: $repo) {
							discussion(number: $number) {
								comments(first: ${COMMENTS_PER_PAGE}, after: $after) {
									pageInfo { endCursor }
								}
							}
						}
					}`,
					{ owner, repo, number, after: prevCursor }
				)
			);
			const endCursor = intermediate.repository.discussion.comments.pageInfo.endCursor;
			if (endCursor) {
				cursors = [...cursors, endCursor];
				commentCursorCache.set(number, cursors);
			} else {
				break;
			}
		}
	}

	const cursor = cursors[commentPage - 2];
	if (!cursor) {
		// Requested page out of range; fall back to page 1.
		return fetchThread(number, 1, userToken);
	}

	// Fetch thread metadata from page 1 cache + comments for requested page.
	const page1 = await fetchThread(number, 1, userToken);

	const commentsResult: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $number: Int!, $after: String!) {
				repository(owner: $owner, name: $repo) {
					discussion(number: $number) {
						comments(first: ${COMMENTS_PER_PAGE}, after: $after) {
							totalCount
							pageInfo { hasNextPage endCursor }
							nodes {
								id body bodyHTML createdAt isMinimized url
								author { login avatarUrl url }
								reactionGroups {
									content
									reactors(first: 100) {
										totalCount
										nodes { ... on User { login } }
									}
								}
								replies(first: 20) {
									nodes {
										id body bodyHTML createdAt url
										author { login avatarUrl url }
									}
								}
							}
						}
					}
				}
			}`,
			{ owner, repo, number, after: cursor }
		)
	);
	const moreComments = commentsResult.repository.discussion.comments;
	moreComments.nodes = moreComments.nodes.filter((c: any) => !c.isMinimized);
	const totalCommentPages = Math.max(1, Math.ceil(moreComments.totalCount / COMMENTS_PER_PAGE));

	// Cache cursor for next page.
	if (moreComments.pageInfo.endCursor && cursors.length < commentPage) {
		commentCursorCache.set(number, [...cursors, moreComments.pageInfo.endCursor]);
	}

	const data = { ...page1, comments: moreComments, commentPage, totalCommentPages };
	setCache(cacheKey, data, 60);
	return data;
}

/** Strip HTML tags from emojiHTML and set it as the category emoji. */
function parseCategoryEmoji(cat: any): any {
	if (cat?.emojiHTML) cat.emoji = cat.emojiHTML.replace(/<[^>]*>/g, '').trim();
	return cat;
}

export async function fetchPinnedDiscussions(userToken?: string | null) {
	const cacheKey = 'pinnedDiscussions';
	const cached = getCached<any[]>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!) {
				repository(owner: $owner, name: $repo) {
					pinnedDiscussions(first: 8) {
						nodes {
							discussion {
								id number title bodyText createdAt isAnswered
								author { login avatarUrl url }
								category { id name slug emoji emojiHTML }
								labels(first: 10) { nodes { name color } }
								comments { totalCount }
								reactions { totalCount }
							}
						}
					}
				}
			}`,
			{ owner, repo }
		)
	);
	const pinned = result.repository.pinnedDiscussions.nodes.map((n: any) => {
		const d = n.discussion;
		parseCategoryEmoji(d.category);
		return d;
	});

	setCache(cacheKey, pinned, 60);
	return pinned;
}

export async function fetchLatestDiscussions(first: number = 30, orderBy: string = 'UPDATED_AT', userToken?: string | null) {
	const cacheKey = `latest:${first}:${orderBy}`;
	const cached = getCached<any[]>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!, $first: Int!, $orderBy: DiscussionOrderField!) {
				repository(owner: $owner, name: $repo) {
					discussions(first: $first, orderBy: { field: $orderBy, direction: DESC }) {
						nodes {
							id number title createdAt isAnswered
							author { login avatarUrl url }
							category { id name slug emoji emojiHTML }
							labels(first: 10) { nodes { name color } }
							comments { totalCount }
							reactions { totalCount }
						}
					}
				}
			}`,
			{ owner, repo, first, orderBy }
		)
	);
	const discussions = result.repository.discussions.nodes
			.map((d: any) => {
			parseCategoryEmoji(d.category);
			return d;
		});

	setCache(cacheKey, discussions, 60);
	return discussions;
}

/**
 * Fetch top or trending discussions globally (or filtered by category slug).
 * Uses GraphQL search with sort:reactions — the GitHub App installation token
 * has access to this via GraphQL, whereas the REST /search/discussions endpoint
 * requires a separate 'discussions' permission that App installs may not have.
 * sort: 'top' = all-time most reactions, 'trending' = most reactions in past 30 days.
 */
export async function fetchTopDiscussions(
	sort: 'top' | 'trending',
	categorySlug?: string | null,
	first: number = 30,
	userToken?: string | null
) {
	const cacheKey = `top:${sort}:${categorySlug || ''}:${first}`;
	const cached = getCached<any[]>(cacheKey);
	if (cached) return cached;

	const token = await getReadToken(userToken);
	if (!token) throw new Error('No API token available. Please configure a GitHub App.');

	const owner = getRepoOwner();
	const repo = getRepoName();

	// Note: do NOT include 'type:discussion' in the query — that qualifier is
	// redundant with the GraphQL 'type: DISCUSSION' parameter and causes empty results.
	let searchQuery = `repo:${owner}/${repo} sort:reactions`;
	if (categorySlug) searchQuery += ` category:${categorySlug}`;
	if (sort === 'trending') {
		const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
		const monthAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString().slice(0, 10);
		searchQuery += ` created:>=${monthAgo}`;
	}

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($searchQuery: String!, $first: Int!) {
				search(query: $searchQuery, type: DISCUSSION, first: $first) {
					nodes {
						... on Discussion {
							id number title createdAt isAnswered
							author { login avatarUrl url }
							category { id name slug emoji emojiHTML }
							labels(first: 10) { nodes { name color } }
							comments { totalCount }
							reactions { totalCount }
						}
					}
				}
			}`,
			{ searchQuery, first }
		)
	);

	const discussions = (result.search.nodes as any[])
		.filter((n: any) => n?.number)
		.map((d: any) => { parseCategoryEmoji(d.category); return d; });

	setCache(cacheKey, discussions, 60);
	return discussions;
}

export async function fetchRepoId(userToken?: string | null) {
	const cacheKey = 'repoId';
	const cached = getCached<string>(cacheKey);
	if (cached) return cached;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const token = await getReadToken(userToken);

	if (!token) return null;

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($owner: String!, $repo: String!) {
				repository(owner: $owner, name: $repo) { id }
			}`,
			{ owner, repo }
		)
	);

	const id = result.repository.id;
	setCache(cacheKey, id, 3600);
	return id;
}

export async function createDiscussion(
	token: string,
	repoId: string,
	categoryId: string,
	title: string,
	body: string
) {
	const gql = getUserClient(token);

	const result: any = await gql(
		`mutation($repoId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
			createDiscussion(input: {
				repositoryId: $repoId
				categoryId: $categoryId
				title: $title
				body: $body
			}) {
				discussion { number title }
			}
		}`,
		{ repoId, categoryId, title, body }
	);

	return result.createDiscussion.discussion;
}

export async function addComment(token: string, discussionId: string, body: string, replyToId?: string | null) {
	const gql = getUserClient(token);

	const replyParam = replyToId ? ', $replyToId: ID' : '';
	const replyInput = replyToId ? '\n\t\t\t\treplyToId: $replyToId' : '';
	const variables: Record<string, unknown> = { discussionId, body };
	if (replyToId) variables.replyToId = replyToId;

	const result: any = await gql(
		`mutation($discussionId: ID!, $body: String!${replyParam}) {
			addDiscussionComment(input: {
				discussionId: $discussionId
				body: $body${replyInput}
			}) {
				comment { id createdAt }
			}
		}`,
		variables
	);

	return result.addDiscussionComment.comment;
}

export async function toggleReaction(token: string, subjectId: string, content: string, add: boolean) {
	const gql = getUserClient(token);
	const mutation = add ? 'addReaction' : 'removeReaction';

	const result: any = await gql(
		`mutation($subjectId: ID!, $content: ReactionContent!) {
			${mutation}(input: { subjectId: $subjectId, content: $content }) {
				reaction { content }
			}
		}`,
		{ subjectId, content }
	);

	return result[mutation].reaction;
}

export async function searchDiscussions(query: string, first: number = 20, after?: string, userToken?: string | null) {
	const cacheKey = `search:${query}:${first}:${after || ''}`;
	const cached = getCached<any>(cacheKey);
	if (cached) return cached;

	const token = await getReadToken(userToken);
	if (!token) return null;

	const owner = getRepoOwner();
	const repo = getRepoName();
	const searchQuery = `${query} repo:${owner}/${repo} type:discussion`;

	const result: any = await executeGraphQLRead(token, (gql) =>
		gql(
			`query($searchQuery: String!, $first: Int!, $after: String) {
				search(query: $searchQuery, type: DISCUSSION, first: $first, after: $after) {
					discussionCount
					pageInfo { hasNextPage endCursor }
					nodes {
						... on Discussion {
							id number title createdAt
							author { login avatarUrl url }
							comments { totalCount }
							reactions { totalCount }
							category { name slug }
						}
					}
				}
			}`,
			{ searchQuery, first, after: after || null }
		)
	);

	const search = result.search;
	setCache(cacheKey, search, 60);
	return search;
}
