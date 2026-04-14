import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import path from 'path';

export default defineWorkersConfig({
	resolve: {
		alias: [
			{ find: /@solana\/web3.js/, replacement: path.resolve(__dirname, './test/mock-empty.ts') },
			{ find: /^@coinbase\/cdp-sdk(\/.*)?$/, replacement: path.resolve(__dirname, './test/mock-empty.ts') },
		]
	},
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
