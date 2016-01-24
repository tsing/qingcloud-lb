/* @flow */

import EventSource from 'eventsource';

import CSphere, {isContainerRunning, containerHostPort, isServiceContainer} from './lib/csphere';
import Qingcloud from './lib/qingcloud';

import type {LBConfig, Backend} from './lib/qingcloud';
import type {ServiceConfig} from './lib/csphere';

function csphereAPI() {
  // $FlowIssue
  return new CSphere(process.env.CSPHERE_URL, process.env.CSPHERE_TOKEN);
}

let apiCache = null;
function qingcloudAPI() {
  if (!apiCache) {
    // $FlowIssue
    apiCache = new Qingcloud(process.env.QINGCLOUD_ZONE, process.env.QINGCLOUD_KEY, process.env.QINGCLOUD_SECRET);
  }
  return apiCache;
}

async function fetchServiceContainers(config: ServiceConfig) {
  const {instance, service, port} = config;

  const api = csphereAPI();
  const instancePayload = await api.instance(instance);
  const containerIDs = instancePayload.container_deploy_info[service] || [];
  return await api.containers(containerIDs);
}

async function fetchServiceBackends(config: ServiceConfig): Promise<Array<Backend>> {
  const {instance, service, port} = config;
  const api = csphereAPI();

  let containers = await fetchServiceContainers(config);
  containers = containers.filter(isContainerRunning);

  const nodeIDs = Array.from(
    new Set(containers.map(container => container.node_id)));
  const nodes = await api.nodes(nodeIDs);

  return containers.map(container => ({
    resource_id: nodes.find(node => node.id === container.node_id).labels.qingcloud,
    port: containerHostPort(container, port),
    weight: 1,
    loadbalancer_backend_name: `${instance}-${service}-${container.Labels.csphere_containerseq}`
  }));
}

async function syncBackends(lbConfigs: Array<LBConfig>, backends: Array<Backend>) {
  const api = qingcloudAPI();
  const promises = lbConfigs.map(async function(lbConfig) {
    await api.syncBackends(lbConfig, backends);
  });

  return await Promise.all(promises);
}

async function sync(serviceConfig: ServiceConfig, lbConfigs: Array<LBConfig>) {
  const backends = await fetchServiceBackends(serviceConfig);
  await syncBackends(lbConfigs, backends);
}

async function listenToEvents(serviceConfig: ServiceConfig, lbConfigs: Array<LBConfig>) {
  let containers = await fetchServiceContainers(serviceConfig);
  const api = csphereAPI();
  const statusList = [
    'destroy',
    'die',
    'kill',
    'oom',
    'pause',
    'restart',
    'start',
    'stop',
    'unpause'
  ];

  const iteraotr = api.containerListener(statusList);
  for (const promise of iteraotr) {
    const payload = await promise;
    const {id: containerID} = payload;
    console.log(containerID);
    if (containers.some(c => c.Id === containerID)) {
      containers = await fetchServiceContainers(serviceConfig);
      try {
        await sync(serviceConfig, lbConfigs);
      } catch (err) {
        console.error(err.stack);
      }
    } else {
      const [container] = await api.containers([containerID]);
      if (container && isServiceContainer(container, serviceConfig)) {
        await sync(serviceConfig, lbConfigs);
      }
    }
  }
}

async function main() {
  const instance = process.env.INSTANCE;
  const service = process.env.SERVICE;
  const port = process.env.SERVICE_PORT;
  const lbListeners = process.env.LB_LISTENERS;

  if (!instance || !service || !port || !lbListeners) {
    console.log({
      instance,
      service,
      port,
      lbListeners
    });
    console.log(process.env);
    throw new Error('Please check the environments provided');
  }

  const lbConfigs: Array<LBConfig> = lbListeners.split(/\s+/).map(listener => {
    const [listenerID, policyID] = listener.split(':');
    return {
      listenerID,
      policyID: policyID
    };
  });

  const serviceConfig = {
    instance,
    service,
    port: parseInt(port, 10)
  };

  console.log({
    serviceConfig,
    lbConfigs
  });

  await sync(serviceConfig, lbConfigs);
  await listenToEvents(serviceConfig, lbConfigs);
}

main().catch(err => {
  console.error(err.stack);
  process.exit(1);
});