<script lang="ts">
import { formatDate, truncateText } from '$lib/utils';

let { data } = $props();

const SORTS = [
	{ key: 'latest', label: 'Latest' },
	{ key: 'newest', label: 'Newest' },
	{ key: 'top',    label: 'Top' },
	{ key: 'trending', label: 'Trending' },
] as const;

const PAGES_AROUND_CURRENT = 2;
const MAX_PAGES_WITHOUT_ELLIPSIS = 7;

function pageUrl(p: number) {
	return `/?page=${p}&sort=${data.sort}`;
}

function pageNumbers(current: number, total: number): (number | null)[] {
	if (total <= MAX_PAGES_WITHOUT_ELLIPSIS) return Array.from({ length: total }, (_, i) => i + 1);
	const pages: (number | null)[] = [];
	const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
	add(1);
	if (current - PAGES_AROUND_CURRENT > 2) pages.push(null);
	for (let p = Math.max(2, current - PAGES_AROUND_CURRENT); p <= Math.min(total - 1, current + PAGES_AROUND_CURRENT); p++) add(p);
	if (current + PAGES_AROUND_CURRENT < total - 1) pages.push(null);
	add(total);
	return pages;
}
</script>

<svelte:head>
<title>{data.forumTitle} — Forum</title>
</svelte:head>

{#if data.rateLimited}
<div class="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-900/20">
<p class="mb-3 text-amber-800 dark:text-amber-300">⚠️ GitHub API rate limit reached.</p>
{#if !data.user}
<p class="mb-3 text-sm text-amber-700 dark:text-amber-400">
<a href="/auth/login" class="font-medium underline">Sign in with GitHub</a> to continue browsing with a higher rate limit.
</p>
{/if}
<p class="text-sm text-amber-600 dark:text-amber-400">If this persists, please contact the repository administrator.</p>
</div>
{:else}
<div class="flex gap-8">
<!-- Left sidebar: categories -->
<aside class="hidden w-56 shrink-0 lg:block">
<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Categories</h2>
{#if data.categories && data.categories.length > 0}
<nav class="space-y-1">
{#each data.categories as category}
<a
href="/c/{category.slug}"
class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
>
<span class="text-base">{category.emoji || '💬'}</span>
<span class="truncate font-medium">{category.name}</span>
</a>
{/each}
</nav>
{:else}
<p class="text-sm text-gray-500 dark:text-gray-400">No categories found.</p>
{/if}
</aside>

<!-- Main content -->
<div class="min-w-0 flex-1 space-y-6">
<!-- Globally pinned discussions -->
{#if data.pinned && data.pinned.length > 0}
<section>
<h2 class="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
📌 Pinned
</h2>
<div class="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
{#each data.pinned as thread}
<a href="/t/{thread.number}" class="flex items-start gap-4 px-4 py-3 transition hover:bg-amber-50/50 dark:hover:bg-gray-800/50">
{#if thread.author}
<img src={thread.author.avatarUrl} alt={thread.author.login} class="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
{:else}
<div class="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-gray-300 dark:bg-gray-700"></div>
{/if}
<div class="min-w-0 flex-1">
<div class="flex flex-wrap items-center gap-2">
<span class="font-medium text-gray-900 dark:text-gray-100">{thread.title}</span>
{#if thread.labels?.nodes?.length > 0}
{#each thread.labels.nodes as label}
<span class="rounded-full border px-1.5 py-0 text-xs font-medium"
style="background-color:#{label.color}22;color:#{label.color};border-color:#{label.color}55;"
>{label.name}</span>
{/each}
{/if}
</div>
{#if thread.bodyText}
<p class="mt-0.5 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{truncateText(thread.bodyText)}</p>
{/if}
<p class="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
{thread.category?.emoji || '💬'} {thread.category?.name} · {thread.author?.login || 'ghost'}{#if thread.isAnswered} · <span class="font-medium text-green-600 dark:text-green-400">Answered</span>{/if} · {formatDate(thread.createdAt)}
</p>
</div>
<div class="flex shrink-0 items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
{#if thread.reactions?.totalCount > 0}
<span>✨ {thread.reactions.totalCount}</span>
{/if}
<span>💬 {thread.comments?.totalCount ?? 0}</span>
</div>
</a>
{/each}
</div>
</section>
{/if}

<!-- Latest threads -->
<section>
<div class="mb-3 flex items-center justify-between">
<h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
{SORTS.find(s => s.key === data.sort)?.label ?? 'Latest'}
</h2>
<div class="flex gap-1">
{#each SORTS as s}
<a href="/?sort={s.key}"
class="rounded px-3 py-1 text-sm {data.sort === s.key || (!data.sort && s.key === 'latest') ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}"
>{s.label}</a>
{/each}
</div>
</div>
{#if data.threads && data.threads.length > 0}
<div class="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
{#each data.threads as thread}
<a href="/t/{thread.number}" class="flex items-center gap-4 px-4 py-3 transition hover:bg-amber-50/50 dark:hover:bg-gray-800/50">
{#if thread.author}
<img src={thread.author.avatarUrl} alt={thread.author.login} class="h-8 w-8 shrink-0 rounded-full" />
{:else}
<div class="h-8 w-8 shrink-0 rounded-full bg-gray-300 dark:bg-gray-700"></div>
{/if}
<div class="min-w-0 flex-1">
<div class="flex flex-wrap items-center gap-2">
<span class="truncate font-medium text-gray-900 dark:text-gray-100">{thread.title}</span>
{#if thread.labels?.nodes?.length > 0}
{#each thread.labels.nodes as label}
<span class="rounded-full border px-1.5 py-0 text-xs font-medium"
style="background-color:#{label.color}22;color:#{label.color};border-color:#{label.color}55;"
>{label.name}</span>
{/each}
{/if}
</div>
<p class="truncate text-sm text-gray-500 dark:text-gray-400">
{thread.category?.emoji || '💬'} {thread.category?.name} · {thread.author?.login || 'ghost'}{#if thread.isAnswered} · <span class="font-medium text-green-600 dark:text-green-400">Answered</span>{/if} · {formatDate(thread.createdAt)}
</p>
</div>
<div class="flex shrink-0 items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
{#if thread.reactions?.totalCount > 0}
<span>✨ {thread.reactions.totalCount}</span>
{/if}
<span>💬 {thread.comments?.totalCount ?? 0}</span>
</div>
</a>
{/each}
</div>
{:else}
<div class="rounded-lg border border-amber-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
<p class="text-gray-500 dark:text-gray-400">No discussions yet.</p>
</div>
{/if}

{#if data.totalPages > 1}
<nav class="flex items-center justify-center gap-1 text-sm" aria-label="Pagination" data-sveltekit-preload-data="off">
{#if data.page > 1}
<a href={pageUrl(data.page - 1)} class="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">‹</a>
{/if}
{#each pageNumbers(data.page, data.totalPages) as p}
{#if p === null}
<span class="px-1 text-gray-400">…</span>
{:else}
<a href={pageUrl(p)}
class="rounded border px-3 py-1.5 {p === data.page ? 'border-orange-500 bg-orange-50 font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'}"
aria-current={p === data.page ? 'page' : undefined}
>{p}</a>
{/if}
{/each}
{#if data.page < data.totalPages}
<a href={pageUrl(data.page + 1)} class="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">›</a>
{/if}
</nav>
{/if}
</section>

<!-- Mobile category grid (visible only below lg) -->
<section class="lg:hidden">
<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Categories</h2>
{#if data.categories && data.categories.length > 0}
<div class="grid gap-3 sm:grid-cols-2">
{#each data.categories as category}
<a href="/c/{category.slug}"
class="block rounded-lg border border-amber-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
<div class="mb-1 text-xl">{category.emoji || '💬'}</div>
<h3 class="font-semibold text-gray-900 dark:text-gray-100">{category.name}</h3>
{#if category.description}
<p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{category.description}</p>
{/if}
</a>
{/each}
</div>
{/if}
</section>
</div>
</div>
{/if}
