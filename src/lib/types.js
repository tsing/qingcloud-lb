/* @flow */

export type LB = {
  listener: string;
  policy?: string;
}

export type Service = {
  instance: string;
  name: string;
  port: number;
}

export type ServiceMapping = {
  service: Service;
  lbs: Array<LB>;
};

export type Mappings = Array<ServiceMapping>;

export type CSphereCredential = {
  token: string;
  url: string;
}

export type QingcloudCredential = {
  zone: string;
  key: string;
  secret: string;
}

export type Backend = {
  resource_id: string;
  port: number;
  weight: number;
  loadbalancer_backend_name: string;
}

type ServiceLabels = {
  csphere_instancename: string;
  csphere_servicename: string;
  csphere_containerseq: string;
}

export type Container = {
  Id: string;
  node_id: string;
  Labels?: ?ServiceLabels;
}

export type ServiceContainer = Container & {
  Labels: ServiceLabels;
  Ports: Array<{
    IP: string;
    PrivatePort: number;
    PublicPort: number;
    Type: 'tcp' | 'udp'
  }>;
}

export type Node = {
  id: string;
  labels: {
    qingcloud: string;
  };
}
