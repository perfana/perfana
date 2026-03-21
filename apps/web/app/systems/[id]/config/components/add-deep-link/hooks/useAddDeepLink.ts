'use client';

import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { VariableDefinition, BASE_VARIABLES } from '../types';

interface UseAddDeepLinkProps {
  open: boolean;
  systemId: string;
  systemName: string;
  testEnvironment: string;
  workload: string;
  onSubmit: (deepLink: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    name: string;
    url: string;
    tags: string[];
  }) => Promise<void>;
  onClose: () => void;
}

interface UseAddDeepLinkReturn {
  // Form state
  name: string;
  setName: (name: string) => void;
  url: string;
  tags: string[];
  setTags: (tags: string[]) => void;
  nameError: string | null;
  urlError: string | null;
  submitting: boolean;

  // Available variables
  availableVariables: VariableDefinition[];
  loadingConfigKeys: boolean;

  // Autocomplete state
  autocompleteOpen: boolean;
  autocompleteAnchor: HTMLElement | null;
  filteredVariables: VariableDefinition[];
  selectedIndex: number;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
  menuListRef: RefObject<HTMLUListElement | null>;

  // Handlers
  handleUrlChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleVariableSelect: (variable: VariableDefinition) => void;
  handleAutocompleteClose: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSubmit: () => Promise<void>;
  insertVariable: (variableName: string) => void;
}

export function useAddDeepLink({
  open,
  systemId,
  systemName,
  testEnvironment,
  workload,
  onSubmit,
  onClose,
}: UseAddDeepLinkProps): UseAddDeepLinkReturn {
  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Variables state
  const [availableVariables, setAvailableVariables] = useState<VariableDefinition[]>(BASE_VARIABLES);
  const [loadingConfigKeys, setLoadingConfigKeys] = useState(false);

  // Autocomplete state
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteAnchor, setAutocompleteAnchor] = useState<HTMLElement | null>(null);
  const [filteredVariables, setFilteredVariables] = useState<VariableDefinition[]>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const menuListRef = useRef<HTMLUListElement | null>(null);

  const resetAutocomplete = useCallback(() => {
    setAutocompleteOpen(false);
    setAutocompleteAnchor(null);
    setFilteredVariables([]);
    setSelectedIndex(0);
    setHoveredIndex(null);
  }, []);

  const fetchLatestConfigKeys = useCallback(async () => {
    if (!systemName || !testEnvironment || !workload) return;

    try {
      setLoadingConfigKeys(true);

      const response = await authenticatedFetch(
        `/test-runs/config-keys/latest?system=${encodeURIComponent(systemName)}&environment=${encodeURIComponent(testEnvironment)}&workload=${encodeURIComponent(workload)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const configKeys = await response.json() as string[];
        const configVariables = configKeys.map(key => ({
          name: key,
          description: `Configuration value: ${key}`
        }));
        setAvailableVariables([...BASE_VARIABLES, ...configVariables]);
      } else {
        setAvailableVariables(BASE_VARIABLES);
      }
    } catch {
      setAvailableVariables(BASE_VARIABLES);
    } finally {
      setLoadingConfigKeys(false);
    }
  }, [systemName, testEnvironment, workload]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setName('');
      setUrl('');
      setTags([]);
      setNameError(null);
      setUrlError(null);
      setSubmitting(false);
      resetAutocomplete();
      setAvailableVariables(BASE_VARIABLES);
      fetchLatestConfigKeys();
    }
  }, [open, fetchLatestConfigKeys, resetAutocomplete]);

  const scrollSelectedItemIntoView = useCallback((index: number) => {
    if (menuListRef.current) {
      const menuItems = menuListRef.current.children;
      if (menuItems[index]) {
        (menuItems[index] as HTMLElement).scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, []);

  const handleUrlChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    const inputElement = event.target;
    const cursorPos = inputElement.selectionStart || 0;

    setUrl(newValue);
    setCursorPosition(cursorPos);

    // Check if we should show autocomplete
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const lastBraceIndex = textBeforeCursor.lastIndexOf('{');
    const lastCloseBraceIndex = textBeforeCursor.lastIndexOf('}');

    if (lastBraceIndex > lastCloseBraceIndex && lastBraceIndex !== -1) {
      const searchTerm = textBeforeCursor.substring(lastBraceIndex + 1).toLowerCase();
      const filtered = availableVariables.filter(variable =>
        variable.name.toLowerCase().includes(searchTerm) ||
        variable.description.toLowerCase().includes(searchTerm)
      );

      setFilteredVariables(filtered);
      setAutocompleteAnchor(inputElement);
      setAutocompleteOpen(filtered.length > 0);
      setSelectedIndex(0);
      setHoveredIndex(null);
    } else {
      resetAutocomplete();
    }
  }, [availableVariables, resetAutocomplete]);

  const handleVariableSelect = useCallback((variable: VariableDefinition) => {
    const textBeforeCursor = url.substring(0, cursorPosition);
    const textAfterCursor = url.substring(cursorPosition);
    const lastBraceIndex = textBeforeCursor.lastIndexOf('{');

    if (lastBraceIndex !== -1) {
      const newUrl =
        textBeforeCursor.substring(0, lastBraceIndex + 1) +
        variable.name +
        '}' +
        textAfterCursor;

      setUrl(newUrl);
      setAutocompleteOpen(false);
      setAutocompleteAnchor(null);

      // Focus back to input and set cursor position after the inserted variable
      setTimeout(() => {
        const input = autocompleteAnchor as HTMLInputElement;
        if (input) {
          input.focus();
          const newCursorPos = lastBraceIndex + variable.name.length + 2;
          input.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    }
  }, [url, cursorPosition, autocompleteAnchor]);

  const handleAutocompleteClose = useCallback(() => {
    setAutocompleteOpen(false);
    setAutocompleteAnchor(null);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!autocompleteOpen || filteredVariables.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex(prev => {
          const newIndex = prev < filteredVariables.length - 1 ? prev + 1 : 0;
          setTimeout(() => scrollSelectedItemIntoView(newIndex), 0);
          return newIndex;
        });
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex(prev => {
          const newIndex = prev > 0 ? prev - 1 : filteredVariables.length - 1;
          setTimeout(() => scrollSelectedItemIntoView(newIndex), 0);
          return newIndex;
        });
        break;
      case 'Enter':
        event.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredVariables.length) {
          handleVariableSelect(filteredVariables[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setAutocompleteOpen(false);
        setAutocompleteAnchor(null);
        break;
    }
  }, [autocompleteOpen, filteredVariables, selectedIndex, handleVariableSelect, scrollSelectedItemIntoView]);

  const validateForm = useCallback((): boolean => {
    let isValid = true;

    if (!name.trim()) {
      setNameError('Name is required');
      isValid = false;
    } else {
      setNameError(null);
    }

    if (!url.trim()) {
      setUrlError('URL is required');
      isValid = false;
    } else {
      const urlPattern = /^https?:\/\/|.*\{.*\}.*/;
      if (!urlPattern.test(url.trim())) {
        setUrlError('Please enter a valid URL (starting with http:// or https://) or URL template with variables');
        isValid = false;
      } else {
        setUrlError(null);
      }
    }

    return isValid;
  }, [name, url]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    try {
      setSubmitting(true);
      await onSubmit({
        systemUnderTestId: systemId,
        testEnvironment,
        workload,
        name: name.trim(),
        url: url.trim(),
        tags,
      });
      onClose();
    } catch {
      // Error handling is done by the parent component
    } finally {
      setSubmitting(false);
    }
  }, [validateForm, systemId, testEnvironment, workload, name, url, tags, onSubmit, onClose]);

  const insertVariable = useCallback((variableName: string) => {
    setUrl(prev => prev + `{${variableName}}`);
  }, []);

  return {
    // Form state
    name,
    setName,
    url,
    tags,
    setTags,
    nameError,
    urlError,
    submitting,

    // Available variables
    availableVariables,
    loadingConfigKeys,

    // Autocomplete state
    autocompleteOpen,
    autocompleteAnchor,
    filteredVariables,
    selectedIndex,
    hoveredIndex,
    setHoveredIndex,
    menuListRef,

    // Handlers
    handleUrlChange,
    handleVariableSelect,
    handleAutocompleteClose,
    handleKeyDown,
    handleSubmit,
    insertVariable,
  };
}
