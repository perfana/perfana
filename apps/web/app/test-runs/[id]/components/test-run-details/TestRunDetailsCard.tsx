'use client';

import React, { useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Divider,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { getAccentColor } from './utils/test-run-formatters';
import { useTestRunDetailsHandlers } from './hooks';
import {
  TestRunDetailsCollapsedView,
  TestRunIdentitySection,
  TestConfigurationSection,
  TimingInformationSection,
  EvaluationResultsSection,
  AnnotationsTagsSection,
} from './components';

interface TestRunDetailsCardProps {
  testRun: TestRun;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  isEditingTags: boolean;
  setIsEditingTags: (editing: boolean) => void;
  editingTags: string[];
  setEditingTags: (tags: string[]) => void;
  allAvailableTags: string[];
  tagsSaving: boolean;
  setTagsSaving: (saving: boolean) => void;
  isEditingAnnotations: boolean;
  setIsEditingAnnotations: (editing: boolean) => void;
  editingAnnotations: string;
  setEditingAnnotations: (annotations: string) => void;
  annotationsSaving: boolean;
  setAnnotationsSaving: (saving: boolean) => void;
  onTestRunUpdate: (updatedTestRun: TestRun) => void;
  showToast: (message: string) => void;
  onRefreshTriggered?: () => void;
}

export default function TestRunDetailsCard({
  testRun,
  expanded,
  setExpanded,
  isEditingTags,
  setIsEditingTags,
  editingTags,
  setEditingTags,
  allAvailableTags,
  tagsSaving,
  setTagsSaving,
  isEditingAnnotations,
  setIsEditingAnnotations,
  editingAnnotations,
  setEditingAnnotations,
  annotationsSaving,
  setAnnotationsSaving,
  onTestRunUpdate,
  showToast,
  onRefreshTriggered,
}: TestRunDetailsCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const accentColor = getAccentColor(testRun);

  const {
    handleExpand,
    handleTagsEdit,
    handleTagsCancel,
    handleTagsSave,
    handleAnnotationsEdit,
    handleAnnotationsCancel,
    handleAnnotationsSave,
  } = useTestRunDetailsHandlers({
    testRun,
    expanded,
    setExpanded,
    editingTags,
    setEditingTags,
    setIsEditingTags,
    setTagsSaving,
    editingAnnotations,
    setEditingAnnotations,
    setIsEditingAnnotations,
    setAnnotationsSaving,
    onTestRunUpdate,
    showToast,
  });

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      elevation={0}
      data-testid={expanded ? 'test-run-details-card-expanded' : 'test-run-details-card-collapsed'}
      sx={{
        cursor: expanded ? 'default' : 'pointer',
        height: expanded ? '100%' : '293px',
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: 'none',
        borderTop: expanded ? 'none' : `3px solid ${accentColor}`,
        boxShadow: (theme) => theme.palette.mode === 'dark'
          ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
          : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: expanded ? 'visible' : 'hidden',
        '&:hover': expanded ? {} : {
          transform: 'translateY(-4px)',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)'
        }
      }}
      onClick={expanded ? undefined : handleExpand}
    >
      <CardContent sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        p: 3.5,
        pt: 4,
        '&:last-child': { pb: 3.5 }
      }}>
        {/* Header */}
        <CardHeader
          expanded={expanded}
          accentColor={accentColor}
          onExpand={handleExpand}
        />

        {/* Collapsed state content */}
        {!expanded && (
          <TestRunDetailsCollapsedView testRun={testRun} />
        )}

        {/* Expandable detailed information */}
        <Collapse in={expanded}>
          <Divider sx={{ my: 3, opacity: 0.6 }} />

          {/* Grid layout for section cards */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(3, 1fr)'
            },
            gap: 3,
            mt: 2
          }}>
            <TestRunIdentitySection testRun={testRun} onTestRunUpdate={onTestRunUpdate} showToast={showToast} />
            <TestConfigurationSection testRun={testRun} />
            <TimingInformationSection testRun={testRun} onTestRunUpdate={onTestRunUpdate} showToast={showToast} />
            <EvaluationResultsSection testRun={testRun} onRefreshTriggered={onRefreshTriggered} showToast={showToast} />
            <AnnotationsTagsSection
              testRun={testRun}
              isEditingAnnotations={isEditingAnnotations}
              editingAnnotations={editingAnnotations}
              annotationsSaving={annotationsSaving}
              isEditingTags={isEditingTags}
              editingTags={editingTags}
              tagsSaving={tagsSaving}
              allAvailableTags={allAvailableTags}
              onAnnotationsEdit={handleAnnotationsEdit}
              onAnnotationsCancel={handleAnnotationsCancel}
              onAnnotationsSave={handleAnnotationsSave}
              onAnnotationsChange={setEditingAnnotations}
              onTagsEdit={handleTagsEdit}
              onTagsCancel={handleTagsCancel}
              onTagsSave={handleTagsSave}
              onTagsChange={setEditingTags}
            />
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

interface CardHeaderProps {
  expanded: boolean;
  accentColor: string;
  onExpand: () => void;
}

function CardHeader({ expanded, accentColor, onExpand }: CardHeaderProps) {
  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      mb={expanded ? 0 : 2}
      sx={{
        cursor: expanded ? 'pointer' : 'inherit',
        py: expanded ? 1 : 0,
        px: expanded ? 1.25 : 0,
        mx: expanded ? -1.25 : 0,
        borderRadius: 2,
        transition: 'all 0.2s ease',
        ...(expanded ? {
          position: 'sticky',
          top: 0,
          zIndex: 10,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        } : {
          position: 'relative',
        }),
        '&:hover': expanded ? {
          backgroundColor: 'action.hover'
        } : {}
      }}
      onClick={expanded ? onExpand : undefined}
    >
      {expanded ? (
        <Box textAlign="center" flex="1">
          <Typography
            variant="h5"
            component="h2"
            sx={{
              fontWeight: 600,
              color: 'text.primary',
              fontSize: '1.25rem',
              lineHeight: 1.2
            }}
          >
            Test Run Info
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click to collapse
          </Typography>
        </Box>
      ) : (
        <Typography
          variant="subtitle1"
          component="h2"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            fontSize: '0.875rem',
            letterSpacing: '0.01em',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Test Run Info
        </Typography>
      )}
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        size="small"
        sx={{
          position: expanded ? 'relative' : 'absolute',
          right: expanded ? 'auto' : 0,
          width: 32,
          height: 32,
          color: 'text.secondary',
          '&:hover': {
            backgroundColor: `${accentColor}15`,
            color: accentColor,
          },
          transition: 'all 0.2s ease',
        }}
      >
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </IconButton>
    </Box>
  );
}
