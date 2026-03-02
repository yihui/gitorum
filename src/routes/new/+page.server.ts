import { fetchCategories, fetchRepoId, createDiscussion, getRepoOwner } from '$lib/server/github';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Category } from '$lib/types';

/** Returns true if the category is announcement-only (not for general posting). */
function isAnnouncementCategory(category: Category): boolean {
	const name = (category.name || '').toLowerCase();
	const slug = (category.slug || '').toLowerCase();
	return name.includes('announcement') || slug.includes('announcement');
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, '/auth/login?redirect=/new');
	}

	const categoryId = url.searchParams.get('categoryId') || '';

	try {
		const allCategories = await fetchCategories(locals.userToken);
		const repoOwner = getRepoOwner();
		const isOwner = locals.user.login === repoOwner;

		// Hide announcement categories from non-repo-owners.
		const categories = isOwner
			? allCategories || []
			: (allCategories || []).filter((c: Category) => !isAnnouncementCategory(c));

		return { categories, categoryId };
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
