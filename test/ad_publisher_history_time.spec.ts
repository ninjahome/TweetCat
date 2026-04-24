import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAdEscrowLedger = vi.fn();
const getCurrentXId = vi.fn();

const createCell = () => ({ textContent: '', innerHTML: '', style: {}, addEventListener: vi.fn(), classList: { add: vi.fn() } });
const createRow = () => ({
  classList: { add: vi.fn() },
  cells: {
    '.td-time': createCell(),
    '.td-name': createCell(),
    '.td-amount': createCell(),
    '.td-status': createCell(),
    '.td-txhash': createCell(),
    '.td-empty': createCell(),
  },
});

vi.mock('../src/popup/ads/ad_publisher_common', () => ({
  fetchAdEscrowLedger,
  getCurrentXId,
  publisherState: { historyRecharge: [] },
  adsWorkerFetch: vi.fn(),
  adsWorkerGet: vi.fn(),
  openTxInExplorer: vi.fn(),
}));

vi.mock('../src/common/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('../src/popup/common', () => ({
  $Id: vi.fn(),
  atomicToUsdcNumber: (v: string) => Number(v) / 1_000_000,
  cloneTemplate: vi.fn(() => createRow()),
  formatUSDC: vi.fn(),
  formatUSDCTrimmed: (n: number) => `${n} USDC`,
  hideLoading: vi.fn(),
  multiplyAtomic: vi.fn(),
  showLoading: vi.fn(),
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  usdcToAtomic: vi.fn(),
  formatTimeLocal: (value?: string | number) => {
    if (!value) return '-';
    let date: Date;
    if (typeof value === 'number') {
      date = new Date(value);
    } else {
      let isoStr = value.replace(' ', 'T');
      if (isoStr.length > 0 && !isoStr.includes('Z') && !isoStr.includes('+')) {
        isoStr += 'Z';
      }
      date = new Date(isoStr);
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  },
  $2: (row: any, selector: string) => row.cells[selector],
}));

describe('publisher transfer history time rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getCurrentXId.mockReturnValue('user_1');

    const tbody = {
      rows: [] as any[],
      replaceChildren: vi.fn(function () {
        this.rows = [];
      }),
      appendChild: vi.fn(function (row: any) {
        this.rows.push(row);
      }),
    };

    (globalThis as any).document = {
      querySelector: vi.fn(() => tbody),
    };
  });

  it('renders UTC ledger timestamps via the shared local-time formatter instead of raw Date parsing', async () => {
    fetchAdEscrowLedger.mockResolvedValue([
      {
        created_at: '2026-04-24 02:31:33',
        direction: 'DEPOSIT',
        amount_atomic: '1000000',
        status: 'SETTLED',
        tx_hash: '0xabc123',
      },
    ]);

    const mod = await import('../src/popup/ads/ad_publisher_dashboard');
    await mod.loadAndRenderTransferHistory();

    const tbody = (globalThis as any).document.querySelector.mock.results[0].value;
    const renderedRow = tbody.rows[0];
    expect(renderedRow.cells['.td-time'].textContent).toBe('2026-04-24 02:31:33');
  });
});
