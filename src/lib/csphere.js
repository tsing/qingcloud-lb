/* @flow */

import EventSource from 'eventsource';

import type {Service, Container, ServiceContainer, Node} from './types';

export default class CSphereAPI {
  endpoint: string;
  token: string;

  constructor(endpoint: string, token: string) {
    Object.assign(this, {
      endpoint,
      token
    });
  }

  async serviceContainers(instance: string, service: string): Promise<Array<ServiceContainer>> {
    const {endpoint, token} = this;
    const filter = JSON.stringify({
      labels: [
        `csphere_instancename=${instance}`,
        `csphere_servicename=${service}`
      ]
    });

    try {
      const response = await fetch(`${endpoint}/api/containers?filter=${encodeURIComponent(filter)}`, {
        method: 'GET',
        headers: {
          'Csphere-Api-Key': token
        }
      });
      if (response.ok) {
        return await response.json();
      }

      throw new Error(`Unexpected response ${response.status} ${response.statusText}`);
    } catch (err) {
      console.error(err.stack);
      throw err;
    }
  }

  async container(containerID: string): Promise<?Container> {
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

      throw new Error(`Unexpected response ${response.status} ${response.statusText}`);
    } catch (err) {
      console.error(err.stack);
      throw err;
    }
  }

  async nodes(nodeIDs: Array<string>): Promise<Array<Node>> {
    const {endpoint, token} = this;
    const promises = nodeIDs.map(async function(nodeID): Promise<Node> {
      const response = await fetch(`${endpoint}/api/nodes/${nodeID}`, {
        method: 'GET',
        headers: {
          'Csphere-Api-Key': token
        }
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Unexpected response ${response.status} ${response.statusText}`);
    });
    return await Promise.all(promises);
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


export function isServiceContainer(container: Container|ServiceContainer, service: Service): boolean {
  const labels = container.Labels;
  if (!labels) {
    return false;
  }

  if (!labels.csphere_instancename) {
    return false;
  }

  if (!labels.csphere_servicename) {
    return false;
  }

  return (labels.csphere_instancename === service.instance &&
          labels.csphere_servicename === service.name);
}

export function exposedPort(container: ServiceContainer, port: number): number {
  const config = container.Ports.find(c => c.PrivatePort === port);
  return config ? config.PublicPort : 0;
}
