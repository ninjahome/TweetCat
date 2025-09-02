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

    return {
        mode: mode,
        devtool: mode === 'development' ? 'inline-source-map' : false, // 生产模式下不生成 Source Map
        entry: {
            background: path.resolve(__dirname, './src/service_work/background.ts'),
            welcome: path.resolve(__dirname, './src/popup/welcome.ts'),
            injection: path.resolve(__dirname, './src/injection.ts'),
            dashboard: path.resolve(__dirname, './src/popup/dashboard.ts'),
            content: path.resolve(__dirname, './src/content/main_entrance.ts'),
            kol_mg: path.resolve(__dirname, './src/popup/kol_mg.ts'),
            yt_content: path.resolve(__dirname, './src/youtube/content.ts'),
            yt_inject: path.resolve(__dirname, './src/youtube/inject.ts'),
        },
        output: {
            filename: 'js/[name].js',
            path: path.resolve(__dirname, 'dist'),
        },
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
                            drop_console: true, // 可选：移除 console.log
                            unused: true,  // 启用删除未使用的代码
                        },
                        format: {
                            comments: false, // 移除注释
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
        plugins: plugins,
    };
};
