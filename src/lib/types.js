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
