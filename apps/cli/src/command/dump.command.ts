import * as ADCSDK from '@api7/adc-sdk';
import { Listr, ListrTask } from 'listr2';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';

import { SignaleRenderer } from '../utils/listr';
import { TaskContext } from './diff.command';
import { BackendCommand } from './helper';
import type { BackendOptions } from './typing';
import {
  filterConfiguration,
  filterResourceType,
  loadBackend,
  recursiveRemoveMetadataField,
} from './utils';

type DumpOptions = BackendOptions & {
  output: string;
};

export interface LoadRemoteConfigurationTaskOptions {
  backend: ADCSDK.Backend;
  labelSelector?: BackendOptions['labelSelector'];
  includeResourceType?: Array<ADCSDK.ResourceType>;
  excludeResourceType?: Array<ADCSDK.ResourceType>;
}
export const LoadRemoteConfigurationTask = ({
  backend,
  labelSelector,
  includeResourceType,
  excludeResourceType,
}: LoadRemoteConfigurationTaskOptions): ListrTask => ({
  title: 'Load remote configuration',
  task: async (ctx, task) => {
    return task.newListr([
      {
        title: 'Fetch all configuration',
        task: async () => await backend.dump(),
      },
      {
        title: 'Filter configuration resource type',
        enabled: () =>
          includeResourceType?.length > 0 || excludeResourceType?.length > 0,
        task: () => {
          ctx.remote = filterResourceType(
            ctx.remote,
            includeResourceType,
            excludeResourceType,
          );
        },
      },
      {
        title: 'Filter remote configuration',
        enabled: !!labelSelector,
        task: (ctx) => {
          [ctx.remote] = filterConfiguration(ctx.remote, labelSelector);
        },
      },
    ]);
  },
});

export const DumpCommand = new BackendCommand<DumpOptions>(
  'dump',
  'Dump configurations from the backend',
)
  .option(
    '-o, --output <file-path>',
    'Specify the file path where data is dumped from the backend',
    'adc.yaml',
  )
  .addExample('adc dump')
  .addExample('adc dump -o other-name.yaml')
  .handle(async (opts) => {
    const backend = loadBackend(opts.backend, opts);
    const tasks = new Listr<TaskContext, typeof SignaleRenderer>(
      [
        LoadRemoteConfigurationTask({
          backend,
          labelSelector: opts.labelSelector,
          includeResourceType: opts.includeResourceType,
          excludeResourceType: opts.excludeResourceType,
        }),
        {
          // Remove output resource metadata fields
          task: (ctx) => recursiveRemoveMetadataField(ctx.remote),
        },
        {
          title: 'Write to dump file',
          task: async (ctx, task) => {
            await writeFile(opts.output, stringify(ctx.remote), {});
            task.output = `Dump backend configuration to ${path.resolve(
              opts.output,
            )} successfully!`;
          },
        },
      ],
      {
        renderer: SignaleRenderer,
        rendererOptions: { verbose: opts.verbose },
        ctx: { remote: {}, local: {}, diff: [], defaultValue: {} },
      },
    );

    try {
      await tasks.run();
    } catch (err) {
      //console.log(chalk.red(`Failed to dump backend configuration from backend, ${err}`));
      process.exit(1);
    }
  });
