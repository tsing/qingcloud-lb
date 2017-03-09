/* @flow */

import type { App, LB, QCBackend } from './types';
import { sleep, logger } from './utils';

import CSphereAPI from './csphere';
import QingcloudAPI from './qingcloud';

export default class Manager {
  csphere: CSphereAPI;
  qingcloud: QingcloudAPI;
  queue: Array<LB>;
  lbPending: boolean;
  lbPromise: Promise<void>;

  constructor(csphere: CSphereAPI, qingcloud: QingcloudAPI) {
    this.csphere = csphere;
    this.qingcloud = qingcloud;
    this.queue = [];
    this.lbPending = false;
    this.lbPromise = Promise.resolve();
  }

  async sync(app: App, lbs: Array<LB>): Promise<void> {
    logger('syncing app: %o', app);
    const backends = await this.fetchBackends(app);
    logger('fetched backends: %o', backends);
    const changedLbs = await this.saveBackends(app, lbs, backends);
    if (changedLbs.length > 0) {
      this.queueLbUpdate(changedLbs);
    }
  }

  async fetchBackends(app: App): Promise<Array<QCBackend>> {
    const { instance, service, port } = app;

    const containers = await this.csphere.serviceContainers(instance, service);
    const nics = await this.qingcloud.describeNics();

    const backends = [];

    for (const container of containers) {
      const ip = container.Labels['com.docker.network.container.ipv4'];
      if (!ip) {
        logger('container ip empty: %O', container);
        continue;
      }

      const nic = nics.find(n => n.private_ip === ip);
      if (!nic) {
        logger('nic not found, coontainer: %O', container);
        continue;
      }

      backends.push({
        resource_id: nic.instance_id,
        nic_id: nic.nic_id,
        port,
        weight: service.weight || 10,
        loadbalancer_backend_name: `${container.Labels.csphere_containerseq}.${service}.${instance}`,
      });
    }

    return backends;
  }

  async saveBackends(
    app: App,
    lbs: Array<LB>,
    backends: Array<QCBackend>,
  ): Promise<Array<LB>> {
    const { qingcloud } = this;

    const nameFilter = (name: string) => name.endsWith(`.${app.service}.${app.instance}`);
    const promises = lbs.map(lb => qingcloud.syncBackends(lb, backends, nameFilter));

    const changes = await Promise.all(promises);
    return lbs.filter((_, idx) => changes[idx]);
  }

  queueLbUpdate(lbs: Array<LB>) {
    this.queue.push(...lbs);
  }

  async waitForLB() {
    await this.lbPromise;
  }

  async updateLB() {
    this.lbPending = true;
    const listeners = this.queue.map(lb => lb.listener);
    this.queue = [];

    logger('LB update started %o', listeners);
    await this.qingcloud.updateLoadBalancers(listeners);
    this.lbPending = false;

    if (this.queue.length > 0) {
      this.scheduleLbUpdate();
    }
  }

  async scheduleLbUpdate() {
    if (this.queue.length === 0) {
      return;
    }

    if (this.lbPending) {
      logger('LB update queued');
      return;
    }

    await sleep(300);
    this.lbPromise = this.updateLB();
  }
}
