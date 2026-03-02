import { json, error } from '@sveltejs/kit';
import { markCommentAsAnswer, getRepoOwner } from '$lib/server/github';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.userToken) {
		error(401, 'Not authenticated');
	}

	// Only the repo owner can mark/unmark answers.
	const repoOwner = getRepoOwner();
	if (locals.user.login !== repoOwner) {
		error(403, 'Only the repository owner can mark answers');
	}

	const { commentId, mark } = await request.json();

	if (!commentId || typeof mark !== 'boolean') {
		error(400, 'Missing commentId or mark');
	}

	const discussion = await markCommentAsAnswer(locals.userToken, commentId, mark);
	return json(discussion);
};
