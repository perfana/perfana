'use client';

import { useState, useCallback } from 'react';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  setDefaultTemplate,
  type TemplateListItem,
  type CreateTemplateRequest,
  type UpdateTemplateRequest,
  type ReportSectionConfig,
  type ReportStyling,
} from '@/lib/api/reports';

interface UseReportingTemplateManagementReturn {
  // State
  templates: TemplateListItem[];
  templatesLoading: boolean;

  // Filter state
  templateSearchText: string;
  selectedTemplateTags: string[];

  // Dialog state
  createTemplateOpen: boolean;
  editTemplateOpen: boolean;
  deleteConfirmOpen: boolean;
  editingTemplate: TemplateListItem | null;
  deletingTemplate: TemplateListItem | null;

  // Loading states
  formLoading: boolean;
  editFormLoading: boolean;
  deleteLoading: boolean;

  // Actions
  fetchTemplates: (systemId: string, environment: string, workload: string) => Promise<void>;
  handleCreateTemplate: () => void;
  handleSubmitTemplate: (
    name: string,
    description: string | undefined,
    sections: ReportSectionConfig[],
    styling: ReportStyling | undefined,
    isDefault: boolean,
    systemId: string,
    testEnvironment: string,
    workload: string
  ) => Promise<void>;
  handleEditTemplate: (template: TemplateListItem) => void;
  handleSubmitEditTemplate: (
    name: string,
    description: string | undefined,
    sections: ReportSectionConfig[],
    styling: ReportStyling | undefined,
    isDefault: boolean
  ) => Promise<void>;
  handleDeleteTemplate: (template: TemplateListItem) => void;
  handleConfirmDelete: () => Promise<void>;
  handleBatchDelete: (ids: string[]) => Promise<void>;
  handleDuplicateTemplate: (template: TemplateListItem, newName: string) => Promise<void>;
  handleSetDefaultTemplate: (templateId: string, systemId: string, environment: string, workload: string) => Promise<void>;

  // Filter actions
  setTemplateSearchText: (text: string) => void;
  handleTemplateTagToggle: (tag: string) => void;
  clearTemplateTags: () => void;

  // Dialog actions
  setCreateTemplateOpen: (open: boolean) => void;
  setEditTemplateOpen: (open: boolean) => void;
  setDeleteConfirmOpen: (open: boolean) => void;
  clearDeleteState: () => void;
  clearTemplates: () => void;
}

export function useReportingTemplateManagement(): UseReportingTemplateManagementReturn {
  // State
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Filter state
  const [templateSearchText, setTemplateSearchText] = useState('');
  const [selectedTemplateTags, setSelectedTemplateTags] = useState<string[]>([]);

  // Dialog state
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [editTemplateOpen, setEditTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateListItem | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<TemplateListItem | null>(null);

  // Loading states
  const [formLoading, setFormLoading] = useState(false);
  const [editFormLoading, setEditFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Fetch templates
  const fetchTemplates = useCallback(async (systemId: string, environment: string, workload: string) => {
    try {
      setTemplatesLoading(true);
      const result = await listTemplates({
        system_id: systemId,
        test_environment: environment,
        workload: workload,
      });
      setTemplates(result.items || []);
    } catch (err) {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  // Handle create template
  const handleCreateTemplate = useCallback(() => {
    setCreateTemplateOpen(true);
  }, []);

  // Handle submit new template
  const handleSubmitTemplate = useCallback(async (
    name: string,
    description: string | undefined,
    sections: ReportSectionConfig[],
    styling: ReportStyling | undefined,
    isDefault: boolean,
    systemId: string,
    testEnvironment: string,
    workload: string
  ) => {
    try {
      setFormLoading(true);

      const request: CreateTemplateRequest = {
        name,
        description,
        system_id: systemId,
        test_environment: testEnvironment,
        workload,
        sections,
        styling,
        is_default: isDefault,
      };

      await createTemplate(request);
      await fetchTemplates(systemId, testEnvironment, workload);
      setCreateTemplateOpen(false);
    } finally {
      setFormLoading(false);
    }
  }, [fetchTemplates]);

  // Handle edit template
  const handleEditTemplate = useCallback((template: TemplateListItem) => {
    setEditingTemplate(template);
    setEditTemplateOpen(true);
  }, []);

  // Handle submit edit template
  const handleSubmitEditTemplate = useCallback(async (
    name: string,
    description: string | undefined,
    sections: ReportSectionConfig[],
    styling: ReportStyling | undefined,
    isDefault: boolean
  ) => {
    if (!editingTemplate) return;

    try {
      setEditFormLoading(true);

      const request: UpdateTemplateRequest = {
        name,
        description,
        sections,
        styling,
        is_default: isDefault,
      };

      await updateTemplate(editingTemplate.id, request);

      // Refresh templates
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === editingTemplate.id
            ? { ...t, name, description, is_default: isDefault, section_count: sections.length }
            : t
        )
      );

      setEditTemplateOpen(false);
      setEditingTemplate(null);
    } finally {
      setEditFormLoading(false);
    }
  }, [editingTemplate]);

  // Handle delete template
  const handleDeleteTemplate = useCallback((template: TemplateListItem) => {
    setDeletingTemplate(template);
    setDeleteConfirmOpen(true);
  }, []);

  // Handle confirm delete
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingTemplate) return;

    try {
      setDeleteLoading(true);
      await deleteTemplate(deletingTemplate.id);
      setTemplates((prev) => prev.filter((t) => t.id !== deletingTemplate.id));
      clearDeleteState();
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingTemplate]);

  // Handle batch delete
  const handleBatchDelete = useCallback(async (ids: string[]) => {
    // Delete all templates in parallel
    await Promise.all(ids.map((id) => deleteTemplate(id)));
    // Remove deleted templates from state
    setTemplates((prev) => prev.filter((t) => !ids.includes(t.id)));
  }, []);

  // Handle duplicate template
  const handleDuplicateTemplate = useCallback(async (template: TemplateListItem, newName: string) => {
    await duplicateTemplate(template.id, { name: newName });
    // Refresh templates after duplication
    // Note: We need the scope info here, so this might need to be called from the component
  }, []);

  // Handle set default template
  const handleSetDefaultTemplate = useCallback(async (
    templateId: string,
    systemId: string,
    environment: string,
    workload: string
  ) => {
    await setDefaultTemplate(templateId);
    await fetchTemplates(systemId, environment, workload);
  }, [fetchTemplates]);

  // Filter actions
  const handleTemplateTagToggle = useCallback((tag: string) => {
    setSelectedTemplateTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearTemplateTags = useCallback(() => {
    setSelectedTemplateTags([]);
  }, []);

  const clearDeleteState = useCallback(() => {
    setDeleteConfirmOpen(false);
    setDeletingTemplate(null);
  }, []);

  const clearTemplates = useCallback(() => {
    setTemplates([]);
  }, []);

  return {
    // State
    templates,
    templatesLoading,

    // Filter state
    templateSearchText,
    selectedTemplateTags,

    // Dialog state
    createTemplateOpen,
    editTemplateOpen,
    deleteConfirmOpen,
    editingTemplate,
    deletingTemplate,

    // Loading states
    formLoading,
    editFormLoading,
    deleteLoading,

    // Actions
    fetchTemplates,
    handleCreateTemplate,
    handleSubmitTemplate,
    handleEditTemplate,
    handleSubmitEditTemplate,
    handleDeleteTemplate,
    handleConfirmDelete,
    handleBatchDelete,
    handleDuplicateTemplate,
    handleSetDefaultTemplate,

    // Filter actions
    setTemplateSearchText,
    handleTemplateTagToggle,
    clearTemplateTags,

    // Dialog actions
    setCreateTemplateOpen,
    setEditTemplateOpen,
    setDeleteConfirmOpen,
    clearDeleteState,
    clearTemplates,
  };
}
