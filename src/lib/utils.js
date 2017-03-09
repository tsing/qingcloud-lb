/* @flow */

import debug from 'debug';

export async function sleep(delay: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), delay);
  });
}

export function invariant(flag: boolean, errorMessage: string) {
  if (flag) {
    return;
  }

  throw new Error(errorMessage);
}

export function readEnv(name: string): string {
  invariant((name in process.env), `Env ${name} not defined`);
  invariant(process.env[name], `Env ${name} is empty`);

  return process.env[name];
}

export function registerShutdown(func: Function) {
  process.on('SIGTERM', func);
  process.on('SIGINT', func);
}

export function registerRunner(func: Function, intervalSeconds: number): void {
  const interval = setInterval(func, intervalSeconds * 1000);
  registerShutdown(() => clearInterval(interval));
}

export const logger = debug('qingcloud-lb');
