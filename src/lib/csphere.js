/* @flow */

import EventSource from 'eventsource';

import { logger } from './utils';

import type { Container } from './types';

function matchObject(object: any, pattern: {}) {
  return Object.entries(pattern).every(([key, value]) => (key in object) && object[key] === value);
}

export default class CSphereAPI {
  endpoint: string;
  token: string;

  constructor(endpoint: string, token: string) {
    Object.assign(this, {
      endpoint,
      token,
    });
  }

  async serviceContainers(instance: string, service: string): Promise<Array<Container>> {
    const { endpoint, token } = this;
    const filter = JSON.stringify({
      labels: [
        `csphere_instancename=${instance}`,
        `csphere_servicename=${service}`,
      ],
    });

    try {
      const response = await fetch(`${endpoint}/api/containers?filter=${encodeURIComponent(filter)}`, {
        method: 'GET',
        headers: {
          'Csphere-Api-Key': token,
        },
      });
      if (response.ok) {
        return await response.json();
      }

      throw new Error(`Unexpected response ${response.status} ${response.statusText}`);
    } catch (err) {
      logger('fetch service container failed, %O', err);
      throw err;
    }
  }

  listenToEvents(patterns: Array<{}>) {
    let isClosed = false;
    let callback = null;
    const queue = [];
    const es = new EventSource(`${this.endpoint}/api/events?type=es`, {
      headers: {
        'Csphere-Api-Key': this.token,
      },
    });

    const conn = {
      close: () => {
        logger('EventSource closing');
        isClosed = true;
        es.close();
      },
    };

    const onMessage = (payload) => {
      if (callback) {
        callback(payload);
      } else {
        queue.push(payload);
      }
    };

    const setCallback = (func) => {
      callback = func;
    };

    es.addEventListener('open', () => {
      logger('EventSource connected');
    });

    es.addEventListener('message', ({ data }) => {
      const payload = JSON.parse(data);
      if (patterns.some(pattern => matchObject(payload, pattern))) {
        onMessage(payload);
      }
    });

    es.addEventListener('docker', ({ data }) => {
      const payload = JSON.parse(data);
      if (patterns.some(pattern => matchObject(payload, pattern))) {
        onMessage(payload);
      }
    });

    es.addEventListener('error', (err) => {
      logger('EventSource error, %O', err);
    });

    return [conn, async function* events(): any {
      while (!isClosed) {
        if (queue.length > 0) {
          const payload = queue.shift();
          yield Promise.resolve(payload);
        } else {
          yield await new Promise( // eslint-disable-line no-await-in-loop
            resolve => setCallback((payload) => {
              resolve(payload);
              setCallback(null);
            }));
        }
      }
    }];
  }
}
