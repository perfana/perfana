'use client';

import {
  Box,
  Typography,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { VariableDefinition, BASE_VARIABLES, URL_EXAMPLES } from '../types';

interface VariablesAccordionProps {
  availableVariables: VariableDefinition[];
  loadingConfigKeys: boolean;
  onInsertVariable: (variableName: string) => void;
}

export function VariablesAccordion({
  availableVariables,
  loadingConfigKeys,
  onInsertVariable,
}: VariablesAccordionProps) {
  const configVariables = availableVariables.filter(
    variable => !BASE_VARIABLES.some(baseVar => baseVar.name === variable.name)
  );

  return (
    <Accordion sx={{ mb: 2 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InfoIcon color="primary" fontSize="small" />
          <Typography variant="subtitle2">Available Variables</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Click on any variable to insert it into your URL:
        </Typography>

        {/* Built-in Variables */}
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Built-in Variables
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
          {BASE_VARIABLES.map((variable) => (
            <Chip
              key={variable.name}
              label={`{${variable.name}}`}
              variant="outlined"
              size="small"
              clickable
              onClick={() => onInsertVariable(variable.name)}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                '&:hover': {
                  backgroundColor: 'primary.main',
                  color: 'primary.contrastText',
                },
              }}
              title={variable.example ? `${variable.description} — e.g. ${variable.example}` : variable.description}
            />
          ))}
        </Box>

        {/* Configuration Variables */}
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Configuration Variables
          {loadingConfigKeys && <CircularProgress size={16} sx={{ ml: 1 }} />}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {configVariables.map((variable) => (
            <Chip
              key={variable.name}
              label={`{${variable.name}}`}
              variant="outlined"
              size="small"
              clickable
              onClick={() => onInsertVariable(variable.name)}
              color="secondary"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                '&:hover': {
                  backgroundColor: 'secondary.main',
                  color: 'secondary.contrastText',
                },
              }}
              title={variable.description}
            />
          ))}
          {!loadingConfigKeys && configVariables.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No configuration keys found from latest test run
            </Typography>
          )}
        </Box>

        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>Examples:</strong>
          </Typography>
          <Typography
            variant="body2"
            component="div"
            sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.875rem' }}
          >
            {URL_EXAMPLES.map((example, index) => (
              <span key={example.label}>
                {'\u2022'} {example.label}: <code>{example.template}</code>
                {index < URL_EXAMPLES.length - 1 && <br />}
              </span>
            ))}
          </Typography>
        </Alert>
      </AccordionDetails>
    </Accordion>
  );
}
