/* @flow */

import type {
  CSphereCredential, QingcloudCredential,
  Service, LB, Backend, Mappings
} from './types';

import CSphereAPI, {exposedPort, isServiceContainer} from './csphere';
import QingcloudAPI from './qingcloud';

function sameService(service1: Service, service2: Service): boolean {
  return Object.keys(service1).every(key => service1[key] === service2[key]);
}

export default class Manager {
  csphere: CSphereAPI;
  qingcloud: QingcloudAPI;
  queue: Array<LB>;
  containerCache: {[key: string]: Service};
  lbPending: boolean;

  constructor(csphere: CSphereCredential, qingcloud: QingcloudCredential) {
    this.csphere = new CSphereAPI(csphere.url, csphere.token);
    this.qingcloud = new QingcloudAPI(qingcloud.zone, qingcloud.key, qingcloud.secret);
    this.queue = [];
    this.containerCache = {};
    this.lbPending = false;
  }

  async sync(service: Service, lbs: Array<LB>): Promise<void> {
    console.log('Service', service);
    const backends = await this.fetchBackends(service);
    console.log('backends', backends);
    await this.saveBackends(lbs, backends);
  }

  cache(container: Object, service: Service): void {
    this.containerCache[container.Id] = service;
  }

  inCache(containerID: string): ?Service {
    return this.containerCache[containerID];
  }

  async fetchBackends(service: Service): Promise<Array<Backend>> {
    const {instance, name, port} = service;

    const containers = await this.csphere.serviceContainers(instance, name);
    const nodeIDs = Array.from(new Set(containers.map(c => c.node_id)));
    const nodes = await this.csphere.nodes(nodeIDs);

    containers.forEach(c => this.cache(c, service));

    return containers.map(c => {
      const node = nodes.find(node => node.id === c.node_id);
      const nodePort = exposedPort(c, port);

      return {
        resource_id: node.labels.qingcloud,
        port: nodePort,
        weight: 1,
        loadbalancer_backend_name: `${instance}-${name}-${c.Labels.csphere_containerseq}`
      }
    });
  }

  async saveBackends(lbs: Array<LB>, backends: Array<Backend>): Promise<void> {
    const {qingcloud} = this;

    const promises = lbs.map(async function(lb) {
      return await qingcloud.syncBackends(lb, backends);
    });

    const changes = await Promise.all(promises);
    if (changes.some(bool => bool)) {
      await this.scheduleLbUpdate(lbs.filter((_, idx) => changes[idx]));
    }
  }

  async scheduleLbUpdate(lbs: Array<LB>): Promise<void> {
    this.queue.push(...lbs);
    if (this.lbPending) {
      console.log('LB update queued');
      return;
    }

    console.log('LB update started');

    this.lbPending = true;
    this.qingcloud
      .updateLoadBalancers(this.queue.map(lb => lb.listener))
      .then(() => {
        this.lbPending = false;
        if (this.queue.length > 0) {
          this.scheduleLbUpdate([]);
        }
      });
    this.queue = [];
  }

  async listenToEvents(mappings: Mappings): Promise<void> {
    const statusList = [
      'die',
      'restart',
      'start'
    ];

    const iteraotr = this.csphere.containerListener(statusList);
    for (const promise of iteraotr) {
      const {id: containerID} = await promise;
      const container = await this.csphere.container(containerID);
      let mapping = null;
      if (!container) {
        const cachedService = this.inCache(containerID);
        if (cachedService) {
          mapping = mappings.find(m => sameService(m.service, cachedService));
        }
      } else {
        mapping = mappings.find(m => isServiceContainer(container, m.service));
      }

      if (mapping) {
        await this.sync(mapping.service, mapping.lbs);
      }
    }
  }
}
