<script lang="ts">
import { formatDate, reactionEmoji, REACTION_CONTENTS } from '$lib/utils';
import { renderMarkdown } from '$lib/markdown';

let { data } = $props();
let replyBody = $state('');
let replying = $state(false);
let replyError = $state('');
let showPreview = $state(false);

const ALL_REACTIONS = REACTION_CONTENTS;

/** Per-subject optimistic reaction state (keyed by GitHub node id). */
let reactionState: Record<string, any[]> = $state({});
/** Set of subject ids whose emoji picker is open. */
let openPickers: Set<string> = $state(new Set());
/** Reaction error message, cleared after a short delay. */
let reactionError = $state('');

function getGroups(subjectId: string, fallback: any[]): any[] {
return reactionState[subjectId] ?? fallback;
}

/** Return only reaction groups that have at least one reactor. */
function activeGroups(groups: any[]) {
return (groups || []).filter((g: any) => g.reactors?.totalCount > 0);
}

function userHasReacted(subjectId: string, content: string, fallback: any[]): boolean {
if (!data.user) return false;
const group = getGroups(subjectId, fallback).find((g: any) => g.content === content);
return group?.reactors?.nodes?.some((u: any) => u?.login === data.user?.login) ?? false;
}

function togglePicker(subjectId: string) {
const next = new Set(openPickers);
if (next.has(subjectId)) next.delete(subjectId);
else next.add(subjectId);
openPickers = next;
}

async function handleReaction(subjectId: string, content: string, originalGroups: any[]) {
if (!data.user) return;
const currentGroups = getGroups(subjectId, originalGroups);
const hasReacted = userHasReacted(subjectId, content, originalGroups);

// Optimistic update
let groups = currentGroups.map((g: any) => ({
...g, reactors: { ...g.reactors, nodes: [...(g.reactors?.nodes ?? [])] }
}));
const idx = groups.findIndex((g: any) => g.content === content);
if (hasReacted) {
if (idx >= 0) {
groups[idx].reactors.totalCount = Math.max(0, groups[idx].reactors.totalCount - 1);
groups[idx].reactors.nodes = groups[idx].reactors.nodes.filter((u: any) => u?.login !== data.user?.login);
}
} else {
if (idx >= 0) {
groups[idx].reactors.totalCount += 1;
groups[idx].reactors.nodes.push({ login: data.user.login });
} else {
groups = [...groups, { content, reactors: { totalCount: 1, nodes: [{ login: data.user.login }] } }];
}
}
reactionState[subjectId] = groups;

// Close picker if open
if (openPickers.has(subjectId)) togglePicker(subjectId);

try {
const res = await fetch('/api/reaction', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ subjectId, content, add: !hasReacted })
});
if (!res.ok) {
reactionState[subjectId] = currentGroups;
reactionError = 'Failed to save reaction';
setTimeout(() => { reactionError = ''; }, 3000);
}
} catch {
reactionState[subjectId] = currentGroups;
reactionError = 'Failed to save reaction';
setTimeout(() => { reactionError = ''; }, 3000);
}
}

function commentPageUrl(cp: number) {
return `/t/${data.thread.number}?cp=${cp}`;
}

async function submitReply() {
if (!replyBody.trim()) return;
replying = true;
replyError = '';
try {
const res = await fetch('/api/reply', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ discussionId: data.thread.id, body: replyBody.trim() })
});
if (!res.ok) {
const err = await res.json();
replyError = err.message || 'Failed to post reply';
return;
}
window.location.reload();
} catch {
replyError = 'Failed to post reply';
} finally {
replying = false;
}
}
</script>

{#snippet reactionBar(subjectId: string, originalGroups: any[], padClass: string)}
{@const groups = getGroups(subjectId, originalGroups)}
{@const active = activeGroups(groups)}
{@const hasUsers = active.some((g: any) => (g.reactors?.nodes?.filter((u: any) => u?.login) ?? []).length > 0)}
{@const pickerOpen = openPickers.has(subjectId)}
{#if active.length > 0 || data.user}
<div class="group/rx border-t border-amber-100 {padClass} dark:border-gray-800">
{#if hasUsers}<input type="checkbox" id="rx-{subjectId}" class="peer/rx sr-only">{/if}
<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
{#each active as group}
{@const reacted = userHasReacted(subjectId, group.content, originalGroups)}
{#if data.user}
<button type="button" onclick={() => handleReaction(subjectId, group.content, originalGroups)}
class="rounded-full px-2.5 py-0.5 text-sm transition-colors {reacted ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'}"
title={reacted ? 'Remove reaction' : 'Add reaction'}
>{reactionEmoji(group.content)} <span class="font-medium">{group.reactors.totalCount}</span></button>
{:else}
<span class="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm dark:bg-gray-800">{reactionEmoji(group.content)} <span class="font-medium">{group.reactors.totalCount}</span></span>
{/if}
{/each}
{#if data.user}
<div class="relative">
<button type="button" onclick={() => togglePicker(subjectId)}
class="rounded-full bg-gray-100 px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
title="Add reaction">+</button>
{#if pickerOpen}
<div class="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
{#each ALL_REACTIONS as rc}
{@const picked = userHasReacted(subjectId, rc, originalGroups)}
<button type="button" onclick={() => handleReaction(subjectId, rc, originalGroups)}
class="rounded p-1 text-lg leading-none hover:bg-gray-100 dark:hover:bg-gray-800 {picked ? 'bg-orange-100 dark:bg-orange-900/40' : ''}"
title={rc}>{reactionEmoji(rc)}</button>
{/each}
</div>
{/if}
</div>
{/if}
{#if hasUsers}<label for="rx-{subjectId}" aria-label="Toggle reactor list" class="inline-block cursor-pointer text-xs text-gray-400 transition-transform hover:text-gray-600 group-has-[input:checked]/rx:rotate-90">▶</label>{/if}
</div>
{#if hasUsers}
<div class="mt-1.5 hidden space-y-1 peer-checked/rx:block">
{#each active as group}
{@const users = group.reactors?.nodes?.filter((u: any) => u?.login) ?? []}
{@const extra = (group.reactors?.totalCount ?? 0) - users.length}
{#if users.length > 0}
<p class="text-xs text-gray-500 dark:text-gray-400">{reactionEmoji(group.content)}: {#each users as u, i}{#if i > 0}{', '}{/if}<a href="https://github.com/{u.login}" target="_blank" rel="noopener" class="hover:underline">{u.login}</a>{/each}{#if extra > 0}{', and '}{extra}{' more'}{/if}</p>
{/if}
{/each}
</div>
{/if}
</div>
{/if}
{/snippet}

<svelte:head>
<title>{data.thread?.title || 'Thread'} — {data.forumTitle}</title>
</svelte:head>

<div class="space-y-6">
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
{:else if data.thread}
<!-- Breadcrumb -->
<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
<a href="/" class="hover:text-gray-700 dark:hover:text-gray-200">Home</a>
<span>›</span>
<a href="/c/{data.thread.category.slug}" class="hover:text-gray-700 dark:hover:text-gray-200">{data.thread.category.name}</a>
<span>›</span>
<span class="text-gray-700 dark:text-gray-200">Thread</span>
</div>

<!-- Original post -->
<article class="rounded-lg border border-amber-200 bg-white dark:border-gray-800 dark:bg-gray-900">
<div class="border-b border-amber-100 px-6 py-4 dark:border-gray-800">
<div class="flex flex-wrap items-start gap-2">
<h1 class="flex-1 text-xl font-bold text-gray-900 dark:text-gray-100">{data.thread.title}</h1>
{#if data.thread.isAnswered}
<span class="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">✓ Answered</span>
{/if}
</div>
{#if data.thread.labels?.nodes?.length > 0}
<div class="mt-2 flex flex-wrap gap-1.5">
{#each data.thread.labels.nodes as label}
<span class="rounded-full border px-2 py-0.5 text-xs font-medium"
style="background-color:#{label.color}22;color:#{label.color};border-color:#{label.color}55;"
>{label.name}</span>
{/each}
</div>
{/if}
<div class="mt-2 flex items-center gap-3">
{#if data.thread.author}
<img src={data.thread.author.avatarUrl} alt={data.thread.author.login} class="h-8 w-8 rounded-full" />
<a href={data.thread.author.url} target="_blank" class="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">
{data.thread.author.login}
</a>
{:else}
<div class="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-700"></div>
<span class="text-sm text-gray-500">ghost</span>
{/if}
<span class="text-xs text-gray-500 dark:text-gray-400">{formatDate(data.thread.createdAt)}</span>
</div>
</div>

<div class="prose dark:prose-invert max-w-none px-6 py-4">
{@html data.thread.bodyHTML}
</div>

{@render reactionBar(data.thread.id, data.thread.reactionGroups, 'px-6 py-3')}
</article>

<!-- Comments -->
{#if data.thread.comments.totalCount > 0}
<div class="flex items-center justify-between">
<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
{data.thread.comments.totalCount} {data.thread.comments.totalCount === 1 ? 'Reply' : 'Replies'}
</h2>
{#if data.thread.totalCommentPages > 1}
<span class="text-sm text-gray-500 dark:text-gray-400">Page {data.thread.commentPage} / {data.thread.totalCommentPages}</span>
{/if}
</div>

<div class="space-y-4">
{#each data.thread.comments.nodes as comment}
<article class="rounded-lg border border-amber-200 bg-white dark:border-gray-800 dark:bg-gray-900">
<div class="flex items-center gap-3 border-b border-amber-100 px-5 py-3 dark:border-gray-800">
{#if comment.author}
<img src={comment.author.avatarUrl} alt={comment.author.login} class="h-7 w-7 rounded-full" />
<a href={comment.author.url} target="_blank" class="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">
{comment.author.login}
</a>
{:else}
<div class="h-7 w-7 rounded-full bg-gray-300 dark:bg-gray-700"></div>
<span class="text-sm text-gray-500">ghost</span>
{/if}
<span class="text-xs text-gray-500 dark:text-gray-400">{formatDate(comment.createdAt)}</span>
</div>

<div class="prose dark:prose-invert max-w-none px-5 py-3">
{@html comment.bodyHTML}
</div>

{@render reactionBar(comment.id, comment.reactionGroups, 'px-5 py-2')}

{#if comment.replies.nodes.length > 0}
<div class="border-t border-amber-100 dark:border-gray-800">
{#each comment.replies.nodes as reply}
<div class="ml-6 border-l-2 border-amber-100 py-3 pl-4 dark:border-gray-700">
<div class="flex items-center gap-2">
{#if reply.author}
<img src={reply.author.avatarUrl} alt={reply.author.login} class="h-5 w-5 rounded-full" />
<span class="text-sm font-medium text-gray-700 dark:text-gray-300">{reply.author.login}</span>
{:else}
<span class="text-sm text-gray-500">ghost</span>
{/if}
<span class="text-xs text-gray-500 dark:text-gray-400">{formatDate(reply.createdAt)}</span>
</div>
<div class="prose dark:prose-invert mt-1 max-w-none text-sm">
{@html reply.bodyHTML}
</div>
</div>
{/each}
</div>
{/if}
</article>
{/each}
</div>

{#if data.thread.totalCommentPages > 1}
<nav class="flex items-center justify-center gap-2 text-sm" aria-label="Comment pages">
{#if data.thread.commentPage > 1}
<a href={commentPageUrl(data.thread.commentPage - 1)} class="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">‹ Prev</a>
{/if}
<span class="text-gray-500 dark:text-gray-400">Page {data.thread.commentPage} of {data.thread.totalCommentPages}</span>
{#if data.thread.commentPage < data.thread.totalCommentPages}
<a href={commentPageUrl(data.thread.commentPage + 1)} class="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Next ›</a>
{/if}
</nav>
{/if}
{/if}

<!-- Reply form -->
{#if reactionError}
<p class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">{reactionError}</p>
{/if}
<div class="rounded-lg border border-amber-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
{#if data.user}
<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Post a Reply</h3>
<div class="mb-2 flex gap-2 border-b border-amber-100 dark:border-gray-700">
<button type="button" onclick={() => showPreview = false}
class="px-3 py-1.5 text-sm {!showPreview ? 'border-b-2 border-orange-500 font-medium text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}">Write</button>
<button type="button" onclick={() => showPreview = true}
class="px-3 py-1.5 text-sm {showPreview ? 'border-b-2 border-orange-500 font-medium text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}">Preview</button>
</div>
{#if showPreview}
<div class="prose dark:prose-invert min-h-[120px] rounded border border-amber-100 p-3 dark:border-gray-700">
{#if replyBody.trim()}
{@html renderMarkdown(replyBody)}
{:else}
<p class="text-gray-400">Nothing to preview</p>
{/if}
</div>
{:else}
<textarea bind:value={replyBody} placeholder="Write your reply... (Markdown supported)"
class="w-full rounded border border-gray-300 p-3 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" rows="4"></textarea>
{/if}
{#if replyError}
<p class="mt-2 text-sm text-red-600">{replyError}</p>
{/if}
<div class="mt-3 flex justify-end">
<button onclick={submitReply} disabled={replying || !replyBody.trim()}
class="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
{replying ? 'Posting...' : 'Post Reply'}
</button>
</div>
{:else}
<div class="py-4 text-center">
<p class="mb-3 text-gray-500 dark:text-gray-400">Sign in to join the discussion</p>
<a href="/auth/login?redirect=/t/{data.thread.number}"
class="inline-block rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600">
Sign in with GitHub
</a>
</div>
{/if}
</div>
{/if}
</div>
