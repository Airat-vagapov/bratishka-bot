const { init } = require('./bot');

init().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
