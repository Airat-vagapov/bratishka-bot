const { init, shutdown } = require('./bot');

let exitCode = 0;
let completion = null;

function requestShutdown() {
  if (!completion) {
    completion = shutdown()
      .catch((error) => {
        exitCode = 1;
        console.error('Failed to shut down bot cleanly:', error);
      })
      .finally(() => {
        process.exit(exitCode);
      });
  }
  return completion;
}

process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

init().catch((error) => {
  exitCode = 1;
  console.error('Failed to start bot:', error);
  requestShutdown();
});
