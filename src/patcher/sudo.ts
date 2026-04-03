import { execFileSync } from 'child_process';
import chalk from 'chalk';
import type { PreflightResult } from '@/types.js';

/** Re-exec the current CLI under sudo, forwarding resolved paths as env vars. */
export function execWithSudo(preflight: PreflightResult): never {
  const args = process.argv.slice(1);
  console.log(chalk.yellow('  Binary requires elevated permissions. Re-running with sudo...\n'));

  const env: string[] = [`HOME=${process.env.HOME ?? ''}`];
  if (preflight.bunPath) env.push(`ANYBUDDY_BUN_PATH=${preflight.bunPath}`);
  if (preflight.binaryPath) env.push(`CLAUDE_BINARY=${preflight.binaryPath}`);

  try {
    execFileSync('sudo', ['env', ...env, process.execPath, ...args], {
      stdio: 'inherit',
    });
    process.exit(0);
  } catch {
    console.error(chalk.red('  Sudo failed. Try: sudo any-buddy'));
    process.exit(1);
  }
}
