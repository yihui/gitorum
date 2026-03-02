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
					'Content-Type': 'application/json',
					'User-Agent': 'Gitorum'
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
				} else {
					// GraphQL returned 200 but no viewer data — show error in UI
					const gqlErrors = json.errors?.map((e: any) => e.message).join('; ');
					event.locals.authError = gqlErrors
						? `GitHub token validation failed: ${gqlErrors}`
						: 'GitHub token validation failed: no viewer data returned';
					console.error('Auth token validation: 200 OK but no viewer data', json.errors);
				}
			} else if (res.status === 401) {
				// Token explicitly rejected — clear it so the user can re-authenticate
				event.cookies.delete('gh_token', { path: '/' });
				event.locals.authError = 'Your GitHub session has expired. Please sign in again.';
			} else {
				// Other non-OK status — show the error but keep the token
				const body = await res.text().catch(() => '');
				event.locals.authError = `GitHub API returned HTTP ${res.status} while validating your token. You are browsing as a guest.`;
				console.error(`Auth token validation: HTTP ${res.status}`, body);
			}
		} catch (err) {
			// Network error — keep the token but show error
			event.locals.authError = 'Could not reach GitHub API to validate your token. You are browsing as a guest.';
			console.error('Auth token validation: network error', err);
		}
	}

	if (!event.locals.user) {
		event.locals.user = null;
		event.locals.userToken = null;
	}

	return resolve(event, { preload: ({ type }) => type !== 'css' });
};
