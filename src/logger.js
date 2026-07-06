const config = require('./config');

function log(...args) {
  if (config.debug) {
    console.log(...args);
  }
}

module.exports = { log };
