---
aliases:
  - Perfana Report
  - Report Service
tags:
  - app/perfana-report
---

# Perfana Report Overview

The Perfana Report service generates PDF performance reports using Puppeteer headless browser rendering.

> [!info] Location
> `apps/perfana-report/` — Runs on port **3003**

## Architecture

- **Framework**: NestJS
- **PDF Engine**: Puppeteer (headless Chrome)
- **Job Queue**: BullMQ for async generation
- **ORM**: TypeORM (PostgreSQL)

## PDF Generation Flow

```
1. API enqueues report job ──▶ Redis (BullMQ)
2. PdfQueueProcessor picks up job
3. BrowserPoolService acquires browser instance
4. Create page, set HTML content with CSS
5. Generate PDF (A4/Letter, margins, headers/footers)
6. Store PDF (file path or blob)
7. Release browser back to pool
8. Update report status: COMPLETED
```

## Key Services

| Service | Purpose |
|---|---|
| `PdfService` | Core PDF generation from HTML |
| `BrowserPoolService` | Manages Puppeteer browser instance pool |
| `PdfQueueProcessor` | BullMQ job processor for async generation |

## Browser Pool

- **Pool size**: Configurable (default 3 instances)
- **Memory**: ~150-200MB per browser instance
- **Concurrency**: Limited by pool size
- **Health monitoring**: Tracks pool utilization

## Report Status Lifecycle

```
PENDING → PROCESSING → COMPLETED
                    → FAILED
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| Pool size | 3 | Number of browser instances |
| Concurrency | 2 | Concurrent PDF generation |
| Timeout | 90s | PDF generation timeout |
| Format | A4 | Page format |
| Print background | true | Include background colors |

## Database Entities

- `GeneratedReport` — Report metadata, status, HTML content, PDF storage

## Health Checks

- Browser pool health status
- Redis connection status
- Kubernetes readiness probe support

## Deployment Notes

> [!warning] Chrome Dependencies
> Puppeteer requires Chrome/Chromium system dependencies. The Docker image must include the necessary libraries for headless Chrome rendering.

## Related

- [[Architecture Overview]]
- [[Templates]] — Report templates
