/* @flow */

import querystring from 'querystring';

// Workaround for bugs in qingcloud package
global.querystring = querystring;

import Qingcloud from 'qingcloud';

import type {Backend, LB} from './types';

type SavedBackend = Backend & {
  loadbalancer_backend_id: string;
};

async function sleep(delay: number) {
  return new Promise(resolve => {
    setTimeout(() => resolve(), delay);
  });
}

const actions = {
  DescribeLoadBalancerBackends: {
    required: ['zone'],
    optional: ['loadbalancer_backends.n', 'loadbalancer_listener', 'loadbalancer', 'verbose', 'offset', 'limit']
  },
  AddLoadBalancerBackends: {
    required: ['zone', 'loadbalancer_listener', 'backends.n'],
    optional: []
  },
  DeleteLoadBalancerBackends: {
    required: ['zone', 'loadbalancer_backends.n'],
    optional: []
  },
  DescribeLoadBalancerListeners: {
    required: ['zone'],
    optional: ['loadbalancer_listeners.n', 'loadbalancer', 'verbose', 'offset', 'limit']
  },
  DescribeLoadBalancers: {
    required: ['zone'],
    optional: ['loadbalancers.n', 'status.n', 'search_word', 'tags.n', 'verbose', 'offset', 'limit']
  },
  UpdateLoadBalancers: {
    required: ['zone', 'loadbalancers.n'],
    optional: []
  },
  DescribeJobs: {
    required: ['zone'],
    optional: ['jobs.n', 'status.n', 'job_action', 'verbose', 'offset', 'limit']
  }
};

function equalBackend(backend1: Backend, backend2: Backend): boolean {
  return (
    backend1.resource_id === backend2.resource_id &&
    backend1.port === backend2.port
  );
}

export default class QingcloudAPI {
  api: Object;
  zone: string;

  constructor(zone: string, accessKey: string, secretKey: string) {
    this.zone = zone;
    this.api = new Qingcloud(accessKey, secretKey);
    Object.keys(actions).forEach(action => {
      this.api.initAction(action, actions[action]);
    });
  }

  request(method: string, payload: Object): Promise<Object> {
    const {api, zone} = this;
    payload = Object.assign({
      zone
    }, payload);
    return new Promise(function(resolve, reject) {
      api[method](payload, function(err, data) {
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(data);
        }
      });
    });
  }

  async addBackends(lbconfig: LB, backends: Array<Backend>): Promise<void> {
    if (!backends.length) {
      return;
    }
    await this.request('AddLoadBalancerBackends', {
      loadbalancer_listener: lbconfig.listener,
      backends: backends.map(b => Object.assign({}, b, {
        loadbalancer_policy_id: lbconfig.policy
      }))
    });
  }

  async removeBackends(lbconfig: LB, backends: Array<SavedBackend>): Promise<void> {
    if (!backends.length) {
      return;
    }
    await this.request('DeleteLoadBalancerBackends', {
      loadbalancer_backends: backends.map(b => b.loadbalancer_backend_id)
    });
  }

  async fetchBackends(lbconfig: LB): Promise<Array<SavedBackend>> {
    const response = await this.request('DescribeLoadBalancerBackends', {
      loadbalancer_listener: lbconfig.listener
    });

    return response.loadbalancer_backend_set.filter(
      backend => backend.loadbalancer_policy_id === lbconfig.policy);
  }

  async syncBackends(lbconfig: LB, newBackends: Array<Backend>): Promise<boolean> {
    const currBackends = await this.fetchBackends(lbconfig);

    const backendsToRemove = currBackends.filter(
      backend => !newBackends.some(equalBackend.bind(null, backend)));

    const backendsToAdd = newBackends.filter(
      backend => !currBackends.some(equalBackend.bind(null, backend)));

    console.log({
      backendsToAdd,
      backendsToRemove
    });

    const backendsChanged = !!(backendsToRemove.length || backendsToAdd.length);

    await Promise.all([
      this.addBackends(lbconfig, backendsToAdd),
      this.removeBackends(lbconfig, backendsToRemove)
    ]);

    return backendsChanged;
  }

  async updateLoadBalancers(listenerIDs: Array<string>): Promise<void> {
    if (!listenerIDs.length) {
      return;
    }

    const response = await this.request('DescribeLoadBalancerListeners', {
      loadbalancer_listeners: Array.from(new Set(listenerIDs))
    });

    const loadBalancerIDs = response.loadbalancer_listener_set.map(
      listener => listener.loadbalancer_id);

    const {job_id: jobID} = await this.request('UpdateLoadBalancers', {
      loadbalancers: Array.from(new Set(loadBalancerIDs))
    });

    return await this.waitForJob(jobID);
  }

  async waitForJob(jobID: string): Promise<void> {
    const response = await this.request('DescribeJobs', {
      jobs: [jobID]
    });

    const waitingForStatus = ['working', 'pending'];

    if (response.job_set.length > 0 && waitingForStatus.includes(response.job_set[0].status)) {
      await sleep(2000);
      await this.waitForJob(jobID);
    } else {
      console.log('job', jobID, response.job_set);
    }
  }

}
