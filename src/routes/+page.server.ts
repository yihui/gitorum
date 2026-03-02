import { fetchCategories, fetchAllDiscussionsByPage, fetchPinnedDiscussions, fetchTopDiscussions, RateLimitError } from '$lib/server/github';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

export const load: PageServerLoad = async ({ locals, url }) => {
	const sort = url.searchParams.get('sort') || 'latest';
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
	try {
		const [categories, pinned] = await Promise.all([
			fetchCategories(locals.userToken),
			fetchPinnedDiscussions(locals.userToken)
		]);

		if (sort === 'top' || sort === 'trending') {
			const threads = await fetchTopDiscussions(sort, null, 30, locals.userToken);
			return { categories, threads, pinned, sort, page: 1, totalPages: 1, totalCount: threads.length, rateLimited: false };
		}

		const orderBy = sort === 'newest' ? 'CREATED_AT' : 'UPDATED_AT';
		const discussions = await fetchAllDiscussionsByPage(page, PER_PAGE, orderBy, locals.userToken);

		const totalCount: number = discussions?.totalCount ?? 0;
		const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

		return { categories, threads: discussions?.nodes || [], pinned, sort, page, totalPages, totalCount, rateLimited: false };
	} catch (err) {
		if (err instanceof RateLimitError) {
			return { categories: null, threads: [], pinned: [], sort, page: 1, totalPages: 1, totalCount: 0, rateLimited: true };
		}
		error(503, err instanceof Error ? err.message : 'Failed to load categories');
	}
};
