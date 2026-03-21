# Alerts

Receive alerts from Grafana/Alertmanager; manage alert tag filters.

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | /webhooks/alerts/grafana | Receive Grafana alerts |
| POST | /webhooks/alerts/alertmanager | Receive Alertmanager alerts |
| GET | /alert-tag-filters | List alert tag filters |
| POST | /alert-tag-filters | Create filter |
| DELETE | /alert-tag-filters/:id | Delete filter |
