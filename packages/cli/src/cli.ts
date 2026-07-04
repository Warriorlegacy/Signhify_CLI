import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { loadConfig, saveConfig, signhifyConfigSchema } from './config.js';
import { runInteractive } from './interactive.js';
import { runNonInteractive } from './non-interactive.js';
import { runSetupWizard } from './wizard.js';

export async function runCli(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName('signhify')
    .command('$0', 'Start interactive Signhify session', () => {}, async () => {
      const config = await loadConfig();
      await runInteractive(config);
    })
    .command('run <task>', 'Run a task non-interactively (CI/CD mode)', (yargs) => {
      return yargs
        .positional('task', { type: 'string', demandOption: true, describe: 'Task to execute' })
        .option('auto', { type: 'boolean', default: false, alias: 'yes', describe: 'Suppress all confirmation prompts' })
        .option('output', { type: 'string', choices: ['json', 'text'] as const, default: 'text', describe: 'Output format' })
        .option('mode', { type: 'string', default: 'build', describe: 'Agent mode' });
    }, async (argv) => {
      const config = await loadConfig();
      await runNonInteractive(argv.task as string, config, {
        auto: argv.auto as boolean,
        output: argv.output as 'json' | 'text',
        mode: argv.mode as string,
      });
    })
    .command('wizard', 'Run first-run setup wizard', () => {}, async () => {
      await runSetupWizard();
    })
    .help()
    .parse();
}
