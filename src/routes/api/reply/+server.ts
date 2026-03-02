import { json, error } from '@sveltejs/kit';
import { addComment } from '$lib/server/github';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.userToken) {
		error(401, 'Not authenticated');
	}

	const { discussionId, body, replyToId } = await request.json();

	if (!discussionId || !body?.trim()) {
		error(400, 'Missing discussionId or body');
	}

	const comment = await addComment(locals.userToken, discussionId, body.trim(), replyToId || null);
	return json(comment);
};
