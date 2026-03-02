import { fetchCategories, fetchRepoId, createDiscussion } from '$lib/server/github';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, '/auth/login?redirect=/new');
	}

	const categoryId = url.searchParams.get('categoryId') || '';

	try {
		const categories = await fetchCategories(locals.userToken);
		return { categories: categories || [], categoryId };
	} catch (err) {
		console.error('Failed to load categories for new thread page:', err);
		error(503, 'Could not load discussion categories. Please check your GitHub App configuration.');
	}
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user || !locals.userToken) {
			error(401, 'Not authenticated');
		}

		const data = await request.formData();
		const title = data.get('title') as string;
		const categoryId = data.get('categoryId') as string;
		const body = data.get('body') as string;

		if (!title?.trim() || !categoryId || !body?.trim()) {
			return { error: 'All fields are required', title, categoryId, body };
		}

		const repoId = await fetchRepoId(locals.userToken);
		const discussion = await createDiscussion(
			locals.userToken,
			repoId,
			categoryId,
			title.trim(),
			body.trim()
		);

		redirect(303, `/t/${discussion.number}`);
	}
};
