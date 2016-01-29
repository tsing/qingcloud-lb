/* @flow */

import fetch from 'node-fetch';
import EventSource from 'eventsource';

export type ServiceConfig = {
  instance: string;
  service: string;
  port: number;
}

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

  async containers(containerIDs: Array<string>): Promise<Array<Object>> {
    const {endpoint, token} = this;
    const promises = containerIDs.map(async function(containerID) {
      try {
        const response = await fetch(`${endpoint}/api/containers/${containerID}/json`, {
          method: 'GET',
          headers: {
            'Csphere-Api-Key': token
          }
        });
        return await response.json();
      } catch (err) {
        console.error(err.stack);
        return null;
      }
    });
    const containers = await Promise.all(promises);
    return containers.filter(c => c);
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


export function isContainerRunning(container: Object): boolean {
  return container.info.State.Running === true;
}

export function containerHostPort(container: Object, port: number): number {
  const hostPort = container.info.NetworkSettings.Ports[`${port}/tcp`][0].HostPort;
  return parseInt(hostPort, 10);
}

export function isServiceContainer(container: Object, serviceConfig: ServiceConfig): boolean {
  const Labels = container.Labels || {};
  return (Labels.csphere_instancename === serviceConfig.instance &&
          Labels.csphere_servicename === serviceConfig.service);
}
