const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
    const mode = argv.mode || 'development';

    const plugins = [
        new webpack.IgnorePlugin({
            checkResource(resource) {
                return /.*\/wordlists\/(?!english).*\.json/.test(resource);
            },
        }),
        new webpack.ProvidePlugin({
            process: 'process/browser',
        }),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(mode),
        }),
        new Dotenv({
            systemvars: true,
        }),
    ];

    const common = {
        mode,
        devtool: mode === 'development' ? 'inline-source-map' : false,
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                },
            ],
        },
        // --- 新增：调整性能限制以消除 [big] 告警 ---
        performance: {
            hints: mode === 'production' ? 'warning' : false, // 仅在生产模式显示警告
            maxAssetSize: 2000000, // 提高限额到 2MB (你目前最大是 ~961KB)
            maxEntrypointSize: 2000000,
        },
        // ---------------------------------------
        optimization: {
            minimize: mode === 'production',
            usedExports: true,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        compress: {
                            drop_console: mode === 'production', // 仅生产环境删除 log
                            unused: true,
                            dead_code: true,
                        },
                        format: {
                            comments: false,
                        },
                    },
                    extractComments: false,
                }),
            ],
        },
        resolve: {
            alias: {
                linkedom: path.resolve(__dirname, "src/shims/linkedom.ts"),
            },
            extensions: ['.tsx', '.ts', '.js'],
            fallback: {
                process: false,
                canvas: false,
            },
        },
        plugins,
        output: {
            filename: 'js/[name].js',
            path: path.resolve(__dirname, 'dist'),
        },
    };

    const bgConfig = {
        ...common,
        entry: {
            background: path.resolve(__dirname, './src/service_work/background.ts'),
        },
        target: 'webworker',
        resolve: {
            ...common.resolve,
            fallback: {
                ...common.resolve.fallback,
                fs: false,
                net: false,
                tls: false,
                path: false,
                stream: false,
                crypto: false,
                zlib: false,
                http: false,
                https: false,
                url: false,
            },
        },
    };

    const webConfig = {
        ...common,
        entry: {
            welcome: path.resolve(__dirname, './src/popup/welcome.ts'),
            injection: path.resolve(__dirname, './src/injection.ts'),
            dashboard: path.resolve(__dirname, './src/popup/dashboard.ts'),
            content: path.resolve(__dirname, './src/content/main_entrance.ts'),
            following_mgn: path.resolve(__dirname, './src/popup/following_mgn.ts'),
            wallet_offscreen: path.resolve(__dirname, './src/popup/wallet_offscreen.ts'),
            yt_content: path.resolve(__dirname, './src/youtube/content.ts'),
            yt_inject: path.resolve(__dirname, './src/youtube/inject.ts'),
            wallet_new: path.resolve(__dirname, './src/popup/wallet_new.ts'),
            cdp_auth: path.resolve(__dirname, './src/popup/cdp_auth.ts'),
            cdp_auth_auto_x: path.resolve(__dirname, './src/popup/cdp_auth_auto_x.ts'),
            x402_payment: path.resolve(__dirname, './src/popup/x402_payment.ts'),
            transfer_by_twitter: path.resolve(__dirname, './src/popup/transfer_by_twitter.ts'),
            ipfs_local_content: path.resolve(__dirname, './src/content/ipfs_local.ts'),
            rewards: path.resolve(__dirname, './src/popup/rewards.ts'),
            fees: path.resolve(__dirname, './src/popup/fees.ts'),
            buy_usdc: path.resolve(__dirname, './src/popup/buy_usdc.ts'),
        },
        target: 'web',
    };

    return [bgConfig, webConfig];
};