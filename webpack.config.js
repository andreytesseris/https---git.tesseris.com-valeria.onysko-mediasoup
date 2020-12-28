const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

module.exports = {
    entry: ['@babel/polyfill', "./public/app/js/index.js"],
    output: {
        "path": __dirname + '/public/build',
        "filename": "bundle.js"
    },
    mode: "production",    
    optimization: {
        minimizer: [
            new UglifyJsPlugin({
                test: /\.js(\?.*)?$/i
            }),
        ],
    },
    module: {
        rules: [
            {
                test: /\.(js)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                        plugins: [
                            [
                              "@babel/plugin-proposal-class-properties",
                              {
                                "loose": true
                              }
                            ]
                          ]
                    },
                }
            }
        ],
    },
};