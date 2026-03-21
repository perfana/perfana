# Perfana Next Generation

Modern performance analysis and observability platform built with TypeScript, NestJS, Next.js, and Supabase.

## Architecture

- **Database**: Supabase (PostgreSQL with real-time subscriptions + TimescaleDB)
- **Backend**: NestJS (TypeScript, decorators, dependency injection)
- **Frontend**: Next.js (React, App Router, Server Components)
- **Authentication**: Supabase Auth with Row Level Security
- **Monorepo**: Managed with Turborepo and npm workspaces

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm 8+
- Docker (for Supabase local development)
- Supabase CLI

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd perfana-next-gen
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

4. **Start Supabase locally**
   ```bash
   npm run supabase:start
   ```

5. **Apply database migrations**
   ```bash
   npm run db:push
   ```

6. **Generate TypeScript types**
   ```bash
   npm run db:generate
   ```

7. **Start development servers**
   ```bash
   npm run dev
   ```

The application will be available at:
- Frontend: http://localhost:3000
- API: http://localhost:3001
- API Documentation: http://localhost:3001/api/docs
- Supabase Studio: http://localhost:54323

## Project Structure

```
perfana-next-gen/
├── apps/
│   ├── api/                 # NestJS backend API
│   │   ├── src/
│   │   │   ├── modules/    # Feature modules
│   │   │   ├── common/     # Shared utilities
│   │   │   ├── guards/     # Auth guards
│   │   │   └── dto/        # Data transfer objects
│   │   └── test/           # E2E tests
│   └── web/                # Next.js frontend
│       ├── app/            # App Router pages
│       ├── components/     # React components
│       ├── lib/           # Utilities and hooks
│       └── types/         # TypeScript types
├── packages/
│   ├── shared/            # Shared types and utilities
│   ├── config/           # Shared configuration
│   └── database/         # Database utilities
└── supabase/
    ├── migrations/       # Database migrations
    ├── functions/        # Edge functions
    └── seed/            # Database seeding
```

## Development Commands

- `npm run dev` - Start all development servers
- `npm run build` - Build all applications
- `npm run test` - Run all tests
- `npm run lint` - Run linting
- `npm run type-check` - Run TypeScript checks
- `npm run clean` - Clean build artifacts

### Database Commands

- `npm run supabase:start` - Start local Supabase
- `npm run supabase:stop` - Stop local Supabase
- `npm run supabase:status` - Check Supabase status
- `npm run db:push` - Apply migrations
- `npm run db:reset` - Reset database
- `npm run db:generate` - Generate TypeScript types

## Key Features

### Performance Analysis
- **Automated regression detection** using ADAPT algorithm
- **Real-time test monitoring** during execution
- **Historical trend analysis** and benchmarking
- **Multi-source data integration** (Grafana, Dynatrace, InfluxDB, Prometheus)

### Enterprise Features
- **Multi-tenancy** with organizations and teams
- **Standardized templates** for checks, reports, and integrations
- **Role-based access control** via Supabase Auth
- **Collaborative analysis** with comments and annotations

### Data Science Capabilities
- **Statistical analysis** of performance metrics
- **Automated baseline management** and control groups
- **Change point detection** for performance regime shifts
- **Time-series data storage** optimized with TimescaleDB

## Database Schema

The application uses PostgreSQL with TimescaleDB for time-series data. Key entities:

### Core Entities
- **Organizations** - Multi-tenant isolation
- **Teams** - Access control and resource organization  
- **Applications** - Systems under test
- **Test Runs** - Individual performance test executions
- **Benchmarks** - Performance evaluation criteria

### Data Science Collections  
- **ds_queries** - Generic query definitions for all data sources
- **ds_metrics** - Time-series performance metrics (TimescaleDB hypertable)
- **ds_metric_statistics** - Aggregated statistical summaries
- **ds_adapt_results** - ADAPT algorithm analysis results

### Evaluation Results
- **check_results** - Absolute threshold compliance (SLO checks)
- **compare_results** - Relative baseline comparisons (regression detection)

## Authentication

Uses Supabase Auth with support for:
- Email/password authentication
- OAuth providers (Google, GitHub)
- JWT token-based API access
- Row Level Security for data isolation

## Contributing

1. Create a feature branch from `main`
2. Make your changes following the coding standards
3. Run tests: `npm run test`
4. Run linting: `npm run lint`  
5. Build the project: `npm run build`
6. Submit a pull request

## Environment Configuration

Key environment variables:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

# External Integrations
GRAFANA_URL=your-grafana-url
GRAFANA_API_KEY=your-grafana-key
DYNATRACE_URL=your-dynatrace-url
DYNATRACE_API_TOKEN=your-dynatrace-token
```

## Architecture Benefits

- **Type Safety**: Full TypeScript across frontend and backend
- **Real-time Capabilities**: Supabase real-time subscriptions
- **Scalability**: Serverless-ready with edge deployment support
- **Modern React**: Server Components, streaming, and hooks
- **Performance**: TimescaleDB for time-series data optimization
- **Developer Experience**: Hot reload, comprehensive tooling

## License

[License information]