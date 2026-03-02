import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('gh_token');

	if (token) {
		try {
			const res = await fetch('https://api.github.com/graphql', {
				method: 'POST',
				headers: {
					Authorization: `bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					query: '{ viewer { login avatarUrl } }'
				})
			});

			if (res.ok) {
				const json = await res.json();
				if (json.data?.viewer) {
					event.locals.user = json.data.viewer;
					event.locals.userToken = token;
				}
			}
		} catch {
			// Token invalid or expired, clear it
			event.cookies.delete('gh_token', { path: '/' });
		}
	}

	if (!event.locals.user) {
		event.locals.user = null;
		event.locals.userToken = null;
	}

	return resolve(event, { preload: ({ type }) => type !== 'css' });
};
