import type { Env } from '../src/common';

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}
