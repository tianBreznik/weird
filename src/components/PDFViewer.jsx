import './PDFViewer.css';

/**
 * PDFViewer - Wrapper component for desktop PDF-style page viewing
 * Provides scrollable container for multiple pages.
 *
 * The optional `zoom` prop controls a CSS custom property (`--pdf-zoom`)
 * that scales desktop page dimensions (see PDFViewer.css).
 */
export const PDFViewer = ({
  children,
  currentPage,
  totalPages,
  onPageChange,
  filename,
  zoom = 1,
}) => {
  const viewerStyle =
    typeof zoom === 'number' && zoom !== 1 ? { '--pdf-zoom': zoom } : undefined;

  return (
    <div className="pdf-viewer" style={viewerStyle}>
      <div className="pdf-viewer-container">
        {children}
      </div>
    </div>
  );
};

