import type { PlanDocument, PlanStep } from '@/shared/types';

/**
 * Rebuild step objects after the learner edits the plan outline, so the build
 * runs (and reports progress) against the plan they actually approved.
 */
export function parseOutline(plan: PlanDocument): PlanDocument {
  const lines = (plan.outline ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]?\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return plan;

  const steps: PlanStep[] = lines.slice(0, 16).map((line, index) => {
    const [title, ...rest] = line.split('—');
    const detail = rest.join('—').trim();
    const known = plan.steps.find((step) => step.title.toLowerCase() === title.trim().toLowerCase());
    return {
      id: `step-${index + 1}`,
      title: title.trim().slice(0, 200) || `Step ${index + 1}`,
      detail: detail.slice(0, 600),
      kind: known?.kind ?? inferKind(title),
    };
  });

  return { ...plan, steps };
}

function inferKind(title: string): PlanStep['kind'] {
  const value = title.toLowerCase();
  if (value.includes('analy')) return 'analyze';
  if (value.includes('extract') || value.includes('vocabul')) return 'extract';
  if (value.includes('duplicate') || value.includes('common') || value.includes('remov')) return 'filter';
  if (value.includes('prioritis') || value.includes('prioritiz') || value.includes('rank')) return 'prioritize';
  if (value.includes('group') || value.includes('topic')) return 'group';
  if (value.includes('vietnamese') || value.includes('translat')) return 'translate';
  if (value.includes('example')) return 'examples';
  if (value.includes('collocation')) return 'collocations';
  if (value.includes('difficulty') || value.includes('calibrat') || value.includes('relevance')) return 'calibrate';
  if (value.includes('build') || value.includes('card')) return 'build';
  if (value.includes('valid') || value.includes('check')) return 'validate';
  return 'custom';
}

export function stepsToOutline(steps: PlanStep[]): string {
  return steps
    .map((step, index) => `${index + 1}. ${step.title}${step.detail ? ` — ${step.detail}` : ''}`)
    .join('\n');
}
