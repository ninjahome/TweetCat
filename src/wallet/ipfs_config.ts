// 通过 Webpack 的 dotenv-webpack 注入的构建变量
const JWT = process.env.TWEETCAT_PINATA_JWT || '';
const GATEWAY = process.env.TWEETCAT_PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
const JSON_ENDPOINT = process.env.TWEETCAT_PINATA_JSON || 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const FILE_ENDPOINT = process.env.TWEETCAT_PINATA_FILE || 'https://api.pinata.cloud/pinning/pinFileToIPFS';

export const TWEETCAT_PINATA = {
    JWT,
    GATEWAY,
    JSON_ENDPOINT,
    FILE_ENDPOINT,
} as const;

// 生产包强校验，避免漏配
if (process.env.NODE_ENV === 'production' && !TWEETCAT_PINATA.JWT) {
    // 你也可以选择 console.warn，而不是 throw
    throw new Error('Missing TWEETCAT_PINATA_JWT in production build');
}
