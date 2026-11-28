import type { Route } from 'playwright-core';

export function serveAppProviderMark(route: Route) {
  const { pathname } = new URL(route.request().url());
  if (/^\/app-provider-icons\/[a-z-]+\.(svg|jpg)$/.test(pathname)) {
    return route.fulfill({ path: `web/public${pathname}` });
  }
}
