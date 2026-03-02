<script lang="ts">
	import './layout.css';

	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" />
	<title>{data.forumTitle}</title>
</svelte:head>

<div class="min-h-screen bg-[#fffdf5] text-gray-900 dark:bg-[#1c1710] dark:text-gray-100">
	<!-- Header -->
	<header class="border-b border-amber-200 bg-white shadow-sm dark:border-amber-900/40 dark:bg-[#241f14]">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
			<a href="/" class="flex items-center gap-2 text-xl font-bold text-orange-600 dark:text-orange-400">
				{#if data.forumLogoUrl}
					<img src={data.forumLogoUrl} alt={data.forumTitle} class="h-7 w-7 shrink-0" />
				{:else}
					<svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="shrink-0">
						<rect width="64" height="64" rx="14" fill="currentColor" />
						<path d="M18 16C18 14.9 18.9 14 20 14H32L38 20V32H26L20 26V16Z" fill="white" opacity="0.9"/>
						<path d="M26 28C26 26.9 26.9 26 28 26H40L46 32V44H34L28 38V28Z" fill="white" opacity="0.7"/>
						<path d="M20 40C20 38.9 20.9 38 22 38H34L40 44V50C40 51.1 39.1 52 38 52H22C20.9 52 20 51.1 20 50V40Z" fill="white" opacity="0.5"/>
					</svg>
				{/if}
				{data.forumTitle}
			</a>

			<div class="flex items-center gap-4">
				<a href="/search" class="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
					Search
				</a>

				{#if data.user}
					<a href="/new" class="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700">
						New Thread
					</a>
					<div class="flex items-center gap-2">
						<img src={data.user.avatarUrl} alt={data.user.login} class="h-7 w-7 rounded-full" />
						<span class="text-sm font-medium">{data.user.login}</span>
					</div>
					<a href="/auth/logout" class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
						Log out
					</a>
				{:else}
					<a href="/auth/login" class="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600">
						Sign in with GitHub
					</a>
				{/if}
			</div>
		</div>
	</header>

	<!-- Main content -->
	<main class="mx-auto max-w-6xl px-4 py-6">
		{#if data.authError}
			<div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
				⚠️ {data.authError}
			</div>
		{/if}
		{@render children()}
	</main>

	<!-- Footer -->
	<footer class="border-t border-amber-200 py-6 text-center text-sm text-gray-500 dark:border-amber-900/40 dark:text-gray-500">
		{#if data.forumFooterHtml}
			{@html data.forumFooterHtml}
		{:else}
			Powered by <a href="https://github.com" class="underline hover:text-gray-700 dark:hover:text-gray-300">GitHub Discussions</a>
		{/if}
	</footer>
</div>
