/* @flow */

import LRU from 'lru-cache';

import type {
  CSphereCredential, QingcloudCredential,
  Service, LB, Backend, Mappings, ServiceContainer, Container, Node
} from './types';
import {sleep} from './utils';

import CSphereAPI, {exposedPort, isServiceContainer} from './csphere';
import QingcloudAPI from './qingcloud';

function sameService(service1: Service, service2: Service): boolean {
  return Object.keys(service1).every(key => service1[key] === service2[key]);
}

export default class Manager {
  csphere: CSphereAPI;
  qingcloud: QingcloudAPI;
  queue: Array<LB>;
  containerCache: LRU;
  lbPending: boolean;

  constructor(csphere: CSphereCredential, qingcloud: QingcloudCredential) {
    this.csphere = new CSphereAPI(csphere.url, csphere.token);
    this.qingcloud = new QingcloudAPI(qingcloud.zone, qingcloud.key, qingcloud.secret);
    this.queue = [];
    this.containerCache = LRU(200);
    this.lbPending = false;
  }

  async sync(service: Service, lbs: Array<LB>): Promise<Array<LB>> {
    console.log('Service', service);
    const backends = await this.fetchBackends(service);
    console.log('backends', backends);
    return await this.saveBackends(service, lbs, backends);
  }

  cache(container: ServiceContainer, service: Service): void {
    this.containerCache.set(container.Id, service);
  }

  popCache(containerID: string): ?Service {
    if (!this.containerCache.has(containerID)) {
      return null;
    }
    const service = this.containerCache.get(containerID);
    this.containerCache.del(containerID);
    return service;
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

  async saveBackends(service: Service, lbs: Array<LB>, backends: Array<Backend>): Promise<Array<LB>> {
    const {qingcloud} = this;

    const nameFilter = (name: string) => name.startsWith(`${service.instance}-${service.name}-`);
    const promises = lbs.map(async function(lb) {
      return await qingcloud.syncBackends(lb, backends, nameFilter);
    });

    const changes = await Promise.all(promises);
    return lbs.filter((_, idx) => changes[idx]);
  }

  queueLbUpdate(lbs: Array<LB>) {
    this.queue.push(...lbs);
  }

  scheduleLbUpdate() {
    if (this.queue.length === 0) {
      return;
    }

    if (this.lbPending) {
      console.log('LB update queued');
      return;
    }

    const onFinish = () => {
      console.log('LB update finished');

      this.lbPending = false;
      this.scheduleLbUpdate();
    };

    this.lbPending = true;
    const listeners = this.queue.map(lb => lb.listener);
    this.queue = [];

    console.log('LB update started');
    this.qingcloud
      .updateLoadBalancers(listeners)
      .then(onFinish);
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
      if (container) {
        mapping = mappings.find(m => isServiceContainer(container, m.service));
      } else {
        const cachedService = this.popCache(containerID);
        if (cachedService) {
          mapping = mappings.find(m => sameService(m.service, cachedService));
        }
      }

      if (mapping) {
        const lbs = await this.sync(mapping.service, mapping.lbs);
        this.queueLbUpdate(lbs);
        sleep(1000).then(() => this.scheduleLbUpdate());
      }
    }
  }
}
