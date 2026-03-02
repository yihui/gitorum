import { fetchCategories, fetchLatestDiscussions, fetchPinnedDiscussions, fetchTopDiscussions, RateLimitError } from '$lib/server/github';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	if (locals.user) {
		setHeaders({ 'Cache-Control': 'private, no-store' });
	} else {
		setHeaders({ 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120' });
	}
	const sort = url.searchParams.get('sort') || 'latest';
	try {
		const [categories, pinned] = await Promise.all([
			fetchCategories(locals.userToken),
			fetchPinnedDiscussions(locals.userToken)
		]);

		let threads: any[];
		if (sort === 'top') {
			threads = await fetchTopDiscussions('top', null, 30, locals.userToken);
		} else if (sort === 'trending') {
			threads = await fetchTopDiscussions('trending', null, 30, locals.userToken);
		} else if (sort === 'newest') {
			threads = await fetchLatestDiscussions(30, 'CREATED_AT', locals.userToken);
		} else {
			threads = await fetchLatestDiscussions(30, 'UPDATED_AT', locals.userToken);
		}

		return { categories, threads, pinned, sort, rateLimited: false };
	} catch (err) {
		if (err instanceof RateLimitError) {
			return { categories: null, threads: [], pinned: [], sort, rateLimited: true };
		}
		error(503, err instanceof Error ? err.message : 'Failed to load categories');
	}
};
