/* @flow */

import Qingcloud from 'qingcloud';

import type { QCBackend, LB, QCNic } from './types';
import { sleep, logger } from './utils';

type SavedBackend = QCBackend & {
  loadbalancer_backend_id: string;
};

const actions = {
  DescribeLoadBalancerBackends: {
    required: ['zone'],
    optional: ['loadbalancer_backends.n', 'loadbalancer_listener', 'loadbalancer', 'verbose', 'offset', 'limit'],
  },
  AddLoadBalancerBackends: {
    required: ['zone', 'loadbalancer_listener', 'backends.n'],
    optional: [],
  },
  DeleteLoadBalancerBackends: {
    required: ['zone', 'loadbalancer_backends.n'],
    optional: [],
  },
  DescribeLoadBalancerListeners: {
    required: ['zone'],
    optional: ['loadbalancer_listeners.n', 'loadbalancer', 'verbose', 'offset', 'limit'],
  },
  DescribeLoadBalancers: {
    required: ['zone'],
    optional: ['loadbalancers.n', 'status.n', 'search_word', 'tags.n', 'verbose', 'offset', 'limit'],
  },
  UpdateLoadBalancers: {
    required: ['zone', 'loadbalancers.n'],
    optional: [],
  },
  DescribeJobs: {
    required: ['zone'],
    optional: ['jobs.n', 'status.n', 'job_action', 'verbose', 'offset', 'limit'],
  },
  DescribeNics: {
    required: ['zone'],
    optional: ['nics.n', 'offset', 'limit'],
  },
};

function equalBackend(backend1: QCBackend, backend2: QCBackend): boolean {
  return (
    backend1.resource_id === backend2.resource_id &&
    backend1.port === backend2.port &&
    backend1.nic_id === backend2.nic_id
  );
}

export default class QingcloudAPI {
  api: Object;
  zone: string;

  constructor(zone: string, accessKey: string, secretKey: string) {
    this.zone = zone;
    this.api = new Qingcloud(accessKey, secretKey);
    Object.keys(actions).forEach((action) => {
      this.api.initAction(action, actions[action]);
    });
  }

  request(method: string, payload: Object): Promise<Object> {
    const { api, zone } = this;
    const body = Object.assign({ zone }, payload);
    return new Promise((resolve, reject) => {
      api[method](body, (err, data) => {
        if (err) {
          logger('qingcloud api request failure, %O', err);
          reject(new Error(err.message));
        } else {
          resolve(data);
        }
      });
    });
  }

  async describeNics(): Promise<Array<QCNic>> {
    let nics = [];
    let total = 0;
    const offset = 0;
    do {
      const response = await this.request('DescribeNics', { // eslint-disable-line no-await-in-loop
        offset: offset + nics.length,
        limit: 100,
      });
      nics = nics.concat(response.nic_set);
      total = response.total_count;
    } while (nics.length < total);
    return nics;
  }

  async addBackends(lbconfig: LB, backends: Array<QCBackend>): Promise<void> {
    if (!backends.length) {
      return;
    }

    await this.request('AddLoadBalancerBackends', {
      loadbalancer_listener: lbconfig.listener,
      backends: backends.map(b => Object.assign({}, b, {
        loadbalancer_policy_id: lbconfig.policy,
      })),
    });
  }

  async removeBackends(lbconfig: LB, backends: Array<SavedBackend>): Promise<void> {
    if (!backends.length) {
      return;
    }
    await this.request('DeleteLoadBalancerBackends', {
      loadbalancer_backends: backends.map(b => b.loadbalancer_backend_id),
    });
  }

  async fetchBackends(lbconfig: LB): Promise<Array<SavedBackend>> {
    const response = await this.request('DescribeLoadBalancerBackends', {
      loadbalancer_listener: lbconfig.listener,
    });

    return response.loadbalancer_backend_set.filter(
      backend => backend.loadbalancer_policy_id === lbconfig.policy);
  }

  async syncBackends(
    lbconfig: LB,
    newBackends: Array<QCBackend>,
    filter?: (backendName: string) => boolean,
  ): Promise<boolean> {
    let currBackends = await this.fetchBackends(lbconfig);

    if (filter) {
      currBackends = currBackends.filter(backend =>
        filter && filter(backend.loadbalancer_backend_name));
    }

    const backendsToRemove = currBackends.filter(
      backend => !newBackends.some(equalBackend.bind(null, backend)));

    const backendsToAdd = newBackends.filter(
      backend => !currBackends.some(equalBackend.bind(null, backend)));

    logger('backends to add: %o', backendsToAdd);
    logger('backends to remove: %o', backendsToRemove);
    const backendsChanged = !!(backendsToRemove.length || backendsToAdd.length);

    await Promise.all([
      this.addBackends(lbconfig, backendsToAdd),
      this.removeBackends(lbconfig, backendsToRemove),
    ]);

    return backendsChanged;
  }

  async updateLoadBalancers(listenerIDs: Array<string>): Promise<void> {
    if (!listenerIDs.length) {
      return;
    }

    const response = await this.request('DescribeLoadBalancerListeners', {
      loadbalancer_listeners: Array.from(new Set(listenerIDs)),
    });

    const loadBalancerIDs = response.loadbalancer_listener_set.map(
      listener => listener.loadbalancer_id);

    const { job_id: jobID } = await this.request('UpdateLoadBalancers', {
      loadbalancers: Array.from(new Set(loadBalancerIDs)),
    });

    await this.waitForJob(jobID);
  }

  async waitForJob(jobID: string): Promise<void> {
    const response = await this.request('DescribeJobs', {
      jobs: [jobID],
    });

    const waitingForStatus = ['working', 'pending'];

    if (response.job_set.length > 0 && waitingForStatus.includes(response.job_set[0].status)) {
      await sleep(1000);
      await this.waitForJob(jobID);
    } else {
      logger('job', jobID, response.job_set[0].status);
    }
  }

}
