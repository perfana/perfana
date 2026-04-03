'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Business,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { NoOrganizationMembership } from '@/components/NoOrganizationMembership';
import { NoOrganizationsExist } from '@/components/NoOrganizationsExist';

interface SystemEnvironment {
  environment: string;
  workloads: string[];
}

interface System {
  id: string;
  name: string;
  description?: string;
  environments: SystemEnvironment[];
  created_at: string;
}

export default function SystemsPage() {
  const router = useRouter();
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganizationId, isReady, isSelectorReadOnly, hasNoOrganizations, isAdmin, organizations } = useOrganizationContext();

  const handleSystemConfig = (system: System) => {
    router.push(`/systems/${system.id}/config`);
  };


  useEffect(() => {
    if (!isSelectorReadOnly && !isReady) {
      setLoading(false);
      return;
    }
    const fetchSystems = async () => {
      try {
        setLoading(true);
        const url = currentOrganizationId
          ? `/config/systems?organizationId=${currentOrganizationId}`
          : `/config/systems`;
        const response = await authenticatedFetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch systems: ${response.statusText}`);
        }

        const data = await response.json();
        setSystems(data);
      } catch (err) {
        const errorMessage = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load systems';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchSystems();
  }, [currentOrganizationId, isReady, isSelectorReadOnly]);

  if (hasNoOrganizations) {
    return <NoOrganizationMembership />;
  }

  if (isAdmin && !isReady && organizations.length === 0) {
    return <NoOrganizationsExist />;
  }

  // Show prompt if org selection is required but not yet made
  if (!isSelectorReadOnly && !isReady) {
    return (
      <Box sx={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Business sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Select an organization
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose an organization from the sidebar to view systems.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">
          {error}
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Systems Under Test
      </Typography>
      
      <Typography variant="body1" color="text.secondary" paragraph>
        Overview of all systems and their configured test environments and workloads.
      </Typography>

      {systems.length === 0 ? (
        <Alert severity="info">
          No systems found. Systems will appear here once you start running tests.
        </Alert>
      ) : (
        <TableContainer component={Paper} sx={{ mt: 3 }}>
          <Table sx={{ minWidth: 650 }} aria-label="systems under test table">
            <TableHead>
              <TableRow>
                <TableCell><strong>System Name</strong></TableCell>
                <TableCell><strong>Description</strong></TableCell>
                <TableCell align="center"><strong>Environments</strong></TableCell>
                <TableCell align="center"><strong>Total Workloads</strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {systems.map((system) => {
                const totalWorkloads = system.environments.reduce((sum, env) => sum + env.workloads.length, 0);
                
                return (
                  <TableRow
                    key={system.id}
                    sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                  >
                    <TableCell component="th" scope="row">
                      <Typography variant="h6" component="div">
                        {system.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {system.description || 'No description provided'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body1" fontWeight="medium">
                        {system.environments.length}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body1" fontWeight="medium">
                        {totalWorkloads}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSystemConfig(system)}
                        startIcon={<SettingsIcon />}
                      >
                        Edit Config
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}