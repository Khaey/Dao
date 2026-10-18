// Directory search state <-> URL query string (allowlisted, bounded). Purely presentational:
// the server still decides which professionals and which project context a user may see.

export type DirectoryFilters = { trade: string; zone: string; availability: string; type: string; rating: string };
export type DirectorySort = 'recent' | 'rating' | 'experience' | 'portfolio' | 'name';
export type DirectorySearch = { query: string; filters: DirectoryFilters; sort: DirectorySort };

export const emptyFilters: DirectoryFilters = { trade: '', zone: '', availability: '', type: '', rating: '' };
const SORTS: DirectorySort[] = ['recent', 'rating', 'experience', 'portfolio', 'name'];
const AVAILABILITY = ['now', 'soon', 'to_discuss'];
const RATINGS = ['3', '4'];
const MAX = 80;
const RETURN_KEY = 'dao.directory.return';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: string | null) => (value ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, MAX);

export function parseSearch(params: URLSearchParams, types: string[]): DirectorySearch {
  const availability = params.get('availability') ?? '';
  const type = params.get('type') ?? '';
  const rating = params.get('rating') ?? '';
  const sort = params.get('sort') as DirectorySort | null;
  return {
    query: text(params.get('q')),
    filters: {
      trade: text(params.get('trade')),
      zone: text(params.get('zone')),
      availability: AVAILABILITY.includes(availability) ? availability : '',
      type: types.includes(type) ? type : '',
      rating: RATINGS.includes(rating) ? rating : '',
    },
    sort: sort && SORTS.includes(sort) ? sort : 'recent',
  };
}

/** Project context kept only when both ids are well-formed UUIDs (the API re-checks access). */
export function projectContext(params: URLSearchParams) {
  const projectId = params.get('project_id'), requestId = params.get('request_id');
  return projectId && requestId && UUID.test(projectId) && UUID.test(requestId) ? { projectId, requestId } : null;
}

export function searchToParams(search: DirectorySearch, context: { projectId: string; requestId: string } | null) {
  const params = new URLSearchParams();
  if (context) { params.set('project_id', context.projectId); params.set('request_id', context.requestId); }
  if (search.query.trim()) params.set('q', search.query.trim().slice(0, MAX));
  for (const key of Object.keys(emptyFilters) as Array<keyof DirectoryFilters>) if (search.filters[key]) params.set(key, search.filters[key]);
  if (search.sort !== 'recent') params.set('sort', search.sort);
  return params;
}

export function hasSearch(params: URLSearchParams) {
  return ['q', 'trade', 'zone', 'availability', 'type', 'rating', 'sort'].some((key) => params.has(key));
}

// Per-tab memory used only when the user comes back through the profile's own "back to directory" link,
// which does not carry the search. Never stores ids other than the already-visible project context.
export function rememberForReturn(queryString: string) {
  try { sessionStorage.setItem(RETURN_KEY, queryString); } catch { /* storage unavailable: URL + Back still work */ }
}
export function takeReturn(): URLSearchParams | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return value ? new URLSearchParams(value) : null;
  } catch { return null; }
}
export function forgetReturn() { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ } }
