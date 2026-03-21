'use client';

import { FC } from 'react';
import { DashboardStatistics } from '@/lib/api';
import {
  CheckCircle2,
  XCircle,
  Activity,
  BarChart3,
  Target,
} from 'lucide-react';

interface StatisticsCardsProps {
  statistics: DashboardStatistics;
}

interface StatCard {
  label: string;
  value: string | number;
  icon: typeof CheckCircle2;
  color: string;
  bgColor: string;
  description?: string;
}

export const StatisticsCards: FC<StatisticsCardsProps> = ({ statistics }) => {
  const primaryCards: StatCard[] = [
    {
      label: 'Total Tests',
      value: statistics.totalTests,
      icon: BarChart3,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/30',
      description: 'Total number of test runs',
    },
    {
      label: 'Passed Tests',
      value: statistics.passedTests,
      icon: CheckCircle2,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/30',
      description: 'Tests with successful results',
    },
    {
      label: 'Failed Tests',
      value: statistics.failedTests,
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-900/30',
      description: 'Tests with failed results',
    },
    {
      label: 'Active Tests',
      value: statistics.activeTests,
      icon: Activity,
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-900/30',
      description: 'Currently running tests',
    },
    {
      label: 'SLO Compliance',
      value: `${statistics.sloComplianceRate}%`,
      icon: Target,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-900/30',
      description: 'Meeting service level objectives',
    },
  ];

  const renderCard = (card: StatCard, index: number) => {
    const Icon = card.icon;

    // Define gradient for each card type
    const gradients: Record<string, string> = {
      'text-blue-600': 'from-blue-500/10 via-blue-500/5 to-transparent',
      'text-green-600': 'from-green-500/10 via-green-500/5 to-transparent',
      'text-red-600': 'from-red-500/10 via-red-500/5 to-transparent',
      'text-orange-600': 'from-orange-500/10 via-orange-500/5 to-transparent',
      'text-purple-600': 'from-purple-500/10 via-purple-500/5 to-transparent',
    };

    const gradient = gradients[card.color] || 'from-gray-500/10 via-gray-500/5 to-transparent';

    return (
      <div
        key={index}
        className="relative overflow-hidden rounded-lg border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md"
      >
        {/* Gradient Background Accent */}
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient} pointer-events-none`} />

        {/* Content */}
        <div className="relative flex flex-col items-center text-center">
          {/* Icon */}
          <div className={`mb-4 inline-flex rounded-lg ${card.bgColor} p-3`}>
            <Icon className={`h-6 w-6 ${card.color}`} />
          </div>

          {/* Value */}
          <div className="mb-1">
            <div className="text-3xl font-bold text-foreground">{card.value}</div>
          </div>

          {/* Label */}
          <div className="mb-1 text-sm font-medium text-muted-foreground">{card.label}</div>

          {/* Description */}
          {card.description && (
            <div className="text-xs text-muted-foreground">{card.description}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Primary Stats - 5 cards in one row */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        {primaryCards.map((card, index) => renderCard(card, index))}
      </div>
    </div>
  );
};
