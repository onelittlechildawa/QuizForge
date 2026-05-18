import app from '../server/app.js';

function cleanQueryString(url = '') {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return '';

  const params = new URLSearchParams(url.slice(queryStart + 1));
  params.delete('path');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export default function handler(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const rewritePath = req.query?.path || requestUrl.searchParams.get('path');
  if (rewritePath) {
    const path = Array.isArray(rewritePath) ? rewritePath.join('/') : rewritePath;
    req.url = `/api/${path}${cleanQueryString(req.url)}`;
  }
  return app(req, res);
}
