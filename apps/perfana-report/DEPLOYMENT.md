# Perfana Report Service - Deployment Guide

This document provides instructions for deploying the Perfana Report PDF Generation Service to Kubernetes environments.

## Prerequisites

- Kubernetes cluster (1.19+)
- Helm 3.x
- FluxCD installed (for GitOps deployment)
- PostgreSQL database
- Redis instance
- Docker registry access

## Architecture Overview

The Perfana Report service is deployed as a Kubernetes Deployment with the following characteristics:

- **Service Type**: HTTP service on port 3003
- **Replicas**: 1-2 (configurable)
- **Resource Requirements**: 1-2 CPU, 2-4Gi memory
- **Dependencies**: PostgreSQL, Redis
- **Health Checks**: Liveness and readiness probes

## Deployment Methods

### Method 1: Helm Chart (Direct Deployment)

#### 1. Add Perfana Helm Repository

```bash
helm repo add perfana https://charts.perfana.io
helm repo update
```

#### 2. Create Values File

Create `perfana-report-values.yaml`:

```yaml
perfanaReport:
  enabled: true
  replicaCount: 2
  image:
    repository: perfana/perfana-report
    tag: perfana-4.0.0
    pullPolicy: Always
  service:
    type: ClusterIP
    port: 3003
    targetPort: http
  resources:
    limits:
      cpu: 2
      memory: 4Gi
    requests:
      cpu: 1
      memory: 2Gi
  env:
    NODE_ENV: production
    PORT: "3003"
    DB_HOST: postgresql.perfana.svc.cluster.local
    DB_PORT: "5432"
    DB_NAME: perfana
    DB_USERNAME: perfana
    REDIS_HOST: redis-master.perfana.svc.cluster.local
    REDIS_PORT: "6379"
    BROWSER_POOL_SIZE: "3"
    PDF_TIMEOUT_MS: "90000"
    QUEUE_CONCURRENCY: "2"
  extraEnvSecrets:
    DB_PASSWORD:
      name: postgresql-credentials
      key: PATRONI_SUPERUSER_PASSWORD
```

#### 3. Install Chart

```bash
helm install perfana perfana/perfana -f perfana-report-values.yaml -n perfana --create-namespace
```

#### 4. Verify Deployment

```bash
# Check pod status
kubectl get pods -n perfana -l app=perfana-report

# Check service
kubectl get svc -n perfana perfana-report

# Check health endpoints
kubectl port-forward -n perfana svc/perfana-report 3003:3003
curl http://localhost:3003/health/live
curl http://localhost:3003/health/ready
```

### Method 2: GitOps with FluxCD (Recommended)

The service is configured for GitOps deployment using FluxCD in the `perfana-gitops` repository.

#### Repository Structure

```
perfana-gitops/
├── apps/
│   └── perfana/
│       ├── base/
│       │   └── perfana/
│       │       ├── kustomization.yaml
│       │       └── release.yaml          # Base Helm release
│       └── demo/
│           └── perfana/
│               ├── kustomization.yaml
│               └── values.yaml           # Demo-specific values
```

#### Deployment Steps

1. **Update Image Tag** (in GitOps repo):

   Edit `apps/perfana/demo/perfana/values.yaml`:
   ```yaml
   perfanaReport:
     image:
       tag: sha-xxxxxxx  # Replace with actual SHA
   ```

2. **Commit and Push**:

   ```bash
   cd /path/to/perfana-gitops
   git add apps/perfana/demo/perfana/values.yaml
   git commit -m "Deploy perfana-report service"
   git push
   ```

3. **Verify FluxCD Sync**:

   ```bash
   # Check HelmRelease status
   kubectl get helmrelease -n perfana perfana

   # Check reconciliation
   flux get helmreleases -n perfana
   ```

4. **Monitor Deployment**:

   ```bash
   # Watch pod creation
   kubectl get pods -n perfana -l app=perfana-report -w

   # Check logs
   kubectl logs -n perfana -l app=perfana-report -f
   ```

## Configuration

### Environment Variables

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | HTTP port | `3003` |
| `DB_HOST` | PostgreSQL host | `postgresql.perfana.svc.cluster.local` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `perfana` |
| `DB_USERNAME` | Database username | `perfana` |
| `DB_PASSWORD` | Database password (secret) | From secret |
| `REDIS_HOST` | Redis host | `redis-master.perfana.svc.cluster.local` |
| `REDIS_PORT` | Redis port | `6379` |

#### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSER_POOL_SIZE` | Number of browsers | `3` |
| `PDF_TIMEOUT_MS` | PDF generation timeout | `90000` |
| `QUEUE_CONCURRENCY` | Concurrent jobs | `2` |
| `LOG_LEVEL` | Logging level | `info` |

### Resource Requirements

#### Production Recommendations

```yaml
resources:
  limits:
    cpu: 2
    memory: 4Gi
  requests:
    cpu: 1
    memory: 2Gi
```

#### Development/Demo

```yaml
resources:
  limits:
    cpu: 1
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 1Gi
```

### Health Checks

The service exposes two health check endpoints:

#### Liveness Probe

- **Endpoint**: `GET /health/live`
- **Purpose**: Check if the process is running
- **Configuration**:
  ```yaml
  livenessProbe:
    httpGet:
      path: /health/live
      port: 3003
    initialDelaySeconds: 60
    periodSeconds: 10
    failureThreshold: 8
  ```

#### Readiness Probe

- **Endpoint**: `GET /health/ready`
- **Purpose**: Check if ready to serve traffic
- **Checks**: Database, Redis, Browser Pool
- **Configuration**:
  ```yaml
  readinessProbe:
    httpGet:
      path: /health/ready
      port: 3003
    initialDelaySeconds: 30
    periodSeconds: 5
    failureThreshold: 3
  ```

## Scaling

### Horizontal Pod Autoscaling (HPA)

The service can be scaled horizontally based on CPU/memory or queue depth:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: perfana-report-hpa
  namespace: perfana
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: perfana-report
  minReplicas: 2
  maxReplicas: 5
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Manual Scaling

```bash
# Scale to 3 replicas
kubectl scale deployment perfana-report -n perfana --replicas=3
```

## Monitoring

### Key Metrics

Monitor these metrics for optimal performance:

- **Pod CPU/Memory**: Should stay below 80% of limits
- **Browser Pool**: Connected browsers count
- **Queue Depth**: BullMQ waiting jobs
- **Job Duration**: PDF generation time
- **Error Rate**: Failed jobs percentage

### Log Monitoring

```bash
# Follow logs
kubectl logs -n perfana -l app=perfana-report -f

# Search for errors
kubectl logs -n perfana -l app=perfana-report | grep ERROR

# Check specific pod
kubectl logs -n perfana perfana-report-<pod-id> -f
```

### Health Check Monitoring

```bash
# Check liveness
kubectl exec -n perfana perfana-report-<pod-id> -- curl http://localhost:3003/health/live

# Check readiness
kubectl exec -n perfana perfana-report-<pod-id> -- curl http://localhost:3003/health/ready
```

## Troubleshooting

### Common Issues

#### 1. Pod CrashLoopBackOff

**Symptoms**: Pods continuously restart

**Possible Causes**:
- Insufficient memory (browser crashes)
- Database connection failure
- Redis connection failure

**Solutions**:
```bash
# Check pod events
kubectl describe pod -n perfana perfana-report-<pod-id>

# Check logs
kubectl logs -n perfana perfana-report-<pod-id>

# Increase memory limits
# Edit values.yaml and redeploy
```

#### 2. Readiness Probe Failing

**Symptoms**: Pod not ready, no traffic routing

**Possible Causes**:
- Browser pool not initialized
- Database unreachable
- Redis unreachable

**Solutions**:
```bash
# Check health endpoint manually
kubectl exec -n perfana perfana-report-<pod-id> -- curl http://localhost:3003/health/ready

# Check database connectivity
kubectl exec -n perfana perfana-report-<pod-id> -- nc -zv postgresql.perfana.svc.cluster.local 5432

# Check Redis connectivity
kubectl exec -n perfana perfana-report-<pod-id> -- nc -zv redis-master.perfana.svc.cluster.local 6379
```

#### 3. PDF Generation Timeouts

**Symptoms**: Jobs fail with timeout errors

**Possible Causes**:
- Insufficient CPU/memory
- Too many concurrent jobs
- Complex HTML content

**Solutions**:
```bash
# Increase timeout
env:
  PDF_TIMEOUT_MS: "120000"  # 2 minutes

# Reduce concurrency
env:
  QUEUE_CONCURRENCY: "1"

# Increase resources
resources:
  limits:
    cpu: 2
    memory: 4Gi
```

#### 4. Browser Launch Failures

**Symptoms**: "Failed to launch browser" errors

**Possible Causes**:
- Missing Chromium dependencies
- Insufficient shared memory

**Solutions**:
```bash
# Verify browser args include:
# --no-sandbox
# --disable-setuid-sandbox
# --disable-dev-shm-usage
# --single-process

# Check pod logs for specific error
kubectl logs -n perfana perfana-report-<pod-id> | grep "browser"
```

### Debug Mode

Enable debug logging:

```yaml
env:
  LOG_LEVEL: debug
```

## Rollback

### Helm Rollback

```bash
# List releases
helm history perfana -n perfana

# Rollback to previous version
helm rollback perfana -n perfana

# Rollback to specific revision
helm rollback perfana 3 -n perfana
```

### GitOps Rollback

```bash
cd /path/to/perfana-gitops

# Revert commit
git revert HEAD

# Or reset to previous commit
git reset --hard <previous-commit-sha>

# Push changes
git push
```

## Upgrade

### Helm Upgrade

```bash
# Update values
vim perfana-report-values.yaml

# Upgrade release
helm upgrade perfana perfana/perfana -f perfana-report-values.yaml -n perfana
```

### GitOps Upgrade

1. Update image tag in `apps/perfana/demo/perfana/values.yaml`
2. Commit and push changes
3. FluxCD will automatically reconcile

## Security Considerations

### Secret Management

Store sensitive data in Kubernetes secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: perfana-report-secrets
  namespace: perfana
type: Opaque
stringData:
  DB_PASSWORD: <database-password>
```

Reference in deployment:

```yaml
extraEnvSecrets:
  DB_PASSWORD:
    name: perfana-report-secrets
    key: DB_PASSWORD
```

### Network Policies

Restrict network access:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: perfana-report-policy
  namespace: perfana
spec:
  podSelector:
    matchLabels:
      app: perfana-report
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: perfana-api
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

## Production Checklist

Before deploying to production:

- [ ] Database credentials stored in secrets
- [ ] Resource limits configured appropriately
- [ ] Health checks configured and tested
- [ ] Monitoring and alerting set up
- [ ] Backup and disaster recovery plan in place
- [ ] Network policies applied
- [ ] Pod security policies/standards enforced
- [ ] HPA configured for auto-scaling
- [ ] Load testing completed
- [ ] Rollback procedure tested

## Support

For issues or questions:

- Check logs: `kubectl logs -n perfana -l app=perfana-report`
- Review [README.md](./README.md) for service details
- Contact Perfana team
