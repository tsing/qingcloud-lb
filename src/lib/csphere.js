/* @flow */

import EventSource from 'eventsource';
import Observable from 'zen-observable';

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

      if (response.status === 404) {
        return null;
      }

      const text = await response.text();
      if (text.includes('Not found')) {
        // csphere bug
        return null;
      }
      throw new Error(`Unexpected response ${response.status} ${response.statusText} ${text}`);
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

  listen(events: Array<string>, lastEventID?: ?number): Observable {
    return new Observable(observer => {
      const es = new EventSource(`${this.endpoint}/api/events?type=es`, {
        headers: {
          'Csphere-Api-Key': this.token,
          'Last-Event-ID': lastEventID
        }
      });

      es.addEventListener('open', () => {
        console.log('Eventsource opened');
      });

      es.addEventListener('message', ({lastEventId: id}) => {
        lastEventID = id;
      });

      es.addEventListener('docker', ({data, lastEventId: id}) => {
        lastEventID = id;

        const payload = JSON.parse(data);
        if (events.includes(payload.status)) {
          observer.next(payload);
        }
      });

      es.addEventListener('error', err => {
        console.error(err.stack);
        es.close();
        console.log('Eventsource closed');
        observer.complete(lastEventID);
      });

      return () => {
        es.close();
      }
    });
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
