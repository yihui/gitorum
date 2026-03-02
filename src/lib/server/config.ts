/**
 * Forum configuration loaded from gitorum.config.json at the project root.
 *
 * Edit that file to customise the forum without changing application code.
 *
 * Supported top-level keys
 * ─────────────────────────
 * categories.hidden    – slugs of GitHub Discussion categories that should be
 *                        invisible everywhere in the forum (listing pages, the
 *                        /new dropdown, and direct /c/<slug> URLs return 404).
 *
 * categories.ownerOnly – slugs of categories where only the repository owner
 *                        may create new threads.  The category still appears in
 *                        listing pages so readers can browse existing threads,
 *                        but the category is hidden from the /new dropdown for
 *                        all other users.
 *
 * Future keys (not yet used by the application):
 *   nav.header  – links to render in the site header navigation
 *   nav.footer  – links to render in the site footer navigation
 */

import rawConfig from '../../../gitorum.config.json';

export interface ForumConfig {
	categories: {
		/** Category slugs that are completely hidden from all forum pages. */
		hidden: string[];
		/** Category slugs where only the repo owner can post new threads. */
		ownerOnly: string[];
	};
}

export const forumConfig: ForumConfig = rawConfig as ForumConfig;

/** Returns true if the given category slug should be hidden everywhere. */
export function isCategoryHidden(slug: string): boolean {
	return forumConfig.categories.hidden.includes(slug);
}

/** Returns true if only the repo owner may post in the given category. */
export function isCategoryOwnerOnly(slug: string): boolean {
	return forumConfig.categories.ownerOnly.includes(slug);
}
