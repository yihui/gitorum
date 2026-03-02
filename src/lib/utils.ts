export const REACTION_CONTENTS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'] as const;
export type ReactionContent = typeof REACTION_CONTENTS[number];

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)+/g, '');
}

export function formatDate(dateString: string): string {
	const d = new Date(dateString);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function truncateText(text: string, maxLength: number = 200): string {
	return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

export function reactionEmoji(content: string): string {
	const map: Record<string, string> = {
		THUMBS_UP: '👍',
		THUMBS_DOWN: '👎',
		LAUGH: '😄',
		HOORAY: '🎉',
		CONFUSED: '😕',
		HEART: '❤️',
		ROCKET: '🚀',
		EYES: '👀'
	};
	return map[content] || content;
}
