import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as path from 'node:path';
import { MemoryStore, type Session } from '@signhify/memory';
import { loadConfig } from './config.js';
import { runInteractive } from './interactive.js';
import { runNonInteractive } from './non-interactive.js';
import { runSetupWizard } from './wizard.js';
import { runStdioServer } from './stdio-server.js';

export function formatSessionLine(s: Session): string {
  const titleStr = s.title ? ` - "${s.title}"` : '';
  const cpCount = s.checkpointCount ?? 0;
  const cpStr = `(${cpCount} checkpoint${cpCount === 1 ? '' : 's'})`;
  const createdStr = s.createdAt ?? 'unknown date';
  return `  ${s.id}${titleStr} [${createdStr}] ${cpStr}`;
}

export function buildCli(yargsInstance = yargs()) {
  return yargsInstance
    .scriptName('signhify')
    .command('$0', 'Start interactive Signhify session', (yargs) => {
      return yargs
        .option('resume', { type: 'string', describe: 'Resume a session by ID' })
        .option('provider', { type: 'string', describe: 'Active LLM provider vendor (anthropic, openai, gemini, groq, etc.)' })
        .option('api-key', { type: 'string', describe: 'API key for the active provider' })
        .option('model', { type: 'string', describe: 'Model name/ID' });
    }, async (argv) => {
      const config = await loadConfig({
        cliApiKey: (argv['api-key'] || argv.apiKey) as string | undefined,
        cliProvider: argv.provider as string | undefined,
        cliModel: argv.model as string | undefined,
      });
      await runInteractive(config, { resume: argv.resume as string | undefined });
    })
    .command('resume [sessionId]', 'Resume an existing session in interactive mode', (yargs) => {
      return yargs
        .positional('sessionId', { type: 'string', describe: 'Session ID to resume' })
        .option('session', { type: 'string', alias: 's', describe: 'Session ID to resume' });
    }, async (argv) => {
      const sid = (argv.sessionId as string | undefined) ?? (argv.session as string | undefined);
      if (!sid) {
        console.error('Error: Please provide a session ID to resume. Run "signhify sessions" to view sessions.');
        process.exitCode = 1;
        return;
      }
      const config = await loadConfig();
      await runInteractive(config, { resume: sid });
    })
    .command('sessions', 'List recent sessions with checkpoint counts', (yargs) => {
      return yargs
        .option('limit', { type: 'number', default: 20, describe: 'Max number of sessions to list' })
        .option('json', { type: 'boolean', default: false, describe: 'Output as JSON' });
    }, async (argv) => {
      const cwd = process.cwd();
      const dbPath = path.join(cwd, '.signhify', 'memory.db');
      const memoryStore = new MemoryStore(dbPath);
      try {
        const sessions = memoryStore.listSessions(argv.limit as number);
        if (argv.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else {
          if (sessions.length === 0) {
            console.log('No sessions found.');
          } else {
            console.log('Recent sessions:');
            for (const s of sessions) {
              console.log(formatSessionLine(s));
            }
          }
        }
      } finally {
        memoryStore.close();
      }
    })
    .command('run [task]', 'Run a task non-interactively or resume an interactive session', (yargs) => {
      return yargs
        .positional('task', { type: 'string', demandOption: false, describe: 'Task to execute' })
        .option('auto', { type: 'boolean', default: false, alias: 'yes', describe: 'Suppress all confirmation prompts' })
        .option('output', { type: 'string', choices: ['json', 'text'] as const, default: 'text', describe: 'Output format' })
        .option('mode', { type: 'string', default: 'build', describe: 'Agent mode' })
        .option('resume', { type: 'string', describe: 'Resume a registered session id: loads its newest checkpoint as context' })
        .option('provider', { type: 'string', describe: 'Active LLM provider vendor' })
        .option('api-key', { type: 'string', describe: 'API key for the active provider' })
        .option('model', { type: 'string', describe: 'Model name/ID' });
    }, async (argv) => {
      const config = await loadConfig({
        cliApiKey: (argv['api-key'] || argv.apiKey) as string | undefined,
        cliProvider: argv.provider as string | undefined,
        cliModel: argv.model as string | undefined,
      });
      if (!argv.task && argv.resume) {
        await runInteractive(config, { resume: argv.resume as string });
        return;
      }
      if (!argv.task) {
        await runInteractive(config);
        return;
      }
      const result = await runNonInteractive(argv.task as string, config, {
        auto: argv.auto as boolean,
        output: argv.output as 'json' | 'text',
        mode: argv.mode as string,
        resume: argv.resume as string | undefined,
      });
      process.exitCode = result.exitCode;
    })
    .command('serve', 'Start the local IDE session host over stdio', (yargs) => {
      return yargs.option('stdio', {
        type: 'boolean',
        default: true,
        describe: 'Use newline-delimited JSON-RPC over stdin/stdout',
      });
    }, async (argv) => {
      if (!argv.stdio) throw new Error('The local session host currently requires --stdio');
      await runStdioServer();
    })
    .command(['wizard', 'configure'], 'Run first-run setup wizard or configure provider settings', () => {}, async () => {
      await runSetupWizard();
    })
    .help();
}

export async function runCli(args = hideBin(process.argv)): Promise<void> {
  const cli = buildCli(yargs(args));
  await cli.parse();
}
