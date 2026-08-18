/**
 * Redirect somewhere on this site without having to name the site.
 *
 * `NextResponse.redirect()` demands an absolute URL, and the obvious way to
 * produce one — `new URL(path, req.url)` — asks the *server* for its own
 * address. Behind the reverse proxy that answer is the address the container
 * binds to, so a participant who clicked their study link was handed
 * `http://0.0.0.0:3000/study/session`: a host that means "every interface I
 * have" to the process that said it, and nothing at all to a browser on
 * another machine.
 *
 * `HOSTNAME=0.0.0.0` in the Dockerfile is not the mistake — it is how the
 * container accepts the proxy's connection in the first place. The mistake is
 * quoting it back to the outside world as if it were somewhere to go.
 *
 * A relative Location has no such question to get wrong. The browser resolves
 * it against the URL it actually requested, which is the public one by
 * definition, so this stays correct on localhost:3030, at swag.cs.vt.edu, and
 * behind a proxy that forwards no `X-Forwarded-*` headers at all. RFC 7231
 * §7.1.2 dropped the absolute-URI requirement in 2014, and browsers had
 * accepted relative redirects for years before that.
 *
 * Use this for anywhere on our own site. Links that leave the app — an address
 * pasted into an email, a share URL printed onto a page for someone to copy —
 * still need a real origin, because there is no request for a browser to
 * resolve them against.
 */
import { NextResponse } from 'next/server';

export function redirectTo(path: string, status = 307): NextResponse {
  // Same-site only. An "absolute" path is the whole point, and letting a
  // caller pass `//evil.example` — which browsers read as a protocol-relative
  // URL to another host — would turn any redirect built from user input into
  // an open redirect.
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`redirectTo expects a site-relative path, got: ${path}`);
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}
