import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  BlockersResponse,
  BlockingPathDto,
  HopDto,
  RootCauseCandidateDto,
  RootCauseResponse,
} from '@opsgraph/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockerCallout } from './BlockerCallout';
import { BlockersSection } from './BlockersSection';
import { R1_ORDER, R2_SHIPMENT, R4_NOT_BLOCKED } from './root-cause-test-data';
import {
  F1_BLOCKERS,
  F4_BLOCKERS,
  MANUAL_BASIS,
  ORDER_ID,
  SHP_ID,
  sentence,
} from './tracing-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const BLOCKERS_PATH = `/entities/${SHP_ID}/blockers`;

function renderWith(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Lets the mocked request resolve and React Query notify its observers. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

interface Responses {
  blockers: BlockersResponse | Error;
  rootCause: RootCauseResponse | Error;
}

/** Answers each request by its path suffix, so the callout's two queries get their own response. */
function respondWith(responses: Responses): void {
  apiFetchMock.mockImplementation((path: string) => {
    let answer: BlockersResponse | RootCauseResponse | Error = new Error(`Unexpected path ${path}`);
    if (path.endsWith('/blockers')) {
      answer = responses.blockers;
    } else if (path.endsWith('/root-cause')) {
      answer = responses.rootCause;
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

function firstCandidate(response: RootCauseResponse): RootCauseCandidateDto {
  const candidate = response.candidates[0];
  if (candidate === undefined) {
    throw new Error('fixture has no root-cause candidate');
  }
  return candidate;
}

function chainHops(candidate: RootCauseCandidateDto): HopDto[] {
  return candidate.primaryChain.steps.flatMap((step): HopDto[] =>
    step.hop === null ? [] : [step.hop],
  );
}

const R1_CANDIDATE = firstCandidate(R1_ORDER);
const R2_CANDIDATE = firstCandidate(R2_SHIPMENT);

/** The Order's blockers: its first path is R1's primary chain, with the same hop keys. */
const ORDER_PATH: BlockingPathDto = {
  hops: chainHops(R1_CANDIDATE),
  length: 3,
  weakestConfidence: 'HIGH',
  nonSourceHops: 0,
  continuesBeyondDepth: false,
  endsInCycle: false,
  explanation: R1_CANDIDATE.explanation.chain,
};

const ORDER_BLOCKERS: BlockersResponse = {
  ...F1_BLOCKERS,
  query: { ...F1_BLOCKERS.query, entityId: ORDER_ID },
  start: R1_ORDER.start,
  summary:
    'Order #18492 is BLOCKED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 3 steps away.',
  totalPaths: 1,
  paths: [ORDER_PATH],
  directBlockers: [],
  deepestBlockers: [],
};

/** The Order's blockers again, with only the first hop key changed: the key sequences differ. */
const ORDER_ONE_KEY_DIFFERENT: BlockersResponse = {
  ...ORDER_BLOCKERS,
  paths: [
    {
      ...ORDER_PATH,
      hops: ORDER_PATH.hops.map((hop, index) =>
        index === 0 ? { ...hop, key: 'dddddddd-dddd-4ddd-8ddd-000000000001' } : hop,
      ),
    },
  ],
};

/** The Shipment's blockers with the manually recorded BLOCKS path listed first. */
const MANUAL_FIRST: BlockersResponse = {
  ...F1_BLOCKERS,
  paths: [...F1_BLOCKERS.paths].reverse(),
};

const MANUAL_SENTENCE = `Shipment SHP-77120 (consolidated) is delayed because Payment PAY-88213, which is PENDING, blocks it (manually recorded, medium confidence: "${MANUAL_BASIS}").`;

describe('BlockerCallout', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the summary, the first path sentences and a link to the Blockers section', async () => {
    respondWith({ blockers: F1_BLOCKERS, rootCause: R4_NOT_BLOCKED });
    renderWith(<BlockerCallout entityId={SHP_ID} />);

    expect(await screen.findByText(F1_BLOCKERS.summary)).toBeInTheDocument();
    for (const text of F1_BLOCKERS.paths[0]?.explanation ?? []) {
      expect(screen.getByText(sentence(text))).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'See all blocking paths' })).toHaveAttribute(
      'href',
      '#blockers',
    );
  });

  it('renders nothing while loading, when nothing blocks, and on error', async () => {
    apiFetchMock.mockReturnValue(new Promise(() => undefined));
    const loading = renderWith(<BlockerCallout entityId={SHP_ID} />);
    expect(loading.container).toBeEmptyDOMElement();
    loading.unmount();

    respondWith({ blockers: F4_BLOCKERS, rootCause: R4_NOT_BLOCKED });
    const empty = renderWith(<BlockerCallout entityId={SHP_ID} />);
    await settle();
    expect(apiFetchMock.mock.calls.filter(([path]) => path === BLOCKERS_PATH)).toHaveLength(2);
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();

    apiFetchMock.mockRejectedValue(new Error('down'));
    const failed = renderWith(<BlockerCallout entityId={SHP_ID} />);
    await settle();
    expect(apiFetchMock.mock.calls.filter(([path]) => path === BLOCKERS_PATH)).toHaveLength(3);
    expect(failed.container).toBeEmptyDOMElement();
  });

  it('shares one request with the Blockers section', async () => {
    respondWith({ blockers: F1_BLOCKERS, rootCause: R4_NOT_BLOCKED });
    renderWith(
      <>
        <BlockerCallout entityId={SHP_ID} />
        <BlockersSection entityId={SHP_ID} />
      </>,
    );

    await screen.findAllByText(F1_BLOCKERS.summary);
    const blockerCalls = apiFetchMock.mock.calls.filter(([path]) => path === BLOCKERS_PATH);
    expect(blockerCalls).toHaveLength(1);
  });

  it('shows the root cause and its chain once when the first blocking path is the same chain', async () => {
    respondWith({ blockers: ORDER_BLOCKERS, rootCause: R1_ORDER });
    renderWith(<BlockerCallout entityId={ORDER_ID} />);

    expect(await screen.findByText(R1_ORDER.summary)).toBeInTheDocument();
    expect(screen.getByText(R1_CANDIDATE.explanation.headline)).toBeInTheDocument();
    for (const text of R1_CANDIDATE.explanation.chain) {
      expect(screen.getAllByText(sentence(text))).toHaveLength(1);
    }
    expect(screen.getByText(ORDER_BLOCKERS.summary)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See root cause' })).toHaveAttribute(
      'href',
      '#root-cause',
    );
    expect(screen.getByRole('link', { name: 'See all blocking paths' })).toHaveAttribute(
      'href',
      '#blockers',
    );
  });

  it('shows the path explanation as well when only one hop key differs from the root-cause chain', async () => {
    respondWith({ blockers: ORDER_ONE_KEY_DIFFERENT, rootCause: R1_ORDER });
    renderWith(<BlockerCallout entityId={ORDER_ID} />);

    expect(await screen.findByText(ORDER_ONE_KEY_DIFFERENT.summary)).toBeInTheDocument();
    // Once from the root-cause chain and once from the path explanation, which repeats it.
    for (const text of R1_CANDIDATE.explanation.chain) {
      expect(screen.getAllByText(sentence(text))).toHaveLength(2);
    }
  });

  it('shows both explanations when the first blocking path differs from the root-cause chain', async () => {
    respondWith({ blockers: MANUAL_FIRST, rootCause: R2_SHIPMENT });
    renderWith(<BlockerCallout entityId={SHP_ID} />);

    expect(await screen.findByText(R2_SHIPMENT.summary)).toBeInTheDocument();
    expect(screen.getByText(R2_CANDIDATE.explanation.headline)).toBeInTheDocument();
    for (const text of R2_CANDIDATE.explanation.chain) {
      expect(screen.getAllByText(sentence(text)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(MANUAL_FIRST.summary)).toBeInTheDocument();
    expect(screen.getByText(sentence(MANUAL_SENTENCE))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See root cause' })).toHaveAttribute(
      'href',
      '#root-cause',
    );
    expect(screen.getByRole('link', { name: 'See all blocking paths' })).toHaveAttribute(
      'href',
      '#blockers',
    );
  });

  it('still shows the blocker summary when the root-cause request fails', async () => {
    respondWith({ blockers: F1_BLOCKERS, rootCause: new Error('down') });
    renderWith(<BlockerCallout entityId={SHP_ID} />);

    expect(await screen.findByText(F1_BLOCKERS.summary)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See root cause' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See all blocking paths' })).toHaveAttribute(
      'href',
      '#blockers',
    );
  });

  it('still shows the root cause when the blockers request fails', async () => {
    respondWith({ blockers: new Error('down'), rootCause: R2_SHIPMENT });
    renderWith(<BlockerCallout entityId={SHP_ID} />);

    expect(await screen.findByText(R2_SHIPMENT.summary)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See root cause' })).toHaveAttribute(
      'href',
      '#root-cause',
    );
    expect(screen.queryByRole('link', { name: 'See all blocking paths' })).toBeNull();
  });
});
