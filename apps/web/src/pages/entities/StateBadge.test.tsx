import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StateBadge } from './StateBadge';

describe('StateBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a readable text label, not only colour', () => {
    render(
      <>
        <StateBadge state="BLOCKED" />
        <StateBadge state="AT_RISK" />
        <StateBadge state="UNKNOWN" />
      </>,
    );

    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
