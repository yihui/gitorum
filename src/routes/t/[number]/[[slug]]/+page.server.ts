import { fetchThread, RateLimitError } from '$lib/server/github';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals, setHeaders }) => {
	const number = parseInt(params.number, 10);
	if (isNaN(number)) error(400, 'Invalid thread number');

	const commentPage = Math.max(1, parseInt(url.searchParams.get('cp') || '1', 10) || 1);

	try {
		const thread = await fetchThread(number, commentPage, locals.userToken);
		if (!thread) error(404, 'Thread not found');

		setHeaders(locals.user
			? { 'Cache-Control': 'private, no-store' }
			: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120' });

		return { thread, rateLimited: false };
	} catch (err) {
		if (err instanceof RateLimitError) {
			return { thread: null, rateLimited: true };
		}
		error(503, err instanceof Error ? err.message : 'Failed to load thread');
	}
};
