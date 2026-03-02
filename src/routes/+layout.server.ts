import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { renderMarkdown } from '$lib/markdown';

export const load: LayoutServerLoad = async ({ locals, setHeaders }) => {
	// All pages embed the auth-aware header, so responses must never be served
	// from a shared CDN cache — an anonymous cached page would be incorrectly
	// returned to authenticated users (Cloudflare ignores request cookies when
	// deciding whether to serve from cache).
	setHeaders({ 'Cache-Control': 'no-store' });

	// Sanitize admin-provided footer HTML for defense-in-depth
	const rawFooter = env.FORUM_FOOTER_HTML || '';
	const footerHtml = rawFooter ? renderMarkdown(rawFooter) : '';

	return {
		user: locals.user,
		authError: locals.authError || null,
		forumTitle: env.FORUM_TITLE || 'Gitorum',
		forumLogoUrl: env.FORUM_LOGO_URL || '',
		forumFooterHtml: footerHtml
	};
};
