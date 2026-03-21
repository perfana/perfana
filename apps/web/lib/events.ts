import { authenticatedFetch } from './api';

export type EventSource = 'manual' | 'grafana' | 'alertmanager';

export interface AlertMetadata {
  panelUrl?: string;
  generatorUrl?: string;
  ruleUrl?: string;
  dashboardUrl?: string;
  ruleId?: number;
  state?: string;
  status?: string;
  startsAt?: string;
  fingerprint?: string;
  evalMatches?: Array<{ value: number; metric: string }>;
}

export interface PerfanaEvent {
  id: string;
  title: string;
  description?: string;
  systemUnderTestId: string;
  testEnvironment: string;
  timestamp: string;
  source: EventSource;
  tags?: string[];
  alertMetadata?: AlertMetadata;
  grafanaAnnotationIds?: Record<string, number>;
  organizationId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  systemUnderTest?: {
    id: string;
    name: string;
  };
}

export interface CreateEventInput {
  title: string;
  description?: string;
  systemUnderTest: string;
  testEnvironment: string;
  timestamp: string;
  tags?: string[];
  organizationId?: string;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  timestamp?: string;
  tags?: string[];
}

export async function fetchEventsByTestRun(testRunId: string): Promise<PerfanaEvent[]> {
  const response = await authenticatedFetch(`events/by-test-run/${testRunId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchEvents(query?: {
  systemUnderTestId?: string;
  testEnvironment?: string;
  from?: string;
  to?: string;
}): Promise<PerfanaEvent[]> {
  const params = new URLSearchParams();
  if (query?.systemUnderTestId) params.set('systemUnderTestId', query.systemUnderTestId);
  if (query?.testEnvironment) params.set('testEnvironment', query.testEnvironment);
  if (query?.from) params.set('from', query.from);
  if (query?.to) params.set('to', query.to);

  const qs = params.toString();
  const response = await authenticatedFetch(`events${qs ? `?${qs}` : ''}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.statusText}`);
  }
  return response.json();
}

export async function createEvent(dto: CreateEventInput): Promise<PerfanaEvent> {
  const response = await authenticatedFetch('events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to create event: ${response.statusText}`);
  }
  return response.json();
}

export async function updateEvent(id: string, dto: UpdateEventInput): Promise<PerfanaEvent> {
  const response = await authenticatedFetch(`events/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to update event: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteEvent(id: string): Promise<void> {
  const response = await authenticatedFetch(`events/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete event: ${response.statusText}`);
  }
}
