'use client';

import { FC } from 'react';
import Link from 'next/link';
import { RecentFailure } from '@/lib/api';
import { ExternalLink } from 'lucide-react';
import { Box, Typography, Tooltip } from '@mui/material';
import { formatDistanceToNow } from 'date-fns';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

interface RecentFailuresTableProps {
  failures: RecentFailure[];
}

export const RecentFailuresTable: FC<RecentFailuresTableProps> = ({ failures }) => {
  const { currentOrganizationId } = useOrganizationContext();
  if (failures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-12 text-center">
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(76, 175, 80, 0.3)',
            mb: 2,
          }}
        >
          <Typography
            sx={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color: 'white',
              textShadow: '0 1px 2px rgba(0,0,0,0.2)',
              lineHeight: 1,
            }}
          >
            ✓
          </Typography>
        </Box>
        <h3 className="mb-2 text-lg font-semibold text-foreground">
          No Unreviewed Failures
        </h3>
        <p className="text-sm text-muted-foreground">
          All recent failures have been reviewed, or all test runs are passing
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="max-h-[500px] overflow-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Test Run
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                System
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Environment
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Workload
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Failed
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Result
              </th>
              <th scope="col" className="relative px-6 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {failures.map((failure) => (
              <tr
                key={failure.id}
                className="group transition-colors hover:bg-accent border-l-2 border-transparent hover:border-red-400"
              >
                <td className="whitespace-nowrap px-6 py-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {failure.test_run_id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {failure.id.slice(0, 8)}...
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="text-sm text-foreground">{failure.system_name}</div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="text-sm text-foreground">
                    {failure.test_environment}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="text-sm text-foreground">{failure.workload}</div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(failure.created_at), {
                    addSuffix: true,
                  })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-center">
                  <div className="flex items-center justify-center">
                    <Tooltip
                      title={
                        <Box sx={{ p: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
                            Detailed Results
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: failure.consolidated_result?.meetsRequirement === true
                                  ? 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)'
                                  : failure.consolidated_result?.meetsRequirement === false
                                  ? 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)'
                                  : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}>
                                {failure.consolidated_result?.meetsRequirement === true ? '✓' : failure.consolidated_result?.meetsRequirement === false ? '✕' : '!'}
                              </Box>
                              <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
                                Service Level Objectives
                              </Typography>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: failure.consolidated_result?.adaptTestRunOK === true
                                  ? 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)'
                                  : failure.consolidated_result?.adaptTestRunOK === false
                                  ? 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)'
                                  : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '10px',
                                fontWeight: 'bold'
                              }}>
                                {failure.consolidated_result?.adaptTestRunOK === true ? '✓' : failure.consolidated_result?.adaptTestRunOK === false ? '✕' : '!'}
                              </Box>
                              <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
                                Anomaly Detection
                              </Typography>
                            </Box>
                          </Box>
                        </Box>
                      }
                      arrow
                      placement="top"
                      sx={{
                        '& .MuiTooltip-tooltip': {
                          backgroundColor: 'rgba(33, 33, 33, 0.95)',
                          backdropFilter: 'blur(10px)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                          maxWidth: 280,
                        },
                        '& .MuiTooltip-arrow': {
                          color: 'rgba(33, 33, 33, 0.95)',
                        }
                      }}
                    >
                      <Box sx={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(244, 67, 54, 0.3)',
                        cursor: 'help',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          transform: 'scale(1.05)',
                          boxShadow: '0 4px 12px rgba(244, 67, 54, 0.4)'
                        }
                      }}>
                        <Typography sx={{
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          color: 'white',
                          textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                          lineHeight: 1
                        }}>
                          ✕
                        </Typography>
                      </Box>
                    </Tooltip>
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                  <Link
                    href={`/test-runs/${failure.test_run_id}?system=${encodeURIComponent(failure.system_name)}&environment=${encodeURIComponent(failure.test_environment)}&workload=${encodeURIComponent(failure.workload)}${currentOrganizationId ? `&organizationId=${encodeURIComponent(currentOrganizationId)}` : ''}`}
                    className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-primary transition-all hover:bg-accent"
                  >
                    View
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
