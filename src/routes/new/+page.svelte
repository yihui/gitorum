<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	let { data, form } = $props();
	let body = $derived(form?.body || '');
	let showPreview = $state(false);
	let currentBody = $state('');

	$effect(() => {
		if (body) currentBody = body;
	});
</script>

<svelte:head>
	<title>New Thread — {data.forumTitle}</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<h1 class="text-2xl font-bold">Create New Thread</h1>

	{#if form?.error}
		<div class="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
			{form.error}
		</div>
	{/if}

	<form method="POST" class="space-y-4">
		<div>
			<label for="title" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Title</label>
			<input
				type="text"
				name="title"
				id="title"
				value={form?.title || ''}
				required
				class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
				placeholder="Thread title"
			/>
		</div>

		<div>
			<label for="categoryId" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
			<select
				name="categoryId"
				id="categoryId"
				required
				class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
			>
				<option value="">Select a category</option>
				{#each data.categories as category}
					<option value={category.id} selected={form?.categoryId === category.id || (!form?.categoryId && data.categoryId === category.id)}>
						{category.emoji || '💬'} {category.name}
					</option>
				{/each}
			</select>
		</div>

		<div>
			<label for="body" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Body</label>

			<div class="mb-2 flex gap-2 border-b border-gray-200 dark:border-gray-700">
				<button
					type="button"
					onclick={() => showPreview = false}
					class="px-3 py-1.5 text-sm {!showPreview ? 'border-b-2 border-orange-500 font-medium text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
				>
					Write
				</button>
				<button
					type="button"
					onclick={() => showPreview = true}
					class="px-3 py-1.5 text-sm {showPreview ? 'border-b-2 border-orange-500 font-medium text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
				>
					Preview
				</button>
			</div>

			{#if showPreview}
				<div class="prose dark:prose-invert min-h-[200px] rounded border border-gray-200 p-3 dark:border-gray-700">
					{#if currentBody.trim()}
						{@html renderMarkdown(currentBody)}
					{:else}
						<p class="text-gray-400">Nothing to preview</p>
					{/if}
				</div>
			{:else}
				<textarea
					name="body"
					id="body"
					bind:value={currentBody}
					required
					rows="10"
					class="w-full rounded-md border border-gray-300 p-3 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					placeholder="Write your post... (Markdown supported)"
				></textarea>
			{/if}
		</div>

		<div class="flex justify-end">
			<button
				type="submit"
				class="rounded-md bg-orange-600 px-5 py-2 text-sm font-medium text-white hover:bg-orange-700"
			>
				Create Thread
			</button>
		</div>
	</form>
</div>
