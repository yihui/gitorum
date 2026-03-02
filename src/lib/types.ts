export interface Category {
	id: string;
	name: string;
	description: string;
	emoji: string;
	slug: string;
}

export interface Author {
	login: string;
	avatarUrl: string;
	url: string;
}

export interface Reaction {
	content: string;
}

export interface ThreadSummary {
	id: string;
	number: number;
	title: string;
	createdAt: string;
	author: Author;
	comments: { totalCount: number };
	reactions: { totalCount: number };
	labels?: { nodes: { name: string }[] };
}

export interface ThreadDetail {
	id: string;
	number: number;
	title: string;
	body: string;
	bodyHTML: string;
	createdAt: string;
	url?: string;
	author: Author;
	reactions: { nodes: Reaction[]; totalCount: number };
	category: { name: string; slug: string };
	comments: {
		totalCount: number;
		pageInfo: { hasNextPage: boolean; endCursor: string };
		nodes: Comment[];
	};
}

export interface Comment {
	id: string;
	body: string;
	bodyHTML: string;
	createdAt: string;
	url?: string;
	isMinimized?: boolean;
	author: Author;
	reactions: { nodes: Reaction[]; totalCount: number };
	replies: {
		nodes: Reply[];
	};
}

export interface Reply {
	id: string;
	body: string;
	bodyHTML: string;
	createdAt: string;
	url?: string;
	author: Author;
}

export interface PageInfo {
	hasNextPage: boolean;
	endCursor: string;
}
