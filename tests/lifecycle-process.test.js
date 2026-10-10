import { afterEach, describe, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = process.cwd();
const preloadPath = path.join(currentDirectory, 'fixtures/lifecycle-preload.cjs');
const children = new Set();
const temporaryDirectories = new Set();

function waitForMessage(child, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Child message timed out after ${timeoutMs}ms\n${child.output}`)), timeoutMs);
    const onMessage = (message) => {
      if (predicate(message)) finish(null, message);
    };
    const finish = (error, message) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(message);
    };
    const onExit = (code, signal) => finish(new Error(
      `Child exited before expected message (code=${code}, signal=${signal})\n${child.output}`
    ));
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

function waitForExit(child, timeoutMs = 3000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Child exit timed out after ${timeoutMs}ms`)), timeoutMs);
    const onExit = (code, signal) => finish(null, { code, signal });
    const finish = (error, result) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(result);
    };
    child.once('exit', onExit);
  });
}

function launchChild(dataDirectory, extraEnv = {}) {
  const child = fork(path.join(repositoryDirectory, 'src/index.js'), [], {
    cwd: repositoryDirectory,
    execArgv: ['--require', preloadPath],
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: 'test-token',
      OPENROUTER_API_KEY: 'test-key',
      BOT_DATA_DIR: dataDirectory,
      HISTORY_SAVE_INTERVAL_MS: '1000',
      DEBUG: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.output = '';
  child.stdout.on('data', (chunk) => { child.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.output += chunk.toString(); });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function makeDataDirectory() {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bratishka-lifecycle-'));
  temporaryDirectories.add(dataDirectory);
  return dataDirectory;
}

async function send(child, message) {
  await new Promise((resolve, reject) => {
    child.send(message, (error) => error ? reject(error) : resolve());
  });
}

afterEach(async () => {
  for (const child of children) child.kill('SIGKILL');
  await Promise.all([...children].map((child) => new Promise((resolve) => child.once('exit', resolve))));
  children.clear();
  await Promise.all([...temporaryDirectories].map((directory) => fs.rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

describe('entrypoint signal handling with real history files', () => {
  it.each(['SIGINT', 'SIGTERM'])('drains an admitted reply before %s exits', async (signal) => {
    const dataDirectory = await makeDataDirectory();
    const child = launchChild(dataDirectory, { LIFECYCLE_DEFER_SEND: 'true' });
    await waitForMessage(child, (message) => message.type === 'polling-started');

    const sendStarted = waitForMessage(child, (message) => message.type === 'send-started');
    await send(child, { type: 'inject-message' });
    await sendStarted;
    child.kill(signal);
    const stopped = await waitForMessage(child, (message) => message.type === 'polling-stopped');
    expect(stopped.cancel).toBe(true);
    child.kill(signal);
    expect(child.exitCode).toBeNull();

    await send(child, { type: 'release-send' });
    expect(await waitForExit(child)).toEqual({ code: 0, signal: null });
    const history = JSON.parse(await fs.readFile(path.join(dataDirectory, 'history.json'), 'utf8'));
    expect(history[42].map((entry) => [entry.role, entry.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'synthetic answer'],
    ]);
  });

  it('does not resume polling when identity completes after a stop signal', async () => {
    const dataDirectory = await makeDataDirectory();
    const child = launchChild(dataDirectory, { LIFECYCLE_DEFER_IDENTITY: 'true' });
    await waitForMessage(child, (message) => message.type === 'identity-started');
    child.kill('SIGTERM');
    const stopped = waitForMessage(child, (message) => message.type === 'polling-stopped');
    const notStarted = waitForMessage(child, (message) => message.type === 'polling-started', 150);
    await stopped;
    await send(child, { type: 'release-identity' });
    expect(await notStarted.then(() => false, () => true)).toBe(true);
    expect(await waitForExit(child)).toEqual({ code: 0, signal: null });
  });

  it('preserves a startup failure that arrives while a signal shutdown is waiting', async () => {
    const dataDirectory = await makeDataDirectory();
    const child = launchChild(dataDirectory, {
      LIFECYCLE_DEFER_IDENTITY: 'true',
      LIFECYCLE_FAIL_IDENTITY: 'true',
    });
    await waitForMessage(child, (message) => message.type === 'identity-started');
    child.kill('SIGTERM');
    await waitForMessage(child, (message) => message.type === 'polling-stopped');
    await send(child, { type: 'release-identity' });
    expect(await waitForExit(child)).toEqual({ code: 1, signal: null });
    expect(child.output).toContain('Failed to start bot:');
  });

  it('flushes persistence and exits nonzero after startup failure', async () => {
    const dataDirectory = await makeDataDirectory();
    const child = launchChild(dataDirectory, { LIFECYCLE_FAIL_IDENTITY: 'true' });
    expect(await waitForExit(child)).toEqual({ code: 1, signal: null });
    expect(child.output).toContain('Failed to start bot:');
  });

  it('flushes persistence and exits nonzero when polling startup fails', async () => {
    const dataDirectory = await makeDataDirectory();
    const child = launchChild(dataDirectory, { LIFECYCLE_FAIL_POLLING: 'true' });
    expect(await waitForExit(child)).toEqual({ code: 1, signal: null });
    expect(child.output).toContain('Failed to start bot:');
  });
});
