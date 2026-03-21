# Docker Security Implementation Guide

This document outlines the security-first approach implemented in the Perfana Docker setup, following industry best practices and security frameworks.

## 🔒 Security Features Overview

### Multi-Stage Build Security
- **Distroless Runtime Images**: Using Google's distroless base images eliminates shell access and reduces attack surface
- **Non-Root Execution**: All containers run as non-privileged users (UID 10001)
- **Minimal Attack Surface**: Only essential binaries and dependencies included in final images
- **Build-Time Security Scanning**: Automated vulnerability scanning during image build process

### Container Hardening
- **Read-Only Root Filesystem**: Prevents runtime modifications to the container filesystem
- **No New Privileges**: Prevents privilege escalation within containers
- **Dropped Capabilities**: Removes unnecessary Linux capabilities
- **Resource Limits**: CPU and memory limits prevent resource exhaustion attacks
- **Security Options**: AppArmor/SELinux profiles and seccomp filters

## 📋 Security Compliance

### Standards Adherence
- **CIS Docker Benchmark**: Level 1 compliance implemented
- **NIST 800-190**: Container security recommendations followed
- **OWASP Container Security**: Top 10 container security risks addressed

### Security Scanning Integration
- **Trivy**: Vulnerability scanning for OS packages and application dependencies
- **Docker Bench Security**: CIS benchmark compliance checking
- **SBOM Generation**: Software Bill of Materials for supply chain security

## 🚀 Quick Start

### Basic Usage

```bash
# Build the secure production image
docker build -t perfana-next-gen:latest .

# Run with security hardening
docker run -d \
  --name perfana-web \
  --security-opt no-new-privileges:true \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=100m \
  --user 10001:10001 \
  --cap-drop ALL \
  perfana-next-gen:latest
```

### Using Docker Compose (Recommended)

```bash
# Production deployment with security configurations
docker-compose -f docker-compose.security.yml up -d

# Development environment
docker-compose up -d --target development
```

### Security Scanning

```bash
# Run comprehensive security scan
./docker-security-scan.sh perfana-next-gen latest

# Build with security scanning
docker build -f Dockerfile.security -t perfana-next-gen:secure .
```

## 🏗️ Available Build Targets

### Production Targets
- **`web`** - Next.js frontend application
- **`api`** - NestJS backend API
- **`production`** - Default production target (API)

### Security Targets  
- **`security-scanner`** - Vulnerability scanning tools
- **`vulnerability-scan`** - Automated security scanning
- **`secure-runtime`** - Hardened runtime base
- **`security-monitor`** - Security monitoring dashboard

### Development Target
- **`development`** - Full development environment with tools

## 🔧 Configuration Options

### Environment Variables

#### Web Application
```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=http://api:3001/api
PORT=3000
NEXT_TELEMETRY_DISABLED=1
```

#### API Application  
```bash
NODE_ENV=production
PORT=3001
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-key
```

### Security Environment Variables
```bash
NODE_OPTIONS=--max-old-space-size=512 --no-warnings
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
```

## 🛡️ Security Best Practices Implemented

### Image Security
1. **Minimal Base Images**: Distroless images contain only essential runtime dependencies
2. **Layer Optimization**: Multi-stage builds minimize final image size and attack surface
3. **Dependency Verification**: npm audit integration catches vulnerable dependencies
4. **Regular Updates**: Automated base image updates with security patches

### Runtime Security
1. **Non-Root Execution**: All processes run as unprivileged user (UID 10001)
2. **Read-Only Filesystem**: Root filesystem mounted read-only with tmpfs for temporary files
3. **Capability Dropping**: All Linux capabilities dropped except essential ones
4. **Network Segmentation**: Isolated networks for frontend, backend, and internal communication

### Secrets Management
1. **Docker Secrets**: Production secrets managed via Docker Swarm secrets
2. **Environment Isolation**: Clear separation between development and production configs
3. **No Hardcoded Secrets**: All sensitive data externalized via environment variables or secrets

### Monitoring and Compliance
1. **Health Checks**: Comprehensive health monitoring for container orchestration
2. **Logging**: Structured logging without sensitive data exposure
3. **Audit Trail**: Container events and security violations logged
4. **Compliance Reports**: Automated CIS benchmark and security scanning reports

## 📊 Security Scanning Results

### Vulnerability Management
- **Automated Scanning**: Every build includes vulnerability scanning
- **Severity Filtering**: Critical and high severity issues block deployments
- **SBOM Generation**: Software Bill of Materials for supply chain transparency
- **Continuous Monitoring**: Runtime vulnerability monitoring

### Compliance Checking
- **CIS Docker Benchmark**: Automated compliance verification
- **Security Configuration**: Container security options validated
- **Best Practices**: Industry security standards implementation verified

## 🔧 Development Security

### Local Development
```bash
# Development with security scanning
docker build --target development -t perfana-dev .

# Run development container securely  
docker run -it --rm \
  --user perfana \
  --security-opt no-new-privileges:true \
  -v $(pwd):/app \
  -p 3000:3000 -p 3001:3001 \
  perfana-dev
```

### CI/CD Integration
```yaml
# Example GitHub Actions workflow
name: Security Scan
on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build image
        run: docker build -t perfana:${{ github.sha }} .
        
      - name: Security scan
        run: ./docker-security-scan.sh perfana ${{ github.sha }}
        
      - name: Upload security reports
        uses: actions/upload-artifact@v4
        with:
          name: security-reports
          path: security-reports/
```

## 🚨 Incident Response

### Security Alerts
1. **Vulnerability Detection**: Automated alerts for new vulnerabilities
2. **Configuration Drift**: Monitoring for security configuration changes
3. **Runtime Anomalies**: Detection of unusual container behavior

### Response Procedures
1. **Immediate**: Stop affected containers and isolate
2. **Assessment**: Analyze security reports and logs
3. **Remediation**: Apply patches and security updates
4. **Validation**: Re-scan and verify security posture

## 🔄 Maintenance and Updates

### Regular Security Tasks
- **Weekly**: Update base images and scan for vulnerabilities
- **Monthly**: Review security configurations and compliance
- **Quarterly**: Full security architecture review
- **As Needed**: Emergency security patches and updates

### Automated Security Pipeline
1. **Base Image Updates**: Dependabot for automated dependency updates
2. **Security Scanning**: Pre-commit hooks and CI/CD integration
3. **Compliance Monitoring**: Continuous compliance checking
4. **Incident Response**: Automated alerting and response procedures

## 📚 Additional Resources

### Security Documentation
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [NIST Container Security Guide](https://csrc.nist.gov/publications/detail/sp/800-190/final)
- [OWASP Container Security](https://owasp.org/www-project-container-security/)

### Tools and References
- [Trivy Security Scanner](https://trivy.dev/)
- [Docker Bench Security](https://github.com/docker/docker-bench-security)
- [Distroless Images](https://github.com/GoogleContainerTools/distroless)

## 🤝 Contributing to Security

### Reporting Security Issues
- **Private Disclosure**: Report security vulnerabilities privately
- **Security Review**: All security-related changes require review
- **Testing**: Security features must include appropriate tests
- **Documentation**: Update security documentation for changes

### Security Development Guidelines
1. **Threat Modeling**: Consider security implications of all changes
2. **Least Privilege**: Apply principle of least privilege
3. **Defense in Depth**: Implement multiple layers of security
4. **Security by Design**: Build security into the development process