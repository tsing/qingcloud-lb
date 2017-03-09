/* @flow */

import fs from 'fs';

import Manager from './lib/manager';
import type { AppMapping } from './lib/types';
import * as utils from './lib/utils';
import CSphereAPI from './lib/csphere';
import QingcloudAPI from './lib/qingcloud';

const eventPatterns = [{
  action: 'instance_change_sum',
  status: 'deployed',
}, {
  action: 'instance_deploy',
  finished: true,
}, {
  action: 'instance_redeploy',
  finished: true,
}, {
  action: 'apply_new_revision_on_instance',
  finished: true,
}, {
  action: 'delete_instance',
}, {
  status: 'start',
}];

async function main() {
  const configFile = process.argv[2];
  if (!configFile) {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} <configFile>`); // eslint-disable-line no-console
    process.exit(1);
  }

  const mappings: Array<AppMapping> = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  utils.logger('mappings: %j', mappings);
  const csphere = new CSphereAPI(
    utils.readEnv('CONTROLLER_URL'),
    utils.readEnv('CONTROLLER_API_KEY'),
  );
  const qingcloud = new QingcloudAPI(
    utils.readEnv('QINGCLOUD_ZONE'),
    utils.readEnv('QINGCLOUD_KEY'),
    utils.readEnv('QINGCLOUD_SECRET'),
  );
  const manager = new Manager(csphere, qingcloud);

  async function syncAll() {
    await manager.waitForLB();
    const promises = mappings.map(({ app, lbs }) => manager.sync(app, lbs));
    await Promise.all(promises);
    process.nextTick(() => {
      manager.scheduleLbUpdate();
    });
  }
  await syncAll();
  utils.registerRunner(syncAll, 5 * 60);

  const [conn, stream] = csphere.listenToEvents(eventPatterns);
  utils.registerShutdown(() => conn.close());

  for await (const event of stream()) { // eslint-disable-line semi
    utils.logger('event %o', event);
    await manager.waitForLB();

    const { instance, service } = event;
    const promises = mappings.filter(mapping => (
      mapping.app.instance === instance &&
      mapping.app.service === service
    )).map(async (mapping) => {
      await manager.sync(mapping.app, mapping.lbs);
    });

    await Promise.all(promises);
    process.nextTick(() => {
      manager.scheduleLbUpdate();
    });
  }
}

main().catch((err) => {
  console.error(err.stack); // eslint-disable-line no-console
  process.exit(1);
});
