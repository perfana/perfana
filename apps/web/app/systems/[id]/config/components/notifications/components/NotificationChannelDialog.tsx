'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';
import {
  NotificationChannelFormData,
  ChannelType,
  DialogMode,
  getWebhookPlaceholder,
  getWebhookHelperText,
} from '../types';

interface NotificationChannelDialogProps {
  open: boolean;
  mode: DialogMode;
  formData: NotificationChannelFormData;
  saving: boolean;
  onFormChange: (data: NotificationChannelFormData) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function NotificationChannelDialog({
  open,
  mode,
  formData,
  saving,
  onFormChange,
  onClose,
  onSubmit,
}: NotificationChannelDialogProps) {
  const isValid = formData.name.trim() !== '' && formData.webhookUrl.trim() !== '';
  const title = mode === 'add' ? 'Add Notification Channel' : 'Edit Notification Channel';
  const submitLabel = mode === 'add' ? 'Add Channel' : 'Save Changes';

  const handleTypeChange = (type: ChannelType) => {
    onFormChange({ ...formData, type });
  };

  const handleNameChange = (name: string) => {
    onFormChange({ ...formData, name });
  };

  const handleWebhookUrlChange = (webhookUrl: string) => {
    onFormChange({ ...formData, webhookUrl });
  };

  const handleEnabledChange = (enabled: boolean) => {
    onFormChange({ ...formData, enabled });
  };

  const handleNotifyOnFailedOnlyChange = (notifyOnFailedOnly: boolean) => {
    onFormChange({ ...formData, notifyOnFailedOnly });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel>Channel Type</InputLabel>
            <Select
              value={formData.type}
              label="Channel Type"
              onChange={(e) => handleTypeChange(e.target.value as ChannelType)}
            >
              <MenuItem value="slack">Slack</MenuItem>
              <MenuItem value="teams">Microsoft Teams</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Channel Name"
            value={formData.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g., #performance-alerts"
            fullWidth
            required
          />

          <TextField
            label="Webhook URL"
            value={formData.webhookUrl}
            onChange={(e) => handleWebhookUrlChange(e.target.value)}
            placeholder={getWebhookPlaceholder(formData.type)}
            fullWidth
            required
            helperText={getWebhookHelperText(formData.type)}
          />

          <FormControlLabel
            control={
              <Switch
                checked={formData.enabled}
                onChange={(e) => handleEnabledChange(e.target.checked)}
              />
            }
            label="Enable notifications"
          />

          <FormControlLabel
            control={
              <Switch
                checked={formData.notifyOnFailedOnly}
                onChange={(e) => handleNotifyOnFailedOnlyChange(e.target.checked)}
              />
            }
            label="Only notify for failed test runs"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={saving || !isValid}
        >
          {saving ? <CircularProgress size={24} /> : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
