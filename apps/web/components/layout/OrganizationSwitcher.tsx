'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Typography,
  Divider,
  ListItemIcon,
  ListItemText,
  CircularProgress,
} from '@mui/material';
import {
  Business,
  ExpandMore,
  Check,
  Settings,
  Add,
} from '@mui/icons-material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

export function OrganizationSwitcher() {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const {
    currentOrganization,
    organizations,
    isLoading,
    selectOrganization,
  } = useOrganizationContext();

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelectOrganization = (orgId: string) => {
    selectOrganization(orgId);
    handleClose();
  };

  const handleManageOrganizations = () => {
    handleClose();
    router.push('/settings/organizations');
  };

  const handleCreateOrganization = () => {
    handleClose();
    router.push('/settings/organizations');
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (organizations.length === 0) {
    return (
      <Button
        onClick={handleCreateOrganization}
        startIcon={<Add />}
        sx={{
          textTransform: 'none',
          color: 'text.secondary',
        }}
      >
        Create Organization
      </Button>
    );
  }

  return (
    <>
      <Button
        id="org-switcher-button"
        aria-controls={open ? 'org-switcher-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleClick}
        startIcon={<Business />}
        endIcon={<ExpandMore />}
        sx={{
          textTransform: 'none',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          px: 2,
          py: 1,
          minWidth: 180,
          justifyContent: 'space-between',
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 150,
          }}
        >
          {currentOrganization?.name || 'Select Organization'}
        </Typography>
      </Button>
      <Menu
        id="org-switcher-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'org-switcher-button',
        }}
        PaperProps={{
          sx: {
            minWidth: 250,
            maxHeight: 400,
          },
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            ORGANIZATIONS
          </Typography>
        </Box>
        {organizations.map((org) => (
          <MenuItem
            key={org.id}
            onClick={() => handleSelectOrganization(org.id)}
            selected={org.id === currentOrganization?.id}
          >
            <ListItemIcon>
              {org.id === currentOrganization?.id ? (
                <Check fontSize="small" color="primary" />
              ) : (
                <Business fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={org.name}
              primaryTypographyProps={{
                fontWeight: org.id === currentOrganization?.id ? 600 : 400,
              }}
            />
          </MenuItem>
        ))}
        <Divider sx={{ my: 1 }} />
        <MenuItem onClick={handleManageOrganizations}>
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Manage Organizations" />
        </MenuItem>
        <MenuItem onClick={handleCreateOrganization}>
          <ListItemIcon>
            <Add fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Create Organization" />
        </MenuItem>
      </Menu>
    </>
  );
}
