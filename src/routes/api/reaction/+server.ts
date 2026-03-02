import { json, error } from '@sveltejs/kit';
import { toggleReaction } from '$lib/server/github';
import { REACTION_CONTENTS } from '$lib/utils';
import type { RequestHandler } from './$types';

const VALID_CONTENTS = new Set<string>(REACTION_CONTENTS);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.userToken) {
		error(401, 'Not authenticated');
	}

	const { subjectId, content, add } = await request.json();

	if (!subjectId || !content || !VALID_CONTENTS.has(content)) {
		error(400, 'Missing or invalid subjectId or content');
	}

	const reaction = await toggleReaction(locals.userToken, subjectId, content, !!add);
	return json(reaction);
};
