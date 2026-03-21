# CLAUDE.md - New Stack Refactor

This is the CLAUDE.md file for the Perfana Frontend refactor to modern stack.

## Project Overview

**Perfana** performance analysis and observability tool - refactored to modern stack with improved scalability, type safety, and developer experience.

## New Technology Stack

- **Database**: Supabase (PostgreSQL with real-time subscriptions)
- **Backend**: NestJS (TypeScript, decorators, dependency injection)
- **Frontend**: Next.js (React, SSR/SSG, App Router)
- **Authentication**: Supabase Auth (JWT, social providers, RLS)
- **Runtime**: Node.js (v18+)
- **Language**: TypeScript throughout

## Architecture Benefits

- **Type Safety**: Full TypeScript across frontend and backend
- **Modern React**: Hooks, Server Components, streaming
- **Real-time**: Supabase real-time subscriptions for live updates
- **Scalability**: Serverless-ready with edge deployment support
- **Developer Experience**: Hot reload, better debugging, modern tooling

## Key Dependencies (Planned)

### Backend (NestJS)
- `@nestjs/core`: Core framework
- `@nestjs/common`: Common utilities and decorators
- `@nestjs/config`: Configuration management
- `@supabase/supabase-js`: Supabase client
- `@nestjs/passport`: Authentication middleware
- `@nestjs/swagger`: API documentation
- `class-validator`: Request validation
- `prisma`: Database ORM (optional, for complex queries)

### Frontend (Next.js)
- `next`: React framework
- `react`: UI library
- `@supabase/supabase-js`: Supabase client
- `@supabase/auth-helpers-nextjs`: Auth integration
- `@tanstack/react-query`: Data fetching and caching
- `recharts` or `plotly.js`: Data visualization
- `tailwindcss`: Styling framework
- `zod`: Schema validation

## Project Structure (Planned)

```
perfana-new/
├── apps/
│   ├── web/                 # Next.js frontend
│   │   ├── app/            # App Router pages
│   │   ├── components/     # React components
│   │   ├── lib/           # Utilities and hooks
│   │   └── types/         # TypeScript types
│   └── api/                # NestJS backend
│       ├── src/
│       │   ├── modules/   # Feature modules
│       │   ├── common/    # Shared utilities
│       │   ├── guards/    # Auth guards
│       │   └── dto/       # Data transfer objects
│       └── test/          # E2E tests
├── packages/
│   ├── shared/            # Shared types and utilities
│   └── config/           # Shared configuration
└── supabase/
    ├── migrations/        # Database migrations
    ├── functions/         # Edge functions
    └── seed/             # Database seeding
```

## Development Commands (Planned)

- **Install dependencies**: `npm install`
- **Start development**: `npm run dev`
- **Build production**: `npm run build`
- **Run tests**: `npm run test`
- **Type check**: `npm run type-check`
- **Lint**: `npm run lint`
- **Database migrations**: `supabase db push`

## Migration Strategy

### Phase 1: Database Migration
- Set up Supabase project
- Design PostgreSQL schema
- Migrate MongoDB data to PostgreSQL
- Set up Row Level Security (RLS) policies

### Phase 2: Backend Migration
- Create NestJS application structure
- Implement authentication with Supabase Auth
- Port API methods to NestJS controllers/services
- Add validation and error handling

### Phase 3: Frontend Migration
- Set up Next.js application
- Create React components from Blaze templates
- Implement client-side authentication
- Port UI functionality and styling

### Phase 4: Integration Testing
- End-to-end testing
- Performance testing
- Security audit
- Documentation updates

## Key Features to Preserve

- **Automated performance regression detection**
- **Integration with distributed tracing and profiling tools**
- **AI-powered root cause analysis**
- **Flexible integrations with test frameworks**
- **Real-time test monitoring**
- **Multi-format data export**

## Integration Points (Updated)

- **Grafana**: Dashboard and metrics visualization
- **Dynatrace**: APM integration via DQL queries
- **InfluxDB**: Time-series metrics storage
- **Performance Testing Tools**: Gatling, JMeter, k6 support
- **Tracing**: Tempo, Jaeger integration
- **Profiling**: Pyroscope integration
- **Real-time Updates**: Supabase real-time subscriptions

## Authentication (New Approach)

Supabase Auth provides:
- JWT token-based authentication
- Social provider integration (Google, GitHub, etc.)
- Row Level Security for data access control
- User management and profile handling
- Multi-factor authentication support

## Database Schema (Supabase/PostgreSQL)

Key tables to migrate:

### Core Collections
- `organizations` (from organisations)
- `teams`
- `users`
- `applications`
- `profiles`
- `versions`
- `configuration`
- `api_keys` (from apiKeys)

### Test Management
- `test_runs` (from testruns)
- `test_run_configs` (from testrunConfigs)
- `benchmarks`
- `check_results` (from checkResults)
- `compare_results` (from compareResults)
- `comments`
- `alerts`

### Dashboard & Reporting
- `grafana_dashboards` (from grafanaDashboards)
- `grafana_dashboard_templating_values` (from grafanaDashboardTemplatingValues)
- `grafanas`
- `application_dashboards` (from applicationDashboards)
- `profile_grafana_dashboards` (from autoConfigGrafanaDashboards)
- `report_panels` (from reportPanels)
- `report_requirements` (from reportRequirements)
- `generic_report_panels` (from genericReportPanels)
- `snapshots`

### Data Science & Analytics
- `ds_adapt_conclusion` (from dsAdaptConclusion)
- `ds_adapt_results` (from dsAdaptResults)
- `ds_adapt_tracked_results` (from dsAdaptTrackedResults)
- `ds_change_points` (from dsChangePoints)
- `ds_compare_config` (from dsCompareConfig)
- `ds_compare_statistics` (from dsCompareStatistics)
- `ds_control_group_statistics` (from dsControlGroupStatistics)
- `ds_control_groups` (from dsControlGroups)
- `ds_metric_statistics` (from dsMetricStatistics)
- `ds_metrics` (from dsMetrics)
- `ds_panels` (from dsPanels)
- `ds_tracked_differences` (from dsTrackedDifferences)
- `pending_ds_compare_config_changes` (from pendingDsCompareConfigChanges)

### Integrations
- `dynatrace`
- `dynatrace_query` (from dynatraceQuery)
- `deeplinks`
- `generic_deeplinks` (from genericDeeplinks)
- `generic_checks` (from genericChecks)

### Notifications & Alerts
- `notifications`
- `notification_channels` (from notificationChannels)
- `abort_alert_tags` (from abortAlertTags)
- `omit_alert_tags` (from omitAlertTags)

### Metrics & Classification
- `metric_classification` (from metricClassification)
- `golden_path_metric_classification` (from goldePathMetricClassification)

### System & Maintenance
- `batch_process_events` (from batchProcessEvents)
- `licenses`

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# NestJS
DATABASE_URL=your-supabase-db-url
JWT_SECRET=your-jwt-secret
PORT=3001

# Integrations
GRAFANA_URL=your-grafana-url
GRAFANA_API_KEY=your-grafana-key
DYNATRACE_URL=your-dynatrace-url
DYNATRACE_API_TOKEN=your-dynatrace-token
```

## Performance Considerations

- **Next.js SSR/SSG**: Improved initial load times
- **React Query**: Efficient data caching and synchronization
- **Supabase Edge Functions**: Low-latency API responses
- **PostgreSQL**: Better performance for complex queries
- **Real-time subscriptions**: Efficient live updates without polling