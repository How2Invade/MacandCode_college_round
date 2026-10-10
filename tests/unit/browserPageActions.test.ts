import { beforeEach, describe, expect, it } from 'vitest';
import { executePageAction } from '../../src/content';

describe('page actions use live DOM evidence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Fixture page';
    window.history.replaceState({}, '', '/fixture');
  });

  it('reads visible text and useful controls from the current page', async () => {
    document.body.innerHTML = `
      <h1>Search results</h1><p>First result is a useful page.</p>
      <form role="search"><input type="search" name="q" placeholder="Search"></form>
      <a href="/first">First result</a><button>Next page</button>`;

    const result = await executePageAction({ type: 'read_page' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      title: 'Fixture page',
      headings: ['Search results'],
      links: [{ text: 'First result', url: expect.stringContaining('/first') }],
      buttons: ['Next page'],
      searchFields: [{ name: 'q', placeholder: 'Search' }],
    });
    expect((result.data as { text: string }).text).toContain('First result is a useful page.');
  });

  it('types into the intended visible input and verifies the value', async () => {
    document.body.innerHTML = '<label for="email">Email address</label><input id="email" name="email">';

    const result = await executePageAction({ type: 'type_text', targetId: 'email', text: 'person@example.com' });
    expect(result.success).toBe(true);
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('person@example.com');
    expect(result.data).toMatchObject({ value: 'person@example.com' });
  });

  it('submits a search through the actual search form and verifies updated results', async () => {
    document.body.innerHTML = `
      <form role="search"><input type="search" name="q" placeholder="Search"></form>
      <main id="results">Old results</main>`;
    const form = document.querySelector('form')!;
    const input = document.querySelector('input') as HTMLInputElement;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      document.getElementById('results')!.textContent = `Results for ${input.value}`;
    });

    const result = await executePageAction({ type: 'type_text', targetId: 'search', text: 'best footballer in the world' });
    expect(result.success).toBe(true);
    expect(result.message).toContain('verified');
    expect(document.getElementById('results')!.textContent).toBe('Results for best footballer in the world');
    expect(result.data).toMatchObject({ value: 'best footballer in the world', searchSubmitted: true, pageChanged: true });
  });

  it('clicks a matching visible result and verifies the page changed', async () => {
    document.body.innerHTML = '<a id="first" href="/watch?v=first">First video</a><main>Search results</main>';
    document.getElementById('first')!.addEventListener('click', (event) => {
      event.preventDefault();
      window.history.pushState({}, '', '/watch?v=first');
      document.querySelector('main')!.textContent = 'Video is now open';
    });

    const result = await executePageAction({ type: 'click_element', targetId: 'First video' });
    expect(result.success).toBe(true);
    expect((result.data as { pageChanged: boolean }).pageChanged).toBe(true);
    expect((result.data as { expectedUrl: string }).expectedUrl).toContain('/watch?v=first');
    expect(window.location.pathname).toBe('/watch');
    expect(document.querySelector('main')!.textContent).toBe('Video is now open');
  });

  it('fails when a requested target cannot be uniquely found', async () => {
    document.body.innerHTML = '<button>Same</button><button>Same</button>';
    const result = await executePageAction({ type: 'click_element', targetId: 'Same' });
    expect(result.success).toBe(false);
  });
});
