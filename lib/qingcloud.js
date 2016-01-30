/* @flow */

import querystring from 'querystring';

// Workaround for bugs in qingcloud package
global.querystring = querystring;

import Qingcloud from 'qingcloud';

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
  UpdateLoadBalancers: {
    required: ['zone', 'loadbalancers.n'],
    optional: []
  }
};

export type LBConfig = {
  listenerID: string;
  policyID: string;
};

export type Backend = {
  resource_id: string;
  port: number;
  loadbalancer_policy_id?: string;
  loadbalancer_backend_id?: string;
  weight?: number;
  loadbalancer_backend_name?: string;
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

  async addBackends(lbconfig: LBConfig, backends: Array<Backend>): Promise<void> {
    if (!backends.length) {
      return;
    }
    await this.request('AddLoadBalancerBackends', {
      loadbalancer_listener: lbconfig.listenerID,
      backends: backends.map(b => Object.assign(b, {
        loadbalancer_policy_id: lbconfig.policyID
      }))
    });
  }

  async removeBackends(lbconfig: LBConfig, backends: Array<Backend>): Promise<void> {
    if (!backends.length) {
      return;
    }
    await this.request('DeleteLoadBalancerBackends', {
      loadbalancer_backends: backends.map(b => b.loadbalancer_backend_id)
    });
  }

  async fetchBackends(lbconfig: LBConfig): Promise<Array<Object>> {
    const response = await this.request('DescribeLoadBalancerBackends', {
      loadbalancer_listener: lbconfig.listenerID
    });

    return response.loadbalancer_backend_set.filter(
      backend => backend.loadbalancer_policy_id === lbconfig.policyID);
  }

  async syncBackends(lbconfig: LBConfig, newBackends: Array<Backend>): Promise<boolean> {
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

  async updateLoadBalancers(lbConfigs: Array<LBConfig>): Promise<void> {
    const response = await this.request('DescribeLoadBalancerListeners', {
      loadbalancer_listeners: lbConfigs.map(lbconfig => lbconfig.listenerID)
    });

    const loadBalancerIDs = response.loadbalancer_listener_set.map(
      listener => listener.loadbalancer_id);

    await this.request('UpdateLoadBalancers', {
      loadbalancers: loadBalancerIDs
    });
  }
}
