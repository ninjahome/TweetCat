const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

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
    ];

    // 公共配置片段
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
        optimization: {
            minimize: mode === 'production',
            usedExports: true,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        compress: {
                            drop_console: true,
                            unused: true,
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

    // background 专用配置：目标是 webworker
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

    // 其他入口（popup / content / inject 等）保持 web 目标
    const webConfig = {
        ...common,
        entry: {
            welcome: path.resolve(__dirname, './src/popup/welcome.ts'),
            injection: path.resolve(__dirname, './src/injection.ts'),
            dashboard: path.resolve(__dirname, './src/popup/dashboard.ts'),
            content: path.resolve(__dirname, './src/content/main_entrance.ts'),
            following_mgn: path.resolve(__dirname, './src/popup/following_mgn.ts'),
            yt_content: path.resolve(__dirname, './src/youtube/content.ts'),
            yt_inject: path.resolve(__dirname, './src/youtube/inject.ts'),
            wallet_new: path.resolve(__dirname, './src/popup/wallet_new.ts'),
        },
        target: 'web',
    };

    // 返回两份配置
    return [bgConfig, webConfig];
};
