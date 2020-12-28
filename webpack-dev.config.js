
module.exports = {
    entry: ['@babel/polyfill', "./public/app/js/index.js"],
    output: {
        "path": __dirname + '/public/build',
        "filename": "bundle.js"
    },
    mode: "production",
    devtool: 'source-map',
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