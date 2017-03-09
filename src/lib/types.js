/* @flow */

export type QCNic = {
  nic_id: string;
  private_ip: string;
  instance_id: string;
}

export type QCBackend = {
  port: number;
  resource_id: string;
  loadbalancer_policy_id?: string;
  nic_id: string;
  loadbalancer_id?: string;
  loadbalancer_backend_name: string;
}

export type LB = {|
  listener: string;
  policy?: string;
|}

export type App = {|
  instance: string;
  service: string;
  port: number;
  weight?: number;
|}

export type Node = {
  id: string;
  ip: string;
}

export type Container = {
  node_id: string;
  Labels: {
    csphere_containerseq: string;
    'com.docker.network.container.ipv4': string;
  };
}

export type AppMapping = {|
  app: App;
  lbs: Array<LB>;
|}
