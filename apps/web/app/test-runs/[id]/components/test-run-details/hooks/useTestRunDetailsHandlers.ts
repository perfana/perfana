'use client';

import { useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

export interface UseTestRunDetailsHandlersProps {
  testRun: TestRun;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  editingTags: string[];
  setEditingTags: (tags: string[]) => void;
  setIsEditingTags: (editing: boolean) => void;
  setTagsSaving: (saving: boolean) => void;
  editingAnnotations: string;
  setEditingAnnotations: (annotations: string) => void;
  setIsEditingAnnotations: (editing: boolean) => void;
  setAnnotationsSaving: (saving: boolean) => void;
  onTestRunUpdate: (updatedTestRun: TestRun) => void;
  showToast: (message: string) => void;
}

export interface UseTestRunDetailsHandlersReturn {
  handleExpand: () => void;
  handleTagsEdit: () => void;
  handleTagsCancel: () => void;
  handleTagsSave: () => Promise<void>;
  handleAnnotationsEdit: () => void;
  handleAnnotationsCancel: () => void;
  handleAnnotationsSave: () => Promise<void>;
}

export function useTestRunDetailsHandlers({
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
}: UseTestRunDetailsHandlersProps): UseTestRunDetailsHandlersReturn {

  const handleExpand = useCallback(() => {
    const wasCollapsed = !expanded;
    setExpanded(!expanded);

    // Auto-focus the card after expansion (only when expanding, not collapsing)
    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="test-run-details-card-expanded"]');
        if (expandedCard) {
          // Focus only, no scrolling - expand in place
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  }, [expanded, setExpanded]);

  const handleTagsEdit = useCallback(() => {
    setEditingTags([...(testRun?.tags || [])]);
    setIsEditingTags(true);
  }, [testRun, setEditingTags, setIsEditingTags]);

  const handleTagsCancel = useCallback(() => {
    setIsEditingTags(false);
    setEditingTags([]);
  }, [setIsEditingTags, setEditingTags]);

  const handleTagsSave = useCallback(async () => {
    if (!testRun) return;

    setTagsSaving(true);
    try {
      const response = await authenticatedFetch(`/test-runs/${testRun.id}/tags`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tags: editingTags }),
      });

      if (!response.ok) {
        throw new Error('Failed to update tags');
      }

      // Update the test run state with new tags
      const updatedTestRun = { ...testRun, tags: editingTags };
      onTestRunUpdate(updatedTestRun);
      setIsEditingTags(false);
      showToast('Tags updated successfully');
    } catch (error) {
      console.error('Failed to update tags:', error);
      showToast('Failed to update tags');
    } finally {
      setTagsSaving(false);
    }
  }, [testRun, editingTags, setTagsSaving, onTestRunUpdate, setIsEditingTags, showToast]);

  const handleAnnotationsEdit = useCallback(() => {
    // Convert array to string (join with newlines for multiline editing)
    const annotationsText = testRun?.annotations?.join('\n') || '';
    setEditingAnnotations(annotationsText);
    setIsEditingAnnotations(true);
  }, [testRun, setEditingAnnotations, setIsEditingAnnotations]);

  const handleAnnotationsCancel = useCallback(() => {
    setIsEditingAnnotations(false);
    setEditingAnnotations('');
  }, [setIsEditingAnnotations, setEditingAnnotations]);

  const handleAnnotationsSave = useCallback(async () => {
    if (!testRun) return;

    setAnnotationsSaving(true);
    try {
      // Convert string to array (split by newlines and filter out empty lines)
      const annotationsArray = editingAnnotations.split('\n').filter(line => line.trim() !== '');

      const response = await authenticatedFetch(`/test-runs/${testRun.id}/annotations`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ annotations: annotationsArray }),
      });

      if (!response.ok) {
        throw new Error('Failed to update annotations');
      }

      // Update the test run state with new annotations
      const updatedTestRun = { ...testRun, annotations: annotationsArray };
      onTestRunUpdate(updatedTestRun);
      setIsEditingAnnotations(false);
      showToast('Annotations updated successfully');
    } catch (error) {
      console.error('Failed to update annotations:', error);
      showToast('Failed to update annotations');
    } finally {
      setAnnotationsSaving(false);
    }
  }, [testRun, editingAnnotations, setAnnotationsSaving, onTestRunUpdate, setIsEditingAnnotations, showToast]);

  return {
    handleExpand,
    handleTagsEdit,
    handleTagsCancel,
    handleTagsSave,
    handleAnnotationsEdit,
    handleAnnotationsCancel,
    handleAnnotationsSave,
  };
}
