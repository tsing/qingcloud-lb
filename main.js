require('dotenv').load();
require('babel-register');
require('babel-polyfill');

global.fetch = require('node-fetch');

require('./src/main.js');
