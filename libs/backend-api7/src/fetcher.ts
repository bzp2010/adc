import * as ADCSDK from '@api7/adc-sdk';
import { Axios } from 'axios';
import { ListrTask } from 'listr2';

import { ToADC } from './transformer';
import * as typing from './typing';
import { buildReqAndRespDebugOutput } from './utils';

type FetchTask = ListrTask<{
  gatewayGroupId: string;
  remote: ADCSDK.Configuration;
}>;

export class Fetcher {
  private readonly toADC = new ToADC();

  constructor(private readonly client: Axios) {}

  public listServices(): FetchTask {
    return {
      title: 'Fetch services',
      task: async (ctx, task) => {
        const resp = await this.client.get<{ list: Array<typing.Service> }>(
          `/api/gateway_groups/${ctx.gatewayGroupId}/services`,
        );
        task.output = buildReqAndRespDebugOutput(resp, 'Get services');

        const services = resp?.data?.list;
        const fetchRoutes = services.map(async (service) => {
          if (service.type === 'http') {
            const resp = await this.client.get<{
              list: Array<typing.Route>;
            }>(`/api/service_versions/${service.service_version_id}/routes`);
            task.output = buildReqAndRespDebugOutput(
              resp,
              `Get routes in service "${service.name}"`,
            );
            service.routes = resp?.data?.list;
          } else {
            const resp = await this.client.get<{
              list: Array<typing.StreamRoute>;
            }>(
              `/api/service_versions/${service.service_version_id}/stream_routes`,
            );
            task.output = buildReqAndRespDebugOutput(
              resp,
              `Get stream routes in service "${service.name}"`,
            );
            service.stream_routes = resp?.data?.list;
          }
          return service;
        });
        await Promise.all(fetchRoutes);

        ctx.remote.services = services.map((item) =>
          this.toADC.transformService(item),
        );
      },
    };
  }

  public listConsumers(): FetchTask {
    return {
      title: 'Fetch consumers',
      task: async (ctx, task) => {
        const resp = await this.client.get<{ list: Array<typing.Consumer> }>(
          '/apisix/admin/consumers',
          {
            params: { gateway_group_id: ctx.gatewayGroupId },
          },
        );
        task.output = buildReqAndRespDebugOutput(resp, 'Get consumers');

        ctx.remote.consumers = resp?.data?.list?.map((item) =>
          this.toADC.transformConsumer(item),
        );
      },
    };
  }

  public listSSLs(): FetchTask {
    return {
      title: 'Fetch ssls',
      task: async (ctx, task) => {
        const resp = await this.client.get<{ list: Array<typing.SSL> }>(
          '/apisix/admin/ssls',
          {
            params: { gateway_group_id: ctx.gatewayGroupId },
          },
        );
        task.output = buildReqAndRespDebugOutput(resp, 'Get ssls');

        ctx.remote.ssls = resp?.data?.list?.map((item) =>
          this.toADC.transformSSL(item),
        );
      },
    };
  }

  public listGlobalRules(): FetchTask {
    return {
      title: 'Fetch global rules',
      task: async (ctx, task) => {
        const resp = await this.client.get<{ list: Array<typing.GlobalRule> }>(
          '/apisix/admin/global_rules',
          {
            params: { gateway_group_id: ctx.gatewayGroupId },
          },
        );
        task.output = buildReqAndRespDebugOutput(resp, 'Get global rules');

        ctx.remote.global_rules = this.toADC.transformGlobalRule(
          resp?.data?.list ?? [],
        );
      },
    };
  }

  public listMetadatas(): FetchTask {
    return {
      title: 'Fetch plugin metadata',
      task: async (ctx, task) => {
        const resp = await this.client.get<Array<string>>(
          '/apisix/admin/plugins/list',
          {
            params: { has_metadata: true },
          },
        );
        task.output = buildReqAndRespDebugOutput(
          resp,
          'Get plugins that contain plugin metadata',
        );

        const plugins = resp.data;
        const getMetadataConfig = plugins.map<
          Promise<[string, typing.PluginMetadata]>
        >(async (pluginName) => {
          try {
            const resp = await this.client.get<{
              value: typing.PluginMetadata;
            }>(`/apisix/admin/plugin_metadata/${pluginName}`, {
              params: { gateway_group_id: ctx.gatewayGroupId },
            });
            task.output = buildReqAndRespDebugOutput(
              resp,
              `Get plugin metadata for "${pluginName}"`,
            );
            return [pluginName, resp?.data?.value];
          } catch (err) {
            return [pluginName, null];
          }
        });
        const metadataObj = Object.fromEntries(
          (await Promise.all(getMetadataConfig)).filter((item) => item[1]),
        );

        ctx.remote.plugin_metadata =
          this.toADC.transformPluginMetadatas(metadataObj);
      },
    };
  }

  public allTask() {
    return [
      this.listServices(),
      this.listConsumers(),
      this.listSSLs(),
      this.listGlobalRules(),
      this.listMetadatas(),
    ];
  }
}