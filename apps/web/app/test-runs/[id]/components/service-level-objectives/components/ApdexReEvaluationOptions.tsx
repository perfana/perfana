'use client';

import {
  Box,
  Typography,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
} from '@mui/material';
import { ReEvaluateOption } from '../types/apdex-thresholds.types';

interface ApdexReEvaluationOptionsProps {
  reEvaluateOption: ReEvaluateOption;
  onReEvaluateOptionChange: (option: ReEvaluateOption) => void;
}

export function ApdexReEvaluationOptions({
  reEvaluateOption,
  onReEvaluateOptionChange,
}: ApdexReEvaluationOptionsProps) {
  return (
    <Box sx={{ mt: 3 }}>
      <FormControl component="fieldset">
        <FormLabel component="legend">
          <Typography variant="h6" gutterBottom>
            After Applying
          </Typography>
        </FormLabel>
        <RadioGroup
          value={reEvaluateOption}
          onChange={(e) => onReEvaluateOptionChange(e.target.value as ReEvaluateOption)}
        >
          <FormControlLabel
            value="none"
            control={<Radio size="small" />}
            label="Save without re-evaluation"
          />
          <FormControlLabel
            value="current"
            control={<Radio size="small" />}
            label="Re-evaluate this test run"
          />
          <FormControlLabel
            value="all"
            control={<Radio size="small" />}
            label="Re-evaluate all test runs (up to changepoint)"
          />
        </RadioGroup>
      </FormControl>
    </Box>
  );
}

export default ApdexReEvaluationOptions;
