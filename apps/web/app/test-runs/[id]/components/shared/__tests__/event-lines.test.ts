/**
 * Unit tests for event-lines utility functions
 *
 * Tests Plotly shape and annotation generation for event markers:
 * - createEventShapes: Vertical dashed lines at event timestamps
 * - createEventAnnotations: Event labels with hover text
 * - mergeEventShapesIntoLayout: Merge shapes/annotations into standard layout
 * - mergeEventShapesIntoIndexedLayout: Merge shapes/annotations into index-based layout with binary search
 * - Edge cases: Empty events, empty layouts, timestamp edge cases, binary search boundary conditions
 */

import {
  createEventShapes,
  createEventAnnotations,
  mergeEventShapesIntoLayout,
  mergeEventShapesIntoIndexedLayout,
} from '../event-lines';
import { PerfanaEvent } from '@/lib/events';

describe('event-lines Utility Functions', () => {
  const mockEvents: PerfanaEvent[] = [
    {
      id: 'event-1',
      title: 'Deployment Started',
      description: 'Production deployment initiated',
      systemUnderTestId: 'system-1',
      testEnvironment: 'production',
      timestamp: '2024-01-15T10:00:00Z',
      tags: ['deployment', 'production'],
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T09:00:00Z',
    },
    {
      id: 'event-2',
      title: 'Cache Cleared',
      systemUnderTestId: 'system-1',
      testEnvironment: 'production',
      timestamp: '2024-01-15T10:30:00Z',
      createdAt: '2024-01-15T09:30:00Z',
      updatedAt: '2024-01-15T09:30:00Z',
    },
    {
      id: 'event-3',
      title: 'Load Test Complete',
      description: 'All test scenarios completed successfully',
      systemUnderTestId: 'system-1',
      testEnvironment: 'production',
      timestamp: '2024-01-15T11:00:00Z',
      tags: ['testing', 'complete'],
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    },
  ];

  describe('createEventShapes', () => {
    describe('Happy Path Scenarios', () => {
      it('should create vertical line shapes for each event', () => {
        const shapes = createEventShapes(mockEvents);

        expect(shapes).toHaveLength(3);
        expect(shapes[0].type).toBe('line');
        expect(shapes[1].type).toBe('line');
        expect(shapes[2].type).toBe('line');
      });

      it('should create shapes with correct coordinate references', () => {
        const shapes = createEventShapes(mockEvents);

        shapes.forEach(shape => {
          expect(shape.xref).toBe('x');
          expect(shape.yref).toBe('paper');
        });
      });

      it('should create vertical lines from y0=0 to y1=1', () => {
        const shapes = createEventShapes(mockEvents);

        shapes.forEach(shape => {
          expect(shape.y0).toBe(0);
          expect(shape.y1).toBe(1);
        });
      });

      it('should use event timestamps as x-coordinates', () => {
        const shapes = createEventShapes(mockEvents);

        expect(shapes[0].x0).toEqual(new Date('2024-01-15T10:00:00Z'));
        expect(shapes[0].x1).toEqual(new Date('2024-01-15T10:00:00Z'));
        expect(shapes[1].x0).toEqual(new Date('2024-01-15T10:30:00Z'));
        expect(shapes[1].x1).toEqual(new Date('2024-01-15T10:30:00Z'));
      });

      it('should apply correct line styling', () => {
        const shapes = createEventShapes(mockEvents);

        shapes.forEach(shape => {
          expect(shape.line.color).toBe('rgba(255, 152, 0, 0.7)');
          expect(shape.line.width).toBe(1.5);
          expect(shape.line.dash).toBe('dot');
        });
      });

      it('should create single shape for single event', () => {
        const singleEvent = [mockEvents[0]];
        const shapes = createEventShapes(singleEvent);

        expect(shapes).toHaveLength(1);
        expect(shapes[0].x0).toEqual(new Date(singleEvent[0].timestamp));
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array for empty events', () => {
        const shapes = createEventShapes([]);

        expect(shapes).toEqual([]);
      });

      it('should handle events with same timestamp', () => {
        const duplicateEvents: PerfanaEvent[] = [
          { ...mockEvents[0], id: 'event-1' },
          { ...mockEvents[0], id: 'event-2', title: 'Different Title' },
        ];

        const shapes = createEventShapes(duplicateEvents);

        expect(shapes).toHaveLength(2);
        expect(shapes[0].x0).toEqual(shapes[1].x0);
      });

      it('should handle events with invalid timestamps gracefully', () => {
        const eventWithInvalidDate: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: 'invalid-date',
        };

        const shapes = createEventShapes([eventWithInvalidDate]);

        expect(shapes).toHaveLength(1);
        // Should create Invalid Date object
        expect(shapes[0].x0).toBeInstanceOf(Date);
        expect(isNaN((shapes[0].x0 as Date).getTime())).toBe(true);
      });
    });
  });

  describe('createEventAnnotations', () => {
    describe('Happy Path Scenarios', () => {
      it('should create annotations for each event', () => {
        const annotations = createEventAnnotations(mockEvents);

        expect(annotations).toHaveLength(3);
      });

      it('should use event titles as text', () => {
        const annotations = createEventAnnotations(mockEvents);

        expect(annotations[0].text).toBe('Deployment Started');
        expect(annotations[1].text).toBe('Cache Cleared');
        expect(annotations[2].text).toBe('Load Test Complete');
      });

      it('should position annotations at y=1 (top of chart)', () => {
        const annotations = createEventAnnotations(mockEvents);

        annotations.forEach(annotation => {
          expect(annotation.y).toBe(1);
          expect(annotation.yref).toBe('paper');
        });
      });

      it('should use event timestamps as x-coordinates', () => {
        const annotations = createEventAnnotations(mockEvents);

        expect(annotations[0].x).toEqual(new Date('2024-01-15T10:00:00Z'));
        expect(annotations[1].x).toEqual(new Date('2024-01-15T10:30:00Z'));
        expect(annotations[2].x).toEqual(new Date('2024-01-15T11:00:00Z'));
      });

      it('should apply correct text styling', () => {
        const annotations = createEventAnnotations(mockEvents);

        annotations.forEach(annotation => {
          expect(annotation.font.size).toBe(10);
          expect(annotation.font.color).toBe('#e65100');
          expect(annotation.textangle).toBe(-30);
          expect(annotation.xanchor).toBe('left');
          expect(annotation.yanchor).toBe('bottom');
        });
      });

      it('should have no arrows', () => {
        const annotations = createEventAnnotations(mockEvents);

        annotations.forEach(annotation => {
          expect(annotation.showarrow).toBe(false);
        });
      });

      it('should have background styling', () => {
        const annotations = createEventAnnotations(mockEvents);

        annotations.forEach(annotation => {
          expect(annotation.bgcolor).toBe('rgba(255, 243, 224, 0.85)');
          expect(annotation.borderpad).toBe(2);
        });
      });

      it('should have hover label styling', () => {
        const annotations = createEventAnnotations(mockEvents);

        annotations.forEach(annotation => {
          expect(annotation.hoverlabel.bgcolor).toBe('#fff3e0');
          expect(annotation.hoverlabel.bordercolor).toBe('#ff9800');
          expect(annotation.hoverlabel.font.size).toBe(12);
          expect(annotation.hoverlabel.font.color).toBe('#333');
          expect(annotation.hoverlabel.font.family).toBe('Roboto, sans-serif');
        });
      });
    });

    describe('Hover Text Generation', () => {
      it('should include title and formatted timestamp in hover text', () => {
        const annotations = createEventAnnotations([mockEvents[0]]);

        expect(annotations[0].hovertext).toContain('<b>Deployment Started</b>');
        expect(annotations[0].hovertext).toContain('Jan'); // Month
        expect(annotations[0].hovertext).toContain('15'); // Day
        expect(annotations[0].hovertext).toContain('2024'); // Year
      });

      it('should include description in hover text when present', () => {
        const annotations = createEventAnnotations([mockEvents[0]]);

        expect(annotations[0].hovertext).toContain('<i>Production deployment initiated</i>');
      });

      it('should omit description from hover text when not present', () => {
        const eventWithoutDescription = mockEvents[1]; // Cache Cleared has no description
        const annotations = createEventAnnotations([eventWithoutDescription]);

        expect(annotations[0].hovertext).not.toContain('<i>');
      });

      it('should include tags in hover text when present', () => {
        const annotations = createEventAnnotations([mockEvents[0]]);

        expect(annotations[0].hovertext).toContain('deployment, production');
      });

      it('should omit tags from hover text when not present', () => {
        const eventWithoutTags: PerfanaEvent = {
          ...mockEvents[0],
          tags: undefined,
        };
        const annotations = createEventAnnotations([eventWithoutTags]);

        // Should still have title and description, but no tags line at the end
        const lines = annotations[0].hovertext.split('<br>');
        // title, timestamp, description = 3 lines (no tags line)
        expect(lines.length).toBe(3);
        // Last line should be the description, not tags
        expect(lines[2]).toContain('<i>');
      });

      it('should handle empty tags array', () => {
        const eventWithEmptyTags: PerfanaEvent = {
          ...mockEvents[0],
          tags: [],
        };
        const annotations = createEventAnnotations([eventWithEmptyTags]);

        // Should not include empty tags line
        const lines = annotations[0].hovertext.split('<br>');
        // title, timestamp, description = 3 lines (empty tags array doesn't add a line)
        expect(lines.length).toBe(3);
      });

      it('should format hover text with line breaks', () => {
        const annotations = createEventAnnotations([mockEvents[0]]);

        const lines = annotations[0].hovertext.split('<br>');
        expect(lines.length).toBeGreaterThan(1);
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array for empty events', () => {
        const annotations = createEventAnnotations([]);

        expect(annotations).toEqual([]);
      });

      it('should handle events with minimal data', () => {
        const minimalEvent: PerfanaEvent = {
          id: 'minimal',
          title: 'Minimal Event',
          systemUnderTestId: 'system-1',
          testEnvironment: 'test',
          timestamp: '2024-01-15T12:00:00Z',
          createdAt: '2024-01-15T11:00:00Z',
          updatedAt: '2024-01-15T11:00:00Z',
        };

        const annotations = createEventAnnotations([minimalEvent]);

        expect(annotations).toHaveLength(1);
        expect(annotations[0].text).toBe('Minimal Event');
      });
    });
  });

  describe('mergeEventShapesIntoLayout', () => {
    describe('Happy Path Scenarios', () => {
      it('should merge event shapes and annotations into empty layout', () => {
        const layout = {};
        const result = mergeEventShapesIntoLayout(layout, mockEvents);

        expect(result.shapes).toHaveLength(3);
        expect(result.annotations).toHaveLength(3);
      });

      it('should preserve existing shapes and annotations', () => {
        const existingShape = { type: 'rect', x0: 0, x1: 1, y0: 0, y1: 1 };
        const existingAnnotation = { x: 0, y: 0, text: 'Existing' };
        const layout = {
          shapes: [existingShape],
          annotations: [existingAnnotation],
        };

        const result = mergeEventShapesIntoLayout(layout, mockEvents);

        expect(result.shapes).toHaveLength(4); // 1 existing + 3 events
        expect(result.annotations).toHaveLength(4); // 1 existing + 3 events
        expect(result.shapes[0]).toEqual(existingShape);
        expect(result.annotations[0]).toEqual(existingAnnotation);
      });

      it('should preserve other layout properties', () => {
        const layout = {
          title: 'My Chart',
          xaxis: { title: 'Time' },
          yaxis: { title: 'Value' },
        };

        const result = mergeEventShapesIntoLayout(layout, mockEvents);

        expect(result.title).toBe('My Chart');
        expect(result.xaxis).toEqual({ title: 'Time' });
        expect(result.yaxis).toEqual({ title: 'Value' });
      });

      it('should create new layout object without mutating original', () => {
        const layout = { title: 'Original' };
        const result = mergeEventShapesIntoLayout(layout, mockEvents);

        expect(result).not.toBe(layout);
        expect(layout.shapes).toBeUndefined();
        expect(result.shapes).toHaveLength(3);
      });
    });

    describe('Edge Cases', () => {
      it('should return unchanged layout when events is empty array', () => {
        const layout = { title: 'My Chart' };
        const result = mergeEventShapesIntoLayout(layout, []);

        expect(result).toEqual(layout);
        expect(result.shapes).toBeUndefined();
        expect(result.annotations).toBeUndefined();
      });

      it('should return unchanged layout when events is null', () => {
        const layout = { title: 'My Chart' };
        const result = mergeEventShapesIntoLayout(layout, null as any);

        expect(result).toEqual(layout);
      });

      it('should return unchanged layout when events is undefined', () => {
        const layout = { title: 'My Chart' };
        const result = mergeEventShapesIntoLayout(layout, undefined as any);

        expect(result).toEqual(layout);
      });

      it('should handle empty shapes array in layout', () => {
        const layout = { shapes: [] };
        const result = mergeEventShapesIntoLayout(layout, [mockEvents[0]]);

        expect(result.shapes).toHaveLength(1);
      });

      it('should handle empty annotations array in layout', () => {
        const layout = { annotations: [] };
        const result = mergeEventShapesIntoLayout(layout, [mockEvents[0]]);

        expect(result.annotations).toHaveLength(1);
      });
    });
  });

  describe('mergeEventShapesIntoIndexedLayout', () => {
    const sortedTimestamps = [
      '2024-01-15T10:00:00Z',
      '2024-01-15T10:15:00Z',
      '2024-01-15T10:30:00Z',
      '2024-01-15T10:45:00Z',
      '2024-01-15T11:00:00Z',
    ];

    describe('Happy Path Scenarios', () => {
      it('should merge event shapes and annotations into empty layout with indices', () => {
        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, mockEvents, sortedTimestamps);

        expect(result.shapes).toHaveLength(3);
        expect(result.annotations).toHaveLength(3);
      });

      it('should map event timestamps to closest indices', () => {
        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [mockEvents[0]], sortedTimestamps);

        // Event at 10:00:00 should map to index 0
        expect(result.shapes[0].x0).toBe(0);
        expect(result.shapes[0].x1).toBe(0);
        expect(result.annotations[0].x).toBe(0);
      });

      it('should use integer indices as x-coordinates', () => {
        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, mockEvents, sortedTimestamps);

        result.shapes.forEach(shape => {
          expect(typeof shape.x0 === 'number').toBe(true);
          expect(typeof shape.x1 === 'number').toBe(true);
        });

        result.annotations.forEach(annotation => {
          expect(typeof annotation.x === 'number').toBe(true);
        });
      });

      it('should preserve existing shapes and annotations', () => {
        const existingShape = { type: 'rect', x0: 0, x1: 1, y0: 0, y1: 1 };
        const existingAnnotation = { x: 0, y: 0, text: 'Existing' };
        const layout = {
          shapes: [existingShape],
          annotations: [existingAnnotation],
        };

        const result = mergeEventShapesIntoIndexedLayout(layout, [mockEvents[0]], sortedTimestamps);

        expect(result.shapes[0]).toEqual(existingShape);
        expect(result.annotations[0]).toEqual(existingAnnotation);
      });

      it('should apply correct line styling to indexed shapes', () => {
        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [mockEvents[0]], sortedTimestamps);

        expect(result.shapes[0].line.color).toBe('rgba(255, 152, 0, 0.7)');
        expect(result.shapes[0].line.width).toBe(1.5);
        expect(result.shapes[0].line.dash).toBe('dot');
      });
    });

    describe('Binary Search Index Finding', () => {
      it('should map event exactly at first timestamp to index 0', () => {
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T10:00:00Z', // Exactly at index 0
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], sortedTimestamps);

        expect(result.shapes[0].x0).toBe(0);
      });

      it('should map event exactly at last timestamp to last index', () => {
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T11:00:00Z', // Exactly at index 4
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], sortedTimestamps);

        expect(result.shapes[0].x0).toBe(4);
      });

      it('should map event between timestamps to interpolated index', () => {
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T10:22:30Z', // Between index 1 (10:15) and 2 (10:30)
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], sortedTimestamps);

        // Should be between 1 and 2, closer to 2 (10:30)
        expect(result.shapes[0].x0).toBeGreaterThan(1);
        expect(result.shapes[0].x0).toBeLessThan(2);
      });

      it('should map event before first timestamp to index 0', () => {
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T09:00:00Z', // Before all timestamps
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], sortedTimestamps);

        expect(result.shapes[0].x0).toBe(0);
      });

      it('should map event after last timestamp to last index', () => {
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T12:00:00Z', // After all timestamps
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], sortedTimestamps);

        expect(result.shapes[0].x0).toBe(4);
      });

      it('should handle multiple events mapping to different indices', () => {
        const events: PerfanaEvent[] = [
          { ...mockEvents[0], timestamp: '2024-01-15T10:00:00Z' }, // Index 0
          { ...mockEvents[1], timestamp: '2024-01-15T10:30:00Z' }, // Index 2
          { ...mockEvents[2], timestamp: '2024-01-15T11:00:00Z' }, // Index 4
        ];

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, events, sortedTimestamps);

        expect(result.shapes[0].x0).toBe(0);
        expect(result.shapes[1].x0).toBe(2);
        expect(result.shapes[2].x0).toBe(4);
      });
    });

    describe('Edge Cases', () => {
      it('should return unchanged layout when events is empty', () => {
        const layout = { title: 'My Chart' };
        const result = mergeEventShapesIntoIndexedLayout(layout, [], sortedTimestamps);

        expect(result).toEqual(layout);
      });

      it('should return unchanged layout when sortedTimestamps is empty', () => {
        const layout = { title: 'My Chart' };
        const result = mergeEventShapesIntoIndexedLayout(layout, mockEvents, []);

        expect(result).toEqual(layout);
      });

      it('should return unchanged layout when both events and timestamps are empty', () => {
        const layout = { title: 'My Chart' };
        const result = mergeEventShapesIntoIndexedLayout(layout, [], []);

        expect(result).toEqual(layout);
      });

      it('should handle single timestamp', () => {
        const singleTimestamp = ['2024-01-15T10:00:00Z'];
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T10:00:00Z',
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], singleTimestamp);

        expect(result.shapes[0].x0).toBe(0);
      });

      it('should handle event at exact midpoint between two timestamps', () => {
        const timestamps = ['2024-01-15T10:00:00Z', '2024-01-15T10:30:00Z'];
        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T10:15:00Z', // Exact midpoint
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], timestamps);

        // Should be 0.5 (midpoint between 0 and 1)
        expect(result.shapes[0].x0).toBe(0.5);
      });

      it('should skip events that cannot be mapped', () => {
        // This shouldn't happen in practice, but tests null handling in findClosestIndex
        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, mockEvents, sortedTimestamps);

        // All events should be mapped successfully
        expect(result.shapes.length).toBeGreaterThan(0);
        expect(result.annotations.length).toBeGreaterThan(0);
      });

      it('should not mutate original layout', () => {
        const layout = { title: 'Original' };
        const result = mergeEventShapesIntoIndexedLayout(layout, [mockEvents[0]], sortedTimestamps);

        expect(result).not.toBe(layout);
        expect(layout.shapes).toBeUndefined();
        expect(result.shapes).toHaveLength(1);
      });

      it('should handle duplicate timestamps in sorted array', () => {
        const timestampsWithDuplicates = [
          '2024-01-15T10:00:00Z',
          '2024-01-15T10:00:00Z', // Duplicate
          '2024-01-15T10:30:00Z',
        ];

        const event: PerfanaEvent = {
          ...mockEvents[0],
          timestamp: '2024-01-15T10:00:00Z',
        };

        const layout = {};
        const result = mergeEventShapesIntoIndexedLayout(layout, [event], timestampsWithDuplicates);

        // Should still create a shape
        expect(result.shapes).toHaveLength(1);
      });
    });
  });
});
