import { ApiProperty } from '@nestjs/swagger';
import type { SeriesGroupingPreset } from '@perfana/shared/utils';

export class SeriesGroupingPreviewPanelDto {
  @ApiProperty() panelId!: number;
  @ApiProperty({ nullable: true, type: String }) panelTitle!: string | null;
  @ApiProperty({ type: [String], description: 'Raw series names of the run, sorted' })
  currentNames!: string[];
  @ApiProperty({ type: [String], description: 'Raw series names of the baseline runs, sorted, de-duplicated' })
  baselineNames!: string[];
}

export class SeriesGroupingSloWarningDto {
  @ApiProperty() benchmarkId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() matchPattern!: string;
}

export class SeriesGroupingAlignmentDto {
  @ApiProperty() panelId!: number;
  @ApiProperty() group!: string;
  @ApiProperty() members!: number;
  @ApiProperty({ type: Number }) avgMembers!: number;
}

export class SeriesGroupingPreviewResponseDto {
  @ApiProperty({ description: 'Canonical `test_run_id` of the run the preview was computed for' })
  testRunId!: string;
  @ApiProperty({ type: [String] }) baselineRunIds!: string[];
  @ApiProperty({ type: [SeriesGroupingPreviewPanelDto] }) panels!: SeriesGroupingPreviewPanelDto[];
  @ApiProperty({ type: [SeriesGroupingSloWarningDto] }) sloWarnings!: SeriesGroupingSloWarningDto[];
  @ApiProperty({ type: [String] }) rawNameCollisions!: string[];
  @ApiProperty({ type: [SeriesGroupingAlignmentDto] }) alignment!: SeriesGroupingAlignmentDto[];
}

export class SeriesGroupingSuggestionDto {
  @ApiProperty() applicationDashboardId!: string;
  @ApiProperty({ nullable: true, type: String }) dashboardLabel!: string | null;
  @ApiProperty() panelId!: number;
  @ApiProperty({ nullable: true, type: String }) panelTitle!: string | null;
  @ApiProperty() incomparableCount!: number;
  @ApiProperty({ enum: ['k8s-pod', 'k8s-daemonset', 'ip-port', 'trailing-id'] }) preset!: SeriesGroupingPreset;
  @ApiProperty({ description: 'Fraction 0..1 of the run\'s names the baseline already has' }) matchedBefore!: number;
  @ApiProperty({ description: 'Fraction 0..1 of the run\'s groups the baseline has, after the preset' })
  matchedAfter!: number;
}

export type SeriesGroupingStaleReason = 'not-applied' | 'rule-changed' | 'rule-removed';

export class SeriesGroupingStaleDto {
  @ApiProperty() applicationDashboardId!: string;
  @ApiProperty() panelId!: number;
  @ApiProperty({ enum: ['not-applied', 'rule-changed', 'rule-removed'] }) reason!: SeriesGroupingStaleReason;
}

export class SeriesGroupingMisalignedDto {
  @ApiProperty() applicationDashboardId!: string;
  @ApiProperty() panelId!: number;
  @ApiProperty() group!: string;
  @ApiProperty() members!: number;
  @ApiProperty() avgMembers!: number;
}

export class SeriesGroupingStatusDto {
  @ApiProperty({ type: [SeriesGroupingStaleDto] }) stale!: SeriesGroupingStaleDto[];
  @ApiProperty({ type: [SeriesGroupingMisalignedDto] }) misaligned!: SeriesGroupingMisalignedDto[];
}

export class SeriesGroupingApplySkipDto {
  @ApiProperty() testRunId!: string;
  @ApiProperty() completed!: boolean;
  @ApiProperty({ enum: ['running', 'too-short', 'not-writable'], required: false }) skipped?:
    | 'running'
    | 'too-short'
    | 'not-writable';
}

export class SeriesGroupingApplyResultDto {
  @ApiProperty({ type: [String], description: 'Canonical `test_run_id`s handed to the re-evaluate batch' })
  enqueued!: string[];
  @ApiProperty({ type: [SeriesGroupingApplySkipDto] }) skipped!: SeriesGroupingApplySkipDto[];
}
