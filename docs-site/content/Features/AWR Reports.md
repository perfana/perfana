---
aliases:
  - AWR
  - Oracle AWR
tags:
  - feature
  - data-science
---

# AWR Reports

Perfana supports Oracle Automatic Workload Repository (AWR) report analysis for database performance testing.

> [!info] Status
> This feature is specified and ready for implementation.

## Capabilities

1. **Upload & Parse** — Upload AWR reports (HTML/text) with automatic parsing
2. **Single Report Analysis** — Extract insights from individual AWR reports
3. **Baseline Comparison** — Compare AWR reports between test runs
4. **Actionable Insights** — Generate specific, actionable recommendations
5. **Root Cause Integration** — Display AWR analysis in test run detail view

## AWR Report Sections Parsed

| Section | Data Extracted |
|---|---|
| Report Header | DB info, host info, snapshot metadata |
| Load Profile | Per second/transaction metrics |
| Time Model Statistics | Time breakdown |
| Wait Events | Foreground/background waits |
| SQL Statistics | Ordered by elapsed time, CPU, I/O, gets, reads, executions |
| ADDM Findings | Automatic tuning recommendations |
| Top SQL with Top Events | SQL performance correlation |

## Architecture

### Design Principles
- **Strategy Pattern** for parsers (HTML parser, text parser)
- **Strategy Pattern** for analyzers
- **Service Layer** for business logic
- **Repository Pattern** for data access

### Module Structure
```
awr/
├── parsers/      # HTML/text report parsing
├── analyzers/    # Insight generation
├── services/     # Business logic
├── controllers/  # HTTP endpoints
└── dto/          # Data validation
```

### Implementation Phases
1. HTML parser with basic section extraction
2. Statistical analysis of load profile and wait events
3. SQL-level analysis and comparison
4. Baseline comparison between test runs
5. UI integration in Root Cause Analysis tab

## Frontend Integration

AWR analysis appears in the **Root Cause Analysis** tab of the test run detail page, alongside Dynatrace and tracing data.

## Related

- [[Integrations]] — Other data source integrations
- [[API Modules]] — AWR module in API
