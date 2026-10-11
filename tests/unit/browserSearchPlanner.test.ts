import { describe, expect, it } from 'vitest';
import { processChatRequest } from '../../backend/src/providers';

describe('deterministic browser search planning', () => {
  it('turns an informational web question into a Google search without provider inference', async () => {
    const response = await processChatRequest({ prompt: 'Who is the best footballer in the world?', language: 'en' });
    expect(response.actions).toEqual([
      { type: 'open_url', url: 'https://www.google.com' },
      { type: 'type_text', text: 'Who is the best footballer in the world', targetId: 'search' },
    ]);
    expect(response.costEstimate?.model).toBe('local-search-intent');
  });

  it('uses the current YouTube search field and replaces an earlier search query', async () => {
    const response = await processChatRequest({
      prompt: 'Search YouTube for Shaun the Sheep',
      language: 'en',
      pageContext: {
        url: 'https://www.youtube.com/results?search_query=Mr+Bean',
        domSummary: JSON.stringify({ searchFields: [{ id: 'search', name: 'search_query' }] }),
      },
    });
    expect(response.actions).toEqual([{ type: 'type_text', text: 'Shaun the Sheep', targetId: 'search' }]);
    expect(JSON.stringify(response.actions)).not.toContain('Mr Bean');
  });
});
