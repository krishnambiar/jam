type SiteAssets = {
  fetch(request: Request): Promise<Response>;
};

type SiteEnvironment = {
  ASSETS: SiteAssets;
};

export default {
  async fetch(request: Request, environment: SiteEnvironment) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return Response.json({ detail: 'API endpoint not found' }, { status: 404 });
    }

    return environment.ASSETS.fetch(request);
  },
};
