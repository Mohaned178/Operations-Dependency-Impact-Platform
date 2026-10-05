import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OriginBadge } from './OriginBadge';

describe('OriginBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders distinct text for the three origins', () => {
    render(
      <>
        <OriginBadge origin="SOURCE" confidence="HIGH" />
        <OriginBadge origin="INFERRED" confidence="MEDIUM" />
        <OriginBadge origin="MANUAL" confidence="LOW" />
      </>,
    );

    expect(screen.getByText('Source · HIGH')).toBeInTheDocument();
    expect(screen.getByText('Inferred · MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('Manual · LOW')).toBeInTheDocument();
  });

  it('never labels INFERRED or MANUAL as Source', () => {
    render(
      <>
        <OriginBadge origin="INFERRED" confidence="MEDIUM" />
        <OriginBadge origin="MANUAL" confidence="MEDIUM" />
      </>,
    );

    expect(screen.getByText('Inferred · MEDIUM').textContent).not.toContain('Source');
    expect(screen.getByText('Manual · MEDIUM').textContent).not.toContain('Source');
    expect(screen.queryByText('Source · MEDIUM')).not.toBeInTheDocument();
  });
});
