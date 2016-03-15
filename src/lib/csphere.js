/* @flow */

import EventSource from 'eventsource';

import type {Service} from './types';

export default class CSphereAPI {
  endpoint: string;
  token: string;

  constructor(endpoint: string, token: string) {
    Object.assign(this, {
      endpoint,
      token
    });
  }

  async instance(name: string): Object {
    const response = await fetch(`${this.endpoint}/api/instances/${name}`, {
      type: 'GET',
      headers: {
        'Csphere-Api-Key': this.token
      }
    });
    return await response.json();
  }

  async serviceContainers(instance: string, service: string): Promise<Array<Object>> {
    const {endpoint, token} = this;
    const filter = JSON.stringify({
      labels: [
        `csphere_instancename=${instance}`,
        `csphere_servicename=${service}`
      ]
    });

    const response = await fetch(`${endpoint}/api/containers?filter=${encodeURIComponent(filter)}`, {
      method: 'GET',
      headers: {
        'Csphere-Api-Key': token
      }
    });
    return await response.json();
  }

  async container(containerID: string): Promise<?Object> {
    const {endpoint, token} = this;
    try {
      const response = await fetch(`${endpoint}/api/containers/${containerID}/json`, {
        method: 'GET',
        headers: {
          'Csphere-Api-Key': token
        }
      });
      if (response.ok) {
        return await response.json();
      }

      return null;
    } catch (err) {
      console.error(err.stack);
      return null;
    }
  }

  async nodes(nodeIDs: Array<string>): Promise<Array<Object>> {
    const {endpoint, token} = this;
    const promises = nodeIDs.map(async function(nodeID) {
      try {
        const response = await fetch(`${endpoint}/api/nodes/${nodeID}`, {
          method: 'GET',
          headers: {
            'Csphere-Api-Key': token
          }
        });
        return await response.json();
      } catch (err) {
        return null;
      }
    });
    const nodes = await Promise.all(promises);
    return nodes.filter(node => node);
  }

  containerListener(statusList: Array<string>): Object {
    const es = new EventSource(`${this.endpoint}/api/events?type=es`, {
      headers: {
        'Csphere-Api-Key': this.token
      }
    });
    let deferred;

    es.addEventListener('docker', ({data}) => {
      const payload = JSON.parse(data);
      if (statusList.includes(payload.status)) {
        if (deferred) {
          deferred.resolve(payload);
          deferred = null;
        }
      }
    });
    es.addEventListener('error', err => {
      if (deferred) {
        deferred.reject(err);
      }
    });

    return {
      [Symbol.iterator]() {
        return this;
      },

      next() {
        if (!deferred) {
          deferred = {};
          deferred.promise = new Promise((resolve, reject) => {
            // $FlowIssue
            deferred.resolve = resolve
            // $FlowIssue
            deferred.reject = reject;
          });
        }
        return {value: deferred.promise, done: false};
      }
    };
  }
}


export function isServiceContainer(container: Object, service: Service): boolean {
  const Labels = container.Labels || {};
  return (Labels.csphere_instancename === service.instance &&
          Labels.csphere_servicename === service.name);
}

export function exposedPort(container: Object, port: number): number {
  const config = container.Ports.find(c => c.PrivatePort === port);
  return config ? config.PublicPort : 0;
}
