import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from '../services/api';

describe('API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles successful API responses correctly', async () => {
    const mockHealth = { status: 'ok', service: 'fraudshield-ai-backend', phase: '1-synthetic' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockHealth,
    } as Response);

    const res = await api.getHealth();
    expect(res).toEqual(mockHealth);
    expect(global.fetch).toHaveBeenCalledWith(
      '/health',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('throws ApiError with extracted code and message on error responses', async () => {
    const errorBody = {
      error: {
        code: 'case_not_found',
        message: "Case 'FS-9999' not found.",
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => errorBody,
    } as Response);

    await expect(api.getCase('FS-9999')).rejects.toThrow(ApiError);
    await expect(api.getCase('FS-9999')).rejects.toMatchObject({
      code: 'case_not_found',
      message: "Case 'FS-9999' not found.",
    });
  });
});
