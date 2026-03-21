'use client';

import { useState } from 'react';
import {
  Box,
  MenuItem,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  List,
  Tooltip,
  Typography,
} from '@mui/material';
import { Business, UnfoldMore } from '@mui/icons-material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { useSidebar } from '@/contexts/sidebar-context';

export function OrganizationSelector() {
  const {
    organizations,
    currentOrganizationId,
    currentOrganization,
    shouldShowSelector,
    isSelectorReadOnly,
    selectOrganization,
  } = useOrganizationContext();
  const { isOpen } = useSidebar();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (!shouldShowSelector) {
    return null;
  }

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!isSelectorReadOnly) {
      setAnchorEl(e.currentTarget);
    }
  };

  const handleClose = () => setAnchorEl(null);

  const displayName = currentOrganization?.name || 'Select organization...';
  const isSelected = currentOrganizationId !== null;

  const button = (
    <ListItem disablePadding>
      <ListItemButton
        onClick={handleClick}
        sx={{
          minHeight: 48,
          justifyContent: isOpen ? 'initial' : 'center',
          px: 2.5,
          borderRadius: 1,
          mx: 1,
          mb: 0.5,
          cursor: isSelectorReadOnly ? 'default' : 'pointer',
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: 0,
            mr: isOpen ? 2 : 'auto',
            justifyContent: 'center',
            color: isSelected ? 'primary.main' : 'inherit',
          }}
        >
          <Business />
        </ListItemIcon>
        <ListItemText
          primary={displayName}
          sx={{
            opacity: isOpen ? 1 : 0,
            '& .MuiListItemText-primary': {
              fontSize: '0.875rem',
              fontWeight: isSelected ? 500 : 400,
            },
          }}
        />
        {isOpen && !isSelectorReadOnly && (
          <UnfoldMore sx={{ fontSize: '1.1rem', color: 'text.secondary', ml: 0.5 }} />
        )}
      </ListItemButton>
    </ListItem>
  );

  return (
    <Box sx={{ py: 0.5 }}>
      {isOpen && (
        <Typography
          variant="overline"
          sx={{
            px: 2,
            py: 1,
            display: 'block',
            color: 'text.secondary',
            fontWeight: 600,
            fontSize: '0.75rem',
          }}
        >
          Organization
        </Typography>
      )}
      {!isOpen ? (
        <Tooltip title={displayName} placement="right">
          {button}
        </Tooltip>
      ) : (
        button
      )}

      {!isSelectorReadOnly && (
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'top', horizontal: isOpen ? 'center' : 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: isOpen ? 'center' : 'left' }}
        >
          <List dense sx={{ minWidth: 200 }}>
            {organizations.map((org) => (
              <MenuItem
                key={org.id}
                selected={org.id === currentOrganizationId}
                onClick={() => {
                  selectOrganization(org.id);
                  handleClose();
                }}
              >
                {org.name}
              </MenuItem>
            ))}
          </List>
        </Popover>
      )}
    </Box>
  );
}
