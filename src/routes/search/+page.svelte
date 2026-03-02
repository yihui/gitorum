<script lang="ts">
	import { formatDate } from '$lib/utils';

	let { data } = $props();
</script>

<svelte:head>
	<title>Search — {data.forumTitle}</title>
</svelte:head>

<div class="space-y-4">
	<h1 class="text-2xl font-bold">Search</h1>

	<form method="GET" action="/search" class="flex gap-2">
		<input
			type="text"
			name="q"
			value={data.query}
			placeholder="Search discussions..."
			class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		/>
		<button
			type="submit"
			class="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
		>
			Search
		</button>
	</form>

	{#if data.query}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			{data.totalCount} {data.totalCount === 1 ? 'result' : 'results'} for "{data.query}"
		</p>
	{/if}

	{#if data.results.length > 0}
		<div class="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
			{#each data.results as thread}
				{#if thread.number}
					<a
						href="/t/{thread.number}"
						class="flex items-center gap-4 px-4 py-3 transition hover:bg-amber-100/50 dark:hover:bg-gray-800/50"
					>
						{#if thread.author}
							<img src={thread.author.avatarUrl} alt={thread.author.login} class="h-9 w-9 rounded-full" />
						{:else}
							<div class="h-9 w-9 rounded-full bg-gray-300 dark:bg-gray-700"></div>
						{/if}

						<div class="min-w-0 flex-1">
							<h3 class="truncate font-medium text-gray-900 dark:text-gray-100">{thread.title}</h3>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								{thread.author?.login || 'ghost'}
								{#if thread.category}
									 in {thread.category.name}
								{/if}
								 · {formatDate(thread.createdAt)}
							</p>
						</div>

						<div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
							{#if thread.reactions?.totalCount > 0}
								<span>✨ {thread.reactions.totalCount}</span>
							{/if}
							{#if thread.comments}
								<span>💬 {thread.comments.totalCount}</span>
							{/if}
						</div>
					</a>
				{/if}
			{/each}
		</div>

		{#if data.pageInfo?.hasNextPage}
			<div class="text-center">
				<a
					href="/search?q={encodeURIComponent(data.query)}&after={data.pageInfo.endCursor}"
					class="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
				>
					Load more →
				</a>
			</div>
		{/if}
	{:else if data.query}
		<div class="rounded-lg border border-amber-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
			<p class="text-gray-500 dark:text-gray-400">No results found.</p>
		</div>
	{/if}
</div>
