import { forwardRef } from 'react';
import './PDFViewer.css';
import { DesktopApertureFrame } from './DesktopApertureFrame';
import { desktopApertureShellPadding } from '../utils/desktopApertureBorderStyle';

/**
 * Desktop book reader: one page-sized aperture with glued pages scrolling inside.
 * Border frame crossfades from the active page’s chapter border settings.
 */
export const PDFViewer = forwardRef(function PDFViewer(
  { children, zoom = 1, frameBorder = null, paperTextureUrl = null },
  scrollRef
) {
  const frameOutset = desktopApertureShellPadding(frameBorder);
  const viewerStyle = {
    '--pdf-zoom': typeof zoom === 'number' ? zoom : 1,
    '--aperture-outset': `${frameOutset}px`,
    '--desktop-paper-color': '#e8e4dc',
    ...(paperTextureUrl ? { '--desktop-paper-url': `url(${paperTextureUrl})` } : {}),
  };

  return (
    <div className="pdf-viewer desktop-aperture-reader" style={viewerStyle}>
      <div className="desktop-aperture-stage">
        <div className="desktop-aperture-shell">
          <div className="desktop-aperture-viewport">
            <DesktopApertureFrame borderSpec={frameBorder} zoom={zoom} />
            <div className="desktop-aperture-scroll" ref={scrollRef}>
              <div className="desktop-pages-track">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

PDFViewer.displayName = 'PDFViewer';
