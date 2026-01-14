#!/usr/bin/env node
/**
 * Start All Services
 * Runs both the trading bot and web UI in a single process
 * Designed for Railway single-service deployment
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('='.repeat(60));
console.log('  MT5 TRADING BOT - STARTING ALL SERVICES');
console.log('='.repeat(60));
console.log(`  Time: ${new Date().toISOString()}`);
console.log(`  Node: ${process.version}`);
console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
console.log('='.repeat(60));

// Track child processes
const processes = [];

/**
 * Spawn a child process with logging
 */
function startProcess(name, command, args, options = {}) {
  console.log(`\n[${name}] Starting: ${command} ${args.join(' ')}`);

  const proc = spawn(command, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
    shell: process.platform === 'win32',
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`[${name}] ${line}`);
      }
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`[${name}] ${line}`);
      }
    });
  });

  proc.on('error', (error) => {
    console.error(`[${name}] Error:`, error.message);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[${name}] Exited with code ${code}, signal ${signal}`);

    // If a critical process dies, restart it after a delay
    if (options.restart && code !== 0) {
      console.log(`[${name}] Restarting in 5 seconds...`);
      setTimeout(() => {
        const newProc = startProcess(name, command, args, options);
        const index = processes.findIndex(p => p.proc === proc);
        if (index !== -1) {
          processes[index].proc = newProc;
        }
      }, 5000);
    }
  });

  processes.push({ name, proc, options });
  return proc;
}

/**
 * Graceful shutdown
 */
function shutdown(signal) {
  console.log(`\n[MAIN] Received ${signal}, shutting down...`);

  processes.forEach(({ name, proc }) => {
    console.log(`[MAIN] Stopping ${name}...`);
    proc.kill('SIGTERM');
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('[MAIN] Force exit');
    process.exit(0);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the web UI (Next.js)
const port = process.env.PORT || 3001;
startProcess('WEB', 'npm', ['run', 'start', '--', '-p', port.toString()], {
  restart: true,
  env: { PORT: port.toString() }
});

// Wait a moment for web UI to start, then start the trading bot
setTimeout(() => {
  startProcess('BOT', 'node', ['scripts/trading-bot.mjs'], {
    restart: true,
  });
}, 3000);

// Keep the main process alive
console.log('\n[MAIN] All services starting...');
console.log(`[MAIN] Web UI will be available at http://localhost:${port}`);
console.log('[MAIN] Press Ctrl+C to stop all services\n');
