/**
 * Hidden reader chrome mounted before first paint so mobile packing has real
 * sheet width + body height without a second “repack” pass.
 */
export function MobileGeometryProbe() {
  return (
    <div
      className="page-reader mobile-geometry-probe"
      aria-hidden
    >
      <div className="page-container">
        <article className="page-sheet content-page">
          <section className="page-body content-body">
            <div className="page-content page-content--canonical">
              <div className="page-content-main" />
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}
