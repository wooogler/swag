/**
 * Everything a participant sees inside a session hangs off this route, so this
 * is where the study's larger type scale is switched on (globals.css). The
 * facilitator console under /study/admin is left out on purpose — it is a
 * researcher's table, not a participant's screen.
 *
 * `contents` keeps the wrapper from generating a box of its own: the screens
 * below it use h-screen and min-h-screen and have to keep measuring against
 * the viewport, not against a div that has appeared over them.
 */
export default function StudySessionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-study-scale className="contents">
      {children}
    </div>
  );
}
