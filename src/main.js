/* @flow */

import 'isomorphic-fetch';
import fs from 'fs';

import Manager from './lib/manager';
import type {Service, LB, Mappings, CSphereCredential, QingcloudCredential} from './lib/types';
import {sleep} from './lib/utils';

async function main() {
  const config = process.argv[2];
  if (!config) {
    console.error(`Usage: ${process.argv[0]} ${process.argv[1]} <config>`);
    process.exit(1);
  }

  const {
    csphere,
    qingcloud,
    mappings
  } = JSON.parse(fs.readFileSync(config, 'utf-8'));

  (csphere: CSphereCredential);
  (qingcloud: QingcloudCredential);
  (mappings: Mappings);

  const manager = new Manager(csphere, qingcloud);
  await sleep(1000);

  for (const {service, lbs} of mappings) {
    await manager.sync(service, lbs);
  }

  await manager.listenToEvents(mappings);
}

main().catch(err => {
  console.error(err.stack);
  process.exit(1);
});
