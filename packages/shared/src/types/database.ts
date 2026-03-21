export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          api_key: string
          created_at: string | null
          description: string
          id: string
          updated_at: string | null
          valid_until: string | null
        }
        Insert: {
          api_key: string
          created_at?: string | null
          description: string
          id?: string
          updated_at?: string | null
          valid_until?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string | null
          description?: string
          id?: string
          updated_at?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      application_test_environments: {
        Row: {
          application_id: string
          created_at: string | null
          id: string
          name: string
          pyroscope_application: string | null
          tracing_service: string | null
        }
        Insert: {
          application_id: string
          created_at?: string | null
          id?: string
          name: string
          pyroscope_application?: string | null
          tracing_service?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string | null
          id?: string
          name?: string
          pyroscope_application?: string | null
          tracing_service?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_test_environments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_test_types: {
        Row: {
          application_test_environment_id: string
          config: Json | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          application_test_environment_id: string
          config?: Json | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          application_test_environment_id?: string
          config?: Json | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_test_types_application_test_environment_id_fkey"
            columns: ["application_test_environment_id"]
            isOneToOne: false
            referencedRelation: "application_test_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          created_at: string | null
          description: string
          id: string
          name: string
          pyroscope_application: string | null
          pyroscope_profiler: string | null
          team_id: string | null
          tracing_service: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          name: string
          pyroscope_application?: string | null
          pyroscope_profiler?: string | null
          team_id?: string | null
          tracing_service?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          name?: string
          pyroscope_application?: string | null
          pyroscope_profiler?: string | null
          team_id?: string | null
          tracing_service?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      configuration: {
        Row: {
          created_at: string | null
          id: string
          key: string
          type: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          type: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          type?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: []
      }
      data_sources: {
        Row: {
          connection_config: Json
          created_at: string | null
          health_status: string | null
          id: string
          instance_name: string
          is_active: boolean | null
          last_health_check: string | null
          organization_id: string
          query_rate_limit: number | null
          source_type: string
          supports_historical: boolean | null
          supports_real_time: boolean | null
          updated_at: string | null
        }
        Insert: {
          connection_config: Json
          created_at?: string | null
          health_status?: string | null
          id?: string
          instance_name: string
          is_active?: boolean | null
          last_health_check?: string | null
          organization_id: string
          query_rate_limit?: number | null
          source_type: string
          supports_historical?: boolean | null
          supports_real_time?: boolean | null
          updated_at?: string | null
        }
        Update: {
          connection_config?: Json
          created_at?: string | null
          health_status?: string | null
          id?: string
          instance_name?: string
          is_active?: boolean | null
          last_health_check?: string | null
          organization_id?: string
          query_rate_limit?: number | null
          source_type?: string
          supports_historical?: boolean | null
          supports_real_time?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_adapt_conclusions: {
        Row: {
          adapt_result_id: string
          conclusion_data: Json
          created_at: string | null
          id: string
        }
        Insert: {
          adapt_result_id: string
          conclusion_data: Json
          created_at?: string | null
          id?: string
        }
        Update: {
          adapt_result_id?: string
          conclusion_data?: Json
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ds_adapt_conclusions_adapt_result_id_fkey"
            columns: ["adapt_result_id"]
            isOneToOne: false
            referencedRelation: "ds_adapt_results"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_adapt_results: {
        Row: {
          adapt_results: Json
          application_dashboard_id: string
          benchmark_id: string | null
          conclusion: string | null
          conclusion_details: Json | null
          control_group_id: string | null
          created_at: string | null
          id: string
          panel_id: string
          test_run_id: string
          updated_at: string | null
        }
        Insert: {
          adapt_results: Json
          application_dashboard_id: string
          benchmark_id?: string | null
          conclusion?: string | null
          conclusion_details?: Json | null
          control_group_id?: string | null
          created_at?: string | null
          id?: string
          panel_id: string
          test_run_id: string
          updated_at?: string | null
        }
        Update: {
          adapt_results?: Json
          application_dashboard_id?: string
          benchmark_id?: string | null
          conclusion?: string | null
          conclusion_details?: Json | null
          control_group_id?: string | null
          created_at?: string | null
          id?: string
          panel_id?: string
          test_run_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ds_adapt_results_control_group_id_fkey"
            columns: ["control_group_id"]
            isOneToOne: false
            referencedRelation: "ds_control_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ds_adapt_results_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_adapt_tracked_results: {
        Row: {
          adapt_result_id: string
          created_at: string | null
          id: string
          tracked_data: Json
        }
        Insert: {
          adapt_result_id: string
          created_at?: string | null
          id?: string
          tracked_data: Json
        }
        Update: {
          adapt_result_id?: string
          created_at?: string | null
          id?: string
          tracked_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ds_adapt_tracked_results_adapt_result_id_fkey"
            columns: ["adapt_result_id"]
            isOneToOne: false
            referencedRelation: "ds_adapt_results"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_change_points: {
        Row: {
          application_dashboard_id: string
          benchmark_id: string | null
          change_point_data: Json
          change_point_time: string
          created_at: string | null
          id: string
          panel_id: string
        }
        Insert: {
          application_dashboard_id: string
          benchmark_id?: string | null
          change_point_data: Json
          change_point_time: string
          created_at?: string | null
          id?: string
          panel_id: string
        }
        Update: {
          application_dashboard_id?: string
          benchmark_id?: string | null
          change_point_data?: Json
          change_point_time?: string
          created_at?: string | null
          id?: string
          panel_id?: string
        }
        Relationships: []
      }
      ds_compare_config: {
        Row: {
          application_dashboard_id: string
          config_data: Json
          created_at: string | null
          id: string
          panel_id: string
          updated_at: string | null
        }
        Insert: {
          application_dashboard_id: string
          config_data: Json
          created_at?: string | null
          id?: string
          panel_id: string
          updated_at?: string | null
        }
        Update: {
          application_dashboard_id?: string
          config_data?: Json
          created_at?: string | null
          id?: string
          panel_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ds_control_group_statistics: {
        Row: {
          control_group_id: string
          id: string
          statistics: Json
          updated_at: string | null
        }
        Insert: {
          control_group_id: string
          id?: string
          statistics: Json
          updated_at?: string | null
        }
        Update: {
          control_group_id?: string
          id?: string
          statistics?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ds_control_group_statistics_control_group_id_fkey"
            columns: ["control_group_id"]
            isOneToOne: true
            referencedRelation: "ds_control_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_control_groups: {
        Row: {
          application_dashboard_id: string
          benchmark_id: string | null
          created_at: string | null
          group_config: Json | null
          id: string
          panel_id: string
          test_run_ids: string[]
          updated_at: string | null
        }
        Insert: {
          application_dashboard_id: string
          benchmark_id?: string | null
          created_at?: string | null
          group_config?: Json | null
          id?: string
          panel_id: string
          test_run_ids: string[]
          updated_at?: string | null
        }
        Update: {
          application_dashboard_id?: string
          benchmark_id?: string | null
          created_at?: string | null
          group_config?: Json | null
          id?: string
          panel_id?: string
          test_run_ids?: string[]
          updated_at?: string | null
        }
        Relationships: []
      }
      ds_metric_statistics: {
        Row: {
          application_dashboard_id: string
          benchmark_id: string | null
          constant_value: boolean | null
          count: number | null
          id: string
          idr: number | null
          iqr: number | null
          max_value: number | null
          mean: number | null
          median: number | null
          min_value: number | null
          missing_percentage: number | null
          panel_id: string
          percentiles: Json | null
          std_dev: number | null
          test_run_id: string
          updated_at: string | null
        }
        Insert: {
          application_dashboard_id: string
          benchmark_id?: string | null
          constant_value?: boolean | null
          count?: number | null
          id?: string
          idr?: number | null
          iqr?: number | null
          max_value?: number | null
          mean?: number | null
          median?: number | null
          min_value?: number | null
          missing_percentage?: number | null
          panel_id: string
          percentiles?: Json | null
          std_dev?: number | null
          test_run_id: string
          updated_at?: string | null
        }
        Update: {
          application_dashboard_id?: string
          benchmark_id?: string | null
          constant_value?: boolean | null
          count?: number | null
          id?: string
          idr?: number | null
          iqr?: number | null
          max_value?: number | null
          mean?: number | null
          median?: number | null
          min_value?: number | null
          missing_percentage?: number | null
          panel_id?: string
          percentiles?: Json | null
          std_dev?: number | null
          test_run_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ds_metric_statistics_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_metrics: {
        Row: {
          collected_at: string | null
          dimensions: Json | null
          is_ramp_up: boolean | null
          metric_name: string
          metric_path: string | null
          query_execution_id: string
          source_instance: string
          source_type: string
          test_run_id: string
          time: string
          timestep: number | null
          unit: string | null
          value: number
        }
        Insert: {
          collected_at?: string | null
          dimensions?: Json | null
          is_ramp_up?: boolean | null
          metric_name: string
          metric_path?: string | null
          query_execution_id: string
          source_instance: string
          source_type: string
          test_run_id: string
          time: string
          timestep?: number | null
          unit?: string | null
          value: number
        }
        Update: {
          collected_at?: string | null
          dimensions?: Json | null
          is_ramp_up?: boolean | null
          metric_name?: string
          metric_path?: string | null
          query_execution_id?: string
          source_instance?: string
          source_type?: string
          test_run_id?: string
          time?: string
          timestep?: number | null
          unit?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "ds_metrics_query_execution_id_fkey"
            columns: ["query_execution_id"]
            isOneToOne: false
            referencedRelation: "ds_query_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ds_metrics_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_queries: {
        Row: {
          avg_execution_time_ms: number | null
          created_at: string | null
          execution_timeout: number | null
          expected_metrics: string[] | null
          id: string
          is_active: boolean | null
          last_execution_time: string | null
          query_definition: Json
          query_hash: string
          query_name: string | null
          query_parameters: Json | null
          retry_count: number | null
          source_instance: string
          source_type: string
          success_rate: number | null
          target_reference: Json | null
          updated_at: string | null
        }
        Insert: {
          avg_execution_time_ms?: number | null
          created_at?: string | null
          execution_timeout?: number | null
          expected_metrics?: string[] | null
          id?: string
          is_active?: boolean | null
          last_execution_time?: string | null
          query_definition: Json
          query_hash: string
          query_name?: string | null
          query_parameters?: Json | null
          retry_count?: number | null
          source_instance: string
          source_type: string
          success_rate?: number | null
          target_reference?: Json | null
          updated_at?: string | null
        }
        Update: {
          avg_execution_time_ms?: number | null
          created_at?: string | null
          execution_timeout?: number | null
          expected_metrics?: string[] | null
          id?: string
          is_active?: boolean | null
          last_execution_time?: string | null
          query_definition?: Json
          query_hash?: string
          query_name?: string | null
          query_parameters?: Json | null
          retry_count?: number | null
          source_instance?: string
          source_type?: string
          success_rate?: number | null
          target_reference?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ds_query_executions: {
        Row: {
          created_at: string | null
          data_points_collected: number | null
          error_code: string | null
          error_message: string | null
          executed_at: string | null
          execution_parameters: Json | null
          execution_time_ms: number | null
          id: string
          metrics_stored_count: number | null
          query_id: string
          retry_attempt: number | null
          rows_returned: number | null
          status: string
          test_run_id: string | null
        }
        Insert: {
          created_at?: string | null
          data_points_collected?: number | null
          error_code?: string | null
          error_message?: string | null
          executed_at?: string | null
          execution_parameters?: Json | null
          execution_time_ms?: number | null
          id?: string
          metrics_stored_count?: number | null
          query_id: string
          retry_attempt?: number | null
          rows_returned?: number | null
          status: string
          test_run_id?: string | null
        }
        Update: {
          created_at?: string | null
          data_points_collected?: number | null
          error_code?: string | null
          error_message?: string | null
          executed_at?: string | null
          execution_parameters?: Json | null
          execution_time_ms?: number | null
          id?: string
          metrics_stored_count?: number | null
          query_id?: string
          retry_attempt?: number | null
          rows_returned?: number | null
          status?: string
          test_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ds_query_executions_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "ds_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ds_query_executions_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ds_tracked_differences: {
        Row: {
          application_dashboard_id: string
          benchmark_id: string | null
          created_at: string | null
          difference_data: Json
          id: string
          panel_id: string
          test_run_id: string
        }
        Insert: {
          application_dashboard_id: string
          benchmark_id?: string | null
          created_at?: string | null
          difference_data: Json
          id?: string
          panel_id: string
          test_run_id: string
        }
        Update: {
          application_dashboard_id?: string
          benchmark_id?: string | null
          created_at?: string | null
          difference_data?: Json
          id?: string
          panel_id?: string
          test_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ds_tracked_differences_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      licenses: {
        Row: {
          all_ok: boolean | null
          created_at: string | null
          customer_name: string | null
          id: string
          key: string
          license_type: number | null
          public_key: string | null
          updated_at: string | null
          valid_until: string | null
        }
        Insert: {
          all_ok?: boolean | null
          created_at?: string | null
          customer_name?: string | null
          id?: string
          key: string
          license_type?: number | null
          public_key?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Update: {
          all_ok?: boolean | null
          created_at?: string | null
          customer_name?: string | null
          id?: string
          key?: string
          license_type?: number | null
          public_key?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pending_ds_compare_config_changes: {
        Row: {
          created_at: string | null
          ds_compare_config_id: string
          id: string
          pending_changes: Json
        }
        Insert: {
          created_at?: string | null
          ds_compare_config_id: string
          id?: string
          pending_changes: Json
        }
        Update: {
          created_at?: string | null
          ds_compare_config_id?: string
          id?: string
          pending_changes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pending_ds_compare_config_changes_ds_compare_config_id_fkey"
            columns: ["ds_compare_config_id"]
            isOneToOne: false
            referencedRelation: "ds_compare_config"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          read_only: boolean | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          read_only?: boolean | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          read_only?: boolean | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      test_run_alerts: {
        Row: {
          created_at: string | null
          id: string
          level: string
          message: string
          test_run_id: string
          timestamp: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          level: string
          message: string
          test_run_id: string
          timestamp: string
        }
        Update: {
          created_at?: string | null
          id?: string
          level?: string
          message?: string
          test_run_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_run_alerts_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      test_run_configs: {
        Row: {
          created_at: string | null
          id: string
          key: string
          tags: string[] | null
          test_run_id: string
          value: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          tags?: string[] | null
          test_run_id: string
          value?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          tags?: string[] | null
          test_run_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_run_configs_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      test_run_events: {
        Row: {
          created_at: string | null
          event_data: Json
          id: string
          test_run_id: string
          timestamp: string
        }
        Insert: {
          created_at?: string | null
          event_data: Json
          id?: string
          test_run_id: string
          timestamp: string
        }
        Update: {
          created_at?: string | null
          event_data?: Json
          id?: string
          test_run_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_run_events_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      test_runs: {
        Row: {
          abort: boolean | null
          adapt_config: Json | null
          annotations: string[] | null
          application_id: string
          application_release: string | null
          ci_build_results_url: string | null
          completed: boolean | null
          consolidated_result: Json | null
          created_at: string | null
          deep_links: Json | null
          duration: number | null
          end_time: string | null
          expired: boolean | null
          expires: string | null
          id: string
          planned_duration: number | null
          ramp_up: number | null
          reasons_not_valid: string[] | null
          start_time: string | null
          status: Json | null
          tags: string[] | null
          test_environment: string
          test_run_id: string
          test_type: string
          updated_at: string | null
          valid: boolean | null
          variables: Json | null
        }
        Insert: {
          abort?: boolean | null
          adapt_config?: Json | null
          annotations?: string[] | null
          application_id: string
          application_release?: string | null
          ci_build_results_url?: string | null
          completed?: boolean | null
          consolidated_result?: Json | null
          created_at?: string | null
          deep_links?: Json | null
          duration?: number | null
          end_time?: string | null
          expired?: boolean | null
          expires?: string | null
          id?: string
          planned_duration?: number | null
          ramp_up?: number | null
          reasons_not_valid?: string[] | null
          start_time?: string | null
          status?: Json | null
          tags?: string[] | null
          test_environment: string
          test_run_id: string
          test_type: string
          updated_at?: string | null
          valid?: boolean | null
          variables?: Json | null
        }
        Update: {
          abort?: boolean | null
          adapt_config?: Json | null
          annotations?: string[] | null
          application_id?: string
          application_release?: string | null
          ci_build_results_url?: string | null
          completed?: boolean | null
          consolidated_result?: Json | null
          created_at?: string | null
          deep_links?: Json | null
          duration?: number | null
          end_time?: string | null
          expired?: boolean | null
          expires?: string | null
          id?: string
          planned_duration?: number | null
          ramp_up?: number | null
          reasons_not_valid?: string[] | null
          start_time?: string | null
          status?: Json | null
          tags?: string[] | null
          test_environment?: string
          test_run_id?: string
          test_type?: string
          updated_at?: string | null
          valid?: boolean | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "test_runs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      versions: {
        Row: {
          component: string
          created_at: string | null
          id: string
          version: string
        }
        Insert: {
          component: string
          created_at?: string | null
          id?: string
          version: string
        }
        Update: {
          component?: string
          created_at?: string | null
          id?: string
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_compression_policy: {
        Args: {
          hypertable: unknown
          compress_after?: unknown
          if_not_exists?: boolean
          schedule_interval?: unknown
          initial_start?: string
          timezone?: string
          compress_created_before?: unknown
        }
        Returns: number
      }
      add_continuous_aggregate_policy: {
        Args: {
          continuous_aggregate: unknown
          start_offset: unknown
          end_offset: unknown
          schedule_interval: unknown
          if_not_exists?: boolean
          initial_start?: string
          timezone?: string
        }
        Returns: number
      }
      add_dimension:
        | {
            Args: {
              hypertable: unknown
              column_name: unknown
              number_partitions?: number
              chunk_time_interval?: unknown
              partitioning_func?: unknown
              if_not_exists?: boolean
            }
            Returns: {
              dimension_id: number
              schema_name: unknown
              table_name: unknown
              column_name: unknown
              created: boolean
            }[]
          }
        | {
            Args: {
              hypertable: unknown
              dimension: unknown
              if_not_exists?: boolean
            }
            Returns: {
              dimension_id: number
              created: boolean
            }[]
          }
      add_job: {
        Args: {
          proc: unknown
          schedule_interval: unknown
          config?: Json
          initial_start?: string
          scheduled?: boolean
          check_config?: unknown
          fixed_schedule?: boolean
          timezone?: string
        }
        Returns: number
      }
      add_reorder_policy: {
        Args: {
          hypertable: unknown
          index_name: unknown
          if_not_exists?: boolean
          initial_start?: string
          timezone?: string
        }
        Returns: number
      }
      add_retention_policy: {
        Args: {
          relation: unknown
          drop_after?: unknown
          if_not_exists?: boolean
          schedule_interval?: unknown
          initial_start?: string
          timezone?: string
          drop_created_before?: unknown
        }
        Returns: number
      }
      alter_job: {
        Args: {
          job_id: number
          schedule_interval?: unknown
          max_runtime?: unknown
          max_retries?: number
          retry_period?: unknown
          scheduled?: boolean
          config?: Json
          next_start?: string
          if_exists?: boolean
          check_config?: unknown
          fixed_schedule?: boolean
          initial_start?: string
          timezone?: string
        }
        Returns: {
          job_id: number
          schedule_interval: unknown
          max_runtime: unknown
          max_retries: number
          retry_period: unknown
          scheduled: boolean
          config: Json
          next_start: string
          check_config: string
          fixed_schedule: boolean
          initial_start: string
          timezone: string
        }[]
      }
      approximate_row_count: {
        Args: {
          relation: unknown
        }
        Returns: number
      }
      attach_tablespace: {
        Args: {
          tablespace: unknown
          hypertable: unknown
          if_not_attached?: boolean
        }
        Returns: undefined
      }
      by_hash: {
        Args: {
          column_name: unknown
          number_partitions: number
          partition_func?: unknown
        }
        Returns: unknown
      }
      by_range: {
        Args: {
          column_name: unknown
          partition_interval?: unknown
          partition_func?: unknown
        }
        Returns: unknown
      }
      chunk_compression_stats: {
        Args: {
          hypertable: unknown
        }
        Returns: {
          chunk_schema: unknown
          chunk_name: unknown
          compression_status: string
          before_compression_table_bytes: number
          before_compression_index_bytes: number
          before_compression_toast_bytes: number
          before_compression_total_bytes: number
          after_compression_table_bytes: number
          after_compression_index_bytes: number
          after_compression_toast_bytes: number
          after_compression_total_bytes: number
          node_name: unknown
        }[]
      }
      chunks_detailed_size: {
        Args: {
          hypertable: unknown
        }
        Returns: {
          chunk_schema: unknown
          chunk_name: unknown
          table_bytes: number
          index_bytes: number
          toast_bytes: number
          total_bytes: number
          node_name: unknown
        }[]
      }
      compress_chunk: {
        Args: {
          uncompressed_chunk: unknown
          if_not_compressed?: boolean
          recompress?: boolean
        }
        Returns: unknown
      }
      create_hypertable:
        | {
            Args: {
              relation: unknown
              dimension: unknown
              create_default_indexes?: boolean
              if_not_exists?: boolean
              migrate_data?: boolean
            }
            Returns: {
              hypertable_id: number
              created: boolean
            }[]
          }
        | {
            Args: {
              relation: unknown
              time_column_name: unknown
              partitioning_column?: unknown
              number_partitions?: number
              associated_schema_name?: unknown
              associated_table_prefix?: unknown
              chunk_time_interval?: unknown
              create_default_indexes?: boolean
              if_not_exists?: boolean
              partitioning_func?: unknown
              migrate_data?: boolean
              chunk_target_size?: string
              chunk_sizing_func?: unknown
              time_partitioning_func?: unknown
            }
            Returns: {
              hypertable_id: number
              schema_name: unknown
              table_name: unknown
              created: boolean
            }[]
          }
      decompress_chunk: {
        Args: {
          uncompressed_chunk: unknown
          if_compressed?: boolean
        }
        Returns: unknown
      }
      delete_job: {
        Args: {
          job_id: number
        }
        Returns: undefined
      }
      detach_tablespace: {
        Args: {
          tablespace: unknown
          hypertable?: unknown
          if_attached?: boolean
        }
        Returns: number
      }
      detach_tablespaces: {
        Args: {
          hypertable: unknown
        }
        Returns: number
      }
      disable_chunk_skipping: {
        Args: {
          hypertable: unknown
          column_name: unknown
          if_not_exists?: boolean
        }
        Returns: {
          hypertable_id: number
          column_name: unknown
          disabled: boolean
        }[]
      }
      drop_chunks: {
        Args: {
          relation: unknown
          older_than?: unknown
          newer_than?: unknown
          verbose?: boolean
          created_before?: unknown
          created_after?: unknown
        }
        Returns: string[]
      }
      enable_chunk_skipping: {
        Args: {
          hypertable: unknown
          column_name: unknown
          if_not_exists?: boolean
        }
        Returns: {
          column_stats_id: number
          enabled: boolean
        }[]
      }
      get_telemetry_report: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      hypertable_approximate_detailed_size: {
        Args: {
          relation: unknown
        }
        Returns: {
          table_bytes: number
          index_bytes: number
          toast_bytes: number
          total_bytes: number
        }[]
      }
      hypertable_approximate_size: {
        Args: {
          hypertable: unknown
        }
        Returns: number
      }
      hypertable_compression_stats: {
        Args: {
          hypertable: unknown
        }
        Returns: {
          total_chunks: number
          number_compressed_chunks: number
          before_compression_table_bytes: number
          before_compression_index_bytes: number
          before_compression_toast_bytes: number
          before_compression_total_bytes: number
          after_compression_table_bytes: number
          after_compression_index_bytes: number
          after_compression_toast_bytes: number
          after_compression_total_bytes: number
          node_name: unknown
        }[]
      }
      hypertable_detailed_size: {
        Args: {
          hypertable: unknown
        }
        Returns: {
          table_bytes: number
          index_bytes: number
          toast_bytes: number
          total_bytes: number
          node_name: unknown
        }[]
      }
      hypertable_index_size: {
        Args: {
          index_name: unknown
        }
        Returns: number
      }
      hypertable_size: {
        Args: {
          hypertable: unknown
        }
        Returns: number
      }
      interpolate:
        | {
            Args: {
              value: number
              prev?: Record<string, unknown>
              next?: Record<string, unknown>
            }
            Returns: number
          }
        | {
            Args: {
              value: number
              prev?: Record<string, unknown>
              next?: Record<string, unknown>
            }
            Returns: number
          }
        | {
            Args: {
              value: number
              prev?: Record<string, unknown>
              next?: Record<string, unknown>
            }
            Returns: number
          }
        | {
            Args: {
              value: number
              prev?: Record<string, unknown>
              next?: Record<string, unknown>
            }
            Returns: number
          }
        | {
            Args: {
              value: number
              prev?: Record<string, unknown>
              next?: Record<string, unknown>
            }
            Returns: number
          }
      locf: {
        Args: {
          value: unknown
          prev?: unknown
          treat_null_as_missing?: boolean
        }
        Returns: unknown
      }
      move_chunk: {
        Args: {
          chunk: unknown
          destination_tablespace: unknown
          index_destination_tablespace?: unknown
          reorder_index?: unknown
          verbose?: boolean
        }
        Returns: undefined
      }
      remove_compression_policy: {
        Args: {
          hypertable: unknown
          if_exists?: boolean
        }
        Returns: boolean
      }
      remove_continuous_aggregate_policy: {
        Args: {
          continuous_aggregate: unknown
          if_not_exists?: boolean
          if_exists?: boolean
        }
        Returns: undefined
      }
      remove_reorder_policy: {
        Args: {
          hypertable: unknown
          if_exists?: boolean
        }
        Returns: undefined
      }
      remove_retention_policy: {
        Args: {
          relation: unknown
          if_exists?: boolean
        }
        Returns: undefined
      }
      reorder_chunk: {
        Args: {
          chunk: unknown
          index?: unknown
          verbose?: boolean
        }
        Returns: undefined
      }
      set_adaptive_chunking: {
        Args: {
          hypertable: unknown
          chunk_target_size: string
        }
        Returns: Record<string, unknown>
      }
      set_chunk_time_interval: {
        Args: {
          hypertable: unknown
          chunk_time_interval: unknown
          dimension_name?: unknown
        }
        Returns: undefined
      }
      set_integer_now_func: {
        Args: {
          hypertable: unknown
          integer_now_func: unknown
          replace_if_exists?: boolean
        }
        Returns: undefined
      }
      set_number_partitions: {
        Args: {
          hypertable: unknown
          number_partitions: number
          dimension_name?: unknown
        }
        Returns: undefined
      }
      set_partitioning_interval: {
        Args: {
          hypertable: unknown
          partition_interval: unknown
          dimension_name?: unknown
        }
        Returns: undefined
      }
      show_chunks: {
        Args: {
          relation: unknown
          older_than?: unknown
          newer_than?: unknown
          created_before?: unknown
          created_after?: unknown
        }
        Returns: unknown[]
      }
      show_tablespaces: {
        Args: {
          hypertable: unknown
        }
        Returns: unknown[]
      }
      time_bucket:
        | {
            Args: {
              bucket_width: number
              ts: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
              offset: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
              offset: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
              offset: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              offset: unknown
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              offset: unknown
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              offset: unknown
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              origin: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              origin: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              origin: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              timezone: string
              origin?: string
              offset?: unknown
            }
            Returns: string
          }
      time_bucket_gapfill:
        | {
            Args: {
              bucket_width: number
              ts: number
              start?: number
              finish?: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
              start?: number
              finish?: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: number
              ts: number
              start?: number
              finish?: number
            }
            Returns: number
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              start?: string
              finish?: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              start?: string
              finish?: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              start?: string
              finish?: string
            }
            Returns: string
          }
        | {
            Args: {
              bucket_width: unknown
              ts: string
              timezone: string
              start?: string
              finish?: string
            }
            Returns: string
          }
      timescaledb_post_restore: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      timescaledb_pre_restore: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string
          name: string
          owner: string
          metadata: Json
        }
        Returns: undefined
      }
      extension: {
        Args: {
          name: string
        }
        Returns: string
      }
      filename: {
        Args: {
          name: string
        }
        Returns: string
      }
      foldername: {
        Args: {
          name: string
        }
        Returns: string[]
      }
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>
        Returns: {
          size: number
          bucket_id: string
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
        }
        Returns: {
          key: string
          id: string
          created_at: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          start_after?: string
          next_token?: string
        }
        Returns: {
          name: string
          id: string
          metadata: Json
          updated_at: string
        }[]
      }
      operation: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      search: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

