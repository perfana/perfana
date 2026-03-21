# PDF Download Flow - Production Architecture

## Overview

In production, PDF downloads follow a **two-tier architecture** where the `perfana-api` service handles all external traffic and the `perfana-report` service handles the resource-intensive PDF generation internally.

## Access Path

### External URL (User-Facing)

```
https://api.${CLUSTER_URL}/api/reports/{reportId}/pdf/download
```

**Example**:
```
https://api.demo.perfana.io/api/reports/123e4567-e89b-12d3-a456-426614174000/pdf/download
```

### Network Flow

```
┌─────────────┐
│   Browser   │
│   / Client  │
└──────┬──────┘
       │ HTTPS
       │ GET /api/reports/{reportId}/pdf/download
       │ Authorization: Bearer {token}
       ▼
┌─────────────────────────────────────────┐
│   Nginx Ingress Controller             │
│   (api.${CLUSTER_URL})                  │
└──────┬──────────────────────────────────┘
       │ HTTP (internal)
       │ TLS Termination
       ▼
┌─────────────────────────────────────────┐
│   perfana-api Service                   │
│   (ClusterIP on port 3001)              │
│   - Validates authentication            │
│   - Checks report exists                │
│   - Decides: Queue or Stream            │
└──────┬──────────────────────────────────┘
       │
       ├─ Option A: PDF Already Generated
       │  └─> Stream PDF from memory
       │
       └─ Option B: PDF Not Generated
          │
          ├─> Queue job to BullMQ
          │   (perfana-report-pdf-generation)
          │
          └─> Wait/Poll or Return 202 Accepted
              │
              ▼
       ┌────────────────────────────────┐
       │   Redis (BullMQ Queue)         │
       └────────┬───────────────────────┘
                │
                ▼
       ┌────────────────────────────────┐
       │   perfana-report Service       │
       │   (ClusterIP on port 3003)     │
       │   - Consumes queue             │
       │   - Launches Chromium          │
       │   - Generates PDF              │
       │   - Updates DB metadata        │
       └────────┬───────────────────────┘
                │
                ▼
       ┌────────────────────────────────┐
       │   PostgreSQL Database          │
       │   - Stores report HTML         │
       │   - Stores PDF metadata        │
       │   - Status tracking            │
       └────────────────────────────────┘
```

## Detailed Flow

### Current Implementation (API-Only)

**Endpoint**: `GET /api/reports/{reportId}/pdf/download`

**Flow**:
1. User requests PDF download
2. API validates authentication (Keycloak JWT or API Key)
3. API fetches report from database
4. API launches Puppeteer **in-process**
5. API generates PDF from HTML
6. API streams PDF to client
7. API updates report status to `pdf_complete`

**Issues with Current Approach**:
- ❌ Resource-intensive (each download launches Chromium)
- ❌ Blocks API server threads
- ❌ No horizontal scaling for PDF generation
- ❌ Memory spikes during concurrent downloads
- ❌ Timeout issues for large reports

### New Implementation (With perfana-report)

**Endpoint**: Same - `GET /api/reports/{reportId}/pdf/download`

**Flow**:

#### Scenario 1: PDF Already Generated

```
User Request → API → Check DB status
                ↓
        status = 'pdf_complete'
                ↓
    Generate PDF from HTML (fast)
                ↓
        Stream to client
```

**Response Time**: ~1-3 seconds

#### Scenario 2: PDF Never Generated

```
User Request → API → Check DB status
                ↓
        status = 'html_complete'
                ↓
        Queue job to BullMQ
                ↓
    Return 202 Accepted with job_id
                ↓
    Client polls: GET /api/reports/{reportId}/status
                ↓
        perfana-report consumes job
                ↓
        Generates PDF (background)
                ↓
        Updates status to 'pdf_complete'
                ↓
    Client gets PDF when ready
```

**Response Time**: ~5-30 seconds (first time)

#### Scenario 3: On-Demand Generation (Alternative)

```
User Request → API → Check DB status
                ↓
        status = 'html_complete'
                ↓
        Queue HIGH PRIORITY job
                ↓
    Wait for completion (async)
                ↓
        perfana-report processes
                ↓
    Stream PDF when ready
```

**Response Time**: ~10-60 seconds

## API Endpoints

### Download PDF

```http
GET /api/reports/{reportId}/pdf/download
Authorization: Bearer {token}
```

**Success Response (200)**:
```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="performance_report_2024_01.pdf"
Content-Length: 1234567

[PDF binary data]
```

**Accepted Response (202)** - If async generation:
```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "message": "PDF generation queued",
  "reportId": "123e4567-e89b-12d3-a456-426614174000",
  "jobId": "pdf-gen-123e4567-1706789012",
  "status": "pdf_processing",
  "estimatedTime": 30,
  "pollUrl": "/api/reports/123e4567-e89b-12d3-a456-426614174000/status"
}
```

### Check Status

```http
GET /api/reports/{reportId}/status
Authorization: Bearer {token}
```

**Response**:
```json
{
  "reportId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pdf_complete",
  "fileSize": 1234567,
  "downloadUrl": "/api/reports/123e4567-e89b-12d3-a456-426614174000/pdf/download",
  "createdAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:45Z"
}
```

## Production URLs

### Demo Environment

- **API**: `https://api.demo.perfana.io`
- **Download**: `https://api.demo.perfana.io/api/reports/{reportId}/pdf/download`
- **Status**: `https://api.demo.perfana.io/api/reports/{reportId}/status`

### Production Environment

- **API**: `https://api.perfana.io`
- **Download**: `https://api.perfana.io/api/reports/{reportId}/pdf/download`
- **Status**: `https://api.perfana.io/api/reports/{reportId}/status`

## Service Exposure

### perfana-api (External)

```yaml
Service Type: ClusterIP
Port: 3001
Ingress: Enabled
  Host: api.${CLUSTER_URL}
  Path: /
  TLS: Enabled (Let's Encrypt)
```

**Exposed to**: Internet (with authentication)

### perfana-report (Internal Only)

```yaml
Service Type: ClusterIP
Port: 3003
Ingress: NOT Enabled
```

**Exposed to**: Kubernetes cluster only

**Access**:
- Not directly accessible from internet
- Only accessible via service name: `perfana-report.perfana.svc.cluster.local:3003`
- Used by: Internal monitoring, health checks

## Authentication

All PDF downloads require authentication:

### Option 1: Keycloak JWT

```bash
curl -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  https://api.demo.perfana.io/api/reports/{reportId}/pdf/download \
  -o report.pdf
```

### Option 2: API Key

```bash
curl -H "Authorization: Bearer cGVyZm9ybWFuY2VfdGVzdDo5YTJiNGM2ZC0zZTFmLTRhNWItOGM3ZC0xMjM0NTY3ODkwYWI=" \
  https://api.demo.perfana.io/api/reports/{reportId}/pdf/download \
  -o report.pdf
```

## Performance Characteristics

### Current Implementation (API-Only)

| Metric | Value |
|--------|-------|
| First Download | 10-30s |
| Subsequent Downloads | 10-30s (regenerates each time) |
| Concurrent Capacity | ~2-3 PDFs |
| Memory per PDF | ~500MB-1GB |
| CPU per PDF | 1-2 cores |

### New Implementation (With perfana-report)

| Metric | Value |
|--------|-------|
| First Download | 10-60s (background) |
| Subsequent Downloads | 1-3s (from cache) |
| Concurrent Capacity | 10-20 PDFs (2 replicas × 2 concurrency) |
| Memory per PDF | Isolated to perfana-report pods |
| CPU per PDF | Isolated to perfana-report pods |

## Scaling Strategy

### Horizontal Pod Autoscaling (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: perfana-report-hpa
spec:
  scaleTargetRef:
    name: perfana-report
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      targetAverageUtilization: 70
  - type: Resource
    resource:
      name: memory
      targetAverageUtilization: 80
```

**Scaling Triggers**:
- High CPU usage (Chromium rendering)
- High memory usage (browser pool)
- Queue depth (via custom metrics)

## Monitoring

### Key Metrics

**API Service**:
- `http_requests_total{endpoint="/api/reports/:reportId/pdf/download"}`
- `http_request_duration_seconds{endpoint="/api/reports/:reportId/pdf/download"}`
- `pdf_download_requests_total`
- `pdf_cache_hits_total`

**perfana-report Service**:
- `pdf_generation_jobs_total`
- `pdf_generation_duration_seconds`
- `pdf_generation_errors_total`
- `browser_pool_browsers_available`
- `browser_pool_browsers_in_use`
- `queue_depth{queue="perfana-report-pdf-generation"}`

### Health Checks

**API Service**:
```bash
curl https://api.demo.perfana.io/api/health
```

**perfana-report Service** (internal only):
```bash
kubectl exec -n perfana perfana-report-xxx -- \
  curl http://localhost:3003/health/ready
```

## Security

### Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: perfana-report-netpol
spec:
  podSelector:
    matchLabels:
      app: perfana-report
  policyTypes:
  - Ingress
  - Egress
  ingress:
  # No ingress - not exposed externally
  - from:
    - podSelector:
        matchLabels:
          app: perfana-api  # Only API can access (for health checks)
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgresql
  - to:
    - podSelector:
        matchLabels:
          app: redis
```

### RBAC

perfana-report service runs with minimal permissions:
- Read/Write to database
- Read/Write to Redis queue
- No external network access (except DNS)
- No access to Kubernetes API

## Migration Path

### Phase 1: Parallel Operation (Current)

- API handles all PDF downloads in-process
- perfana-report service deployed but not used
- Testing and validation

### Phase 2: Gradual Migration

- API checks feature flag: `PDF_SERVICE_ENABLED`
- If enabled, queue job to perfana-report
- If disabled, generate in-process (fallback)

### Phase 3: Full Migration

- All PDF generation via perfana-report
- Remove Puppeteer from API dependencies
- API only streams pre-generated PDFs

## Troubleshooting

### PDF Download Fails

**Check**:
1. Report exists: `GET /api/reports/{reportId}`
2. Report has HTML: Check `html_content` field
3. Authentication valid: Check 401/403 errors
4. Service health: `GET /api/health`

### PDF Generation Stuck

**Check**:
1. Queue status: `kubectl logs -n perfana -l app=perfana-report`
2. Redis connectivity: Health check
3. Database connectivity: Health check
4. Browser pool: Health endpoint shows connected browsers

### Slow PDF Generation

**Check**:
1. Queue depth: Too many jobs queued
2. Resource limits: CPU/Memory throttling
3. Pod count: Need to scale horizontally
4. Report size: Large HTML content

## Summary

**Production PDF Download Path**:
```
https://api.${CLUSTER_URL}/api/reports/{reportId}/pdf/download
```

**Key Points**:
- ✅ All downloads go through `perfana-api` (port 3001)
- ✅ `perfana-report` is internal only (port 3003)
- ✅ Authentication required (Keycloak JWT or API Key)
- ✅ PDFs generated asynchronously via BullMQ
- ✅ First download: 10-60s, subsequent: 1-3s
- ✅ Horizontal scaling supported
- ✅ TLS encryption (Let's Encrypt)
- ✅ No direct internet access to perfana-report

**User Experience**:
Users interact only with the API service through the standard HTTPS endpoint. The internal perfana-report service is completely transparent to end users.
