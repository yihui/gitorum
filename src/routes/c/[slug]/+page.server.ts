import { fetchCategoryBySlug, fetchThreadsByPage, fetchPinnedDiscussions, fetchTopDiscussions, RateLimitError } from '$lib/server/github';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

export const load: PageServerLoad = async ({ params, url, locals, setHeaders }) => {
	try {
		const [category, allPinned] = await Promise.all([
			fetchCategoryBySlug(params.slug, locals.userToken),
			fetchPinnedDiscussions(locals.userToken).catch(() => [])
		]);
		if (!category) error(404, 'Category not found');

		const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
		const sort = url.searchParams.get('sort') || 'UPDATED_AT';

		setHeaders(locals.user
			? { 'Cache-Control': 'private, no-store' }
			: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120' });

		const pinnedForCategory = (allPinned as any[]).filter((d: any) => d.category?.id === category.id);

		if (sort === 'top' || sort === 'trending') {
			const threads = await fetchTopDiscussions(sort, category.slug, 50, locals.userToken);
			return {
				category,
				threads,
				pinned: pinnedForCategory,
				page: 1,
				totalPages: 1,
				totalCount: threads.length,
				sort,
				rateLimited: false
			};
		}

		const orderBy = sort === 'CREATED_AT' ? 'CREATED_AT' : 'UPDATED_AT';
		const discussions = await fetchThreadsByPage(category.id, page, PER_PAGE, orderBy, locals.userToken);

		const totalCount: number = discussions?.totalCount ?? 0;
		const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

		return {
			category,
			threads: discussions?.nodes || [],
			pinned: pinnedForCategory,
			page,
			totalPages,
			totalCount,
			sort,
			rateLimited: false
		};
	} catch (err) {
		if (err instanceof RateLimitError) {
			return {
				category: { name: params.slug.replace(/-/g, ' '), slug: params.slug, emoji: '', description: '', id: '' },
				threads: [],
				pinned: [],
				page: 1,
				totalPages: 1,
				totalCount: 0,
				sort: 'UPDATED_AT',
				rateLimited: true
			};
		}
		error(503, err instanceof Error ? err.message : 'Failed to load category');
	}
};
