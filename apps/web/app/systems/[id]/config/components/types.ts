export type { ApplicationDashboard } from '@/lib/types';

export type { Benchmark } from '@/lib/types';

export interface System {
  id: string;
  name: string;
  environments: Array<{
    environment: string;
    workloads: string[];
  }>;
}

export interface GrafanaDashboard {
  id: string;
  grafana_instance_id: string;
  grafana_id: number;
  uid: string;
  name: string;
  uri: string;
  datasource_type: string;
  tags: string[];
  panels?: unknown[];
  templating_variables?: Array<{
    name: string;
    type: string;
    query?: string | { query: string };
  }>;
}

export interface VariableValue {
  name: string;
  values: string[];
}