// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user: { login: string; avatarUrl: string } | null;
			userToken: string | null;
			authError?: string | null;
		}
	}
}

export {};
