'use client';

import { useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Checkbox,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Tag as IdIcon,
  Check as CheckIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
import { type TemplateListItem } from '@/lib/api/reports';

interface TemplateTableProps {
  templates: TemplateListItem[];
  searchText: string;
  selectedTemplateIds: Set<string>;
  onEdit: (template: TemplateListItem) => void;
  onDelete: (template: TemplateListItem) => void;
  onDuplicate: (template: TemplateListItem) => void;
  onSetDefault: (templateId: string) => void;
  onClearSearch: () => void;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
}

export default function TemplateTable({
  templates,
  searchText,
  selectedTemplateIds,
  onEdit,
  onDelete,
  onDuplicate,
  onSetDefault,
  onClearSearch,
  onSelectAll,
  onSelectOne,
}: TemplateTableProps) {
  // Which row most recently had its id copied, so the button can confirm it happened. Clipboard
  // writes are silent otherwise and the user has no way to tell the click registered.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions). Selecting the text is
      // then the fallback, so leave the icon unchanged rather than claiming a copy happened.
    }
  };

  const getFilteredTemplates = () => {
    let filtered = templates;

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.created_by.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  };

  const filteredTemplates = getFilteredTemplates();

  return (
    <TableContainer sx={{ maxHeight: 600 }}>
      <Table
        stickyHeader
        sx={{ minWidth: 650 }}
        aria-label="reporting templates table"
      >
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ backgroundColor: 'background.paper' }}>
              <Checkbox
                checked={
                  selectedTemplateIds.size > 0 &&
                  selectedTemplateIds.size === filteredTemplates.length
                }
                indeterminate={
                  selectedTemplateIds.size > 0 &&
                  selectedTemplateIds.size < filteredTemplates.length
                }
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all templates' }}
              />
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}>
              <strong>Template Name</strong>
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}>
              <strong>Description</strong>
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}>
              <strong>Sections</strong>
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}>
              <strong>Section Types</strong>
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}>
              <strong>Created By</strong>
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}>
              <strong>Status</strong>
            </TableCell>
            <TableCell
              align="center"
              sx={{ backgroundColor: 'background.paper' }}
            >
              <strong>Actions</strong>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredTemplates.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  {searchText
                    ? 'No templates match the current search'
                    : 'No reporting templates configured yet'}
                </Typography>
                {searchText && (
                  <Button
                    size="small"
                    onClick={onClearSearch}
                    sx={{ mt: 1 }}
                  >
                    Clear Search
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ) : (
            filteredTemplates.map((template) => (
              <TableRow
                key={template.id}
                hover
                selected={selectedTemplateIds.has(template.id)}
                sx={{
                  '&:last-child td, &:last-child th': { border: 0 },
                  cursor: 'pointer',
                }}
                onClick={() => onEdit(template)}
              >
                <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedTemplateIds.has(template.id)}
                    onChange={() => onSelectOne(template.id)}
                    inputProps={{ 'aria-label': `Select template ${template.name}` }}
                  />
                </TableCell>
                <TableCell component="th" scope="row">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DescriptionIcon fontSize="small" color="action" />
                    <Typography variant="body2" fontWeight={500}>
                      {template.name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      maxWidth: 300,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {template.description || '-'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {template.section_count}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {template.section_types.slice(0, 3).map((type) => (
                      <Chip
                        key={type}
                        label={type}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                    {template.section_types.length > 3 && (
                      <Chip
                        label={`+${template.section_types.length - 3}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {template.created_by}
                  </Typography>
                </TableCell>
                <TableCell>
                  {template.is_default ? (
                    <Chip
                      icon={<StarIcon />}
                      label="Default"
                      size="small"
                      color="primary"
                    />
                  ) : (
                    <Chip label="Active" size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="center">
                  <Box
                    sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* The uuid is what POST /reports/generate takes as template_id. A pipeline
                        cannot read it off this screen any other way, and template_name only
                        works while the name is unique in the scope. */}
                    <Tooltip title={copiedId === template.id ? 'Template ID copied' : 'Copy template ID'}>
                      <IconButton
                        size="small"
                        onClick={() => handleCopyId(template.id)}
                        aria-label={`Copy template ID for ${template.name}`}
                      >
                        {copiedId === template.id ? (
                          <CheckIcon fontSize="small" color="success" />
                        ) : (
                          <IdIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    {!template.is_default && (
                      <Tooltip title="Set as default">
                        <IconButton
                          size="small"
                          onClick={() => onSetDefault(template.id)}
                        >
                          <StarBorderIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Duplicate">
                      <IconButton
                        size="small"
                        onClick={() => onDuplicate(template)}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => onEdit(template)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDelete(template)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
