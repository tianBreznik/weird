import { useEffect, useRef } from 'react';

export const IsolatedButton = ({ label, onClick, variant = 'default', title }) => {
  const hostRef = useRef(null);
  const shadowRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return;
    if (!shadowRef.current) {
      shadowRef.current = hostRef.current.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host { display: inline-block; }
        button, button:*, button::* {
          all: initial;
          display: inline-block !important;
          box-sizing: border-box !important;
          padding: 2px 6px !important;
          border: 1px solid #cfcfcf !important;
          border-radius: 4px !important;
          background: #fff !important;
          cursor: pointer !important;
          font-family: Helvetica, Arial, sans-serif !important;
          font-size: 12px !important;
          line-height: 1 !important;
          font-weight: 400 !important;
          font-style: normal !important;
          color: #111 !important;
          text-decoration: none !important;
          outline: none !important;
          user-select: none !important;
          font-synthesis: none !important;
          -webkit-font-smoothing: antialiased !important;
          text-rendering: auto !important;
          text-shadow: none !important;
          -webkit-text-stroke: 0 !important;
          font-variant-ligatures: none !important;
          font-feature-settings: normal !important;
          letter-spacing: 0 !important;
          text-transform: none !important;
          filter: none !important;
          transform: none !important;
        }
        button:hover,
        button:focus,
        button:active,
        button:focus-visible,
        button:focus-within,
        button:visited,
        button:any-link {
          background: #fff !important;
          color: inherit !important;
          outline: none !important;
          border-radius: 4px !important;
          border-width: 1px !important;
          font-family: Helvetica, Arial, sans-serif !important;
          font-size: 12px !important;
          font-weight: 400 !important;
          font-style: normal !important;
          text-shadow: none !important;
          -webkit-text-stroke: 0 !important;
          font-variant-ligatures: none !important;
          letter-spacing: 0 !important;
          text-transform: none !important;
          filter: none !important;
          transform: none !important;
        }
        button svg {
          display: block !important;
          width: auto !important; /* let JS set exact width */
          height: 18px !important;
          max-width: 100% !important;
          overflow: visible !important;
          vertical-align: middle !important;
        }
        button svg text {
          font-family: Helvetica, Arial, sans-serif !important;
          font-size: 13px !important;
          font-weight: 400 !important;
        }
        button.edit { color: #111 !important; border-color: #cfcfcf !important; border-radius: 4px !important; background: #fff !important; }
        button.add { color: #0066cc !important; border-color: #a7c7e9 !important; border-radius: 4px !important; background: #fff !important; }
        button.del { color: #d33 !important; border-color: #d9a1a1 !important; border-radius: 4px !important; background: #fff !important; }
        button.edit:hover, button.edit:focus, button.edit:active { color: #111 !important; border-color: #cfcfcf !important; }
        button.add:hover, button.add:focus, button.add:active { color: #0066cc !important; }
        button.del:hover, button.del:focus, button.del:active { color: #d33 !important; }
      `;
      const btn = document.createElement('button');
      btn.className = variant === 'delete' ? 'del' : variant === 'add' ? 'add' : 'edit';
      if (title) btn.title = title;
      
      // Use SVG text contained within button
      const textWidth = label.length * 7; // tighter fallback width
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', `${textWidth}`);
      svg.setAttribute('height', '18');
      svg.setAttribute('viewBox', `0 0 ${textWidth} 18`);
      svg.style.display = 'inline-block';
      svg.style.width = `${textWidth}px`;
      svg.style.height = '18px';
      svg.style.verticalAlign = 'middle';
      svg.style.setProperty('height','18px','important');
      
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', `${textWidth / 2}`);
      text.setAttribute('y', '12');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
      text.setAttribute('font-size', '13');
      text.setAttribute('font-weight', '400');
      text.setAttribute('fill', variant === 'delete' ? '#d33' : variant === 'add' ? '#0066cc' : '#111');
      text.textContent = label;
      svg.appendChild(text);
      
      btn.appendChild(svg);
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.padding = '2px 6px';
      btn.style.setProperty('min-width','44px','important');

      // After mount, measure actual text width and size the svg precisely
      const sizeSvg = () => {
        try {
          const paddingX = 4; // px padding inside SVG
          const measured = Math.ceil(text.getComputedTextLength ? text.getComputedTextLength() : text.getBBox().width);
          const finalWidth = Math.max(measured + paddingX * 2, label.length * 7);
          svg.setAttribute('width', `${finalWidth}`);
          svg.setAttribute('viewBox', `0 0 ${finalWidth} 18`);
          svg.style.width = `${finalWidth}px`;
          text.setAttribute('x', `${finalWidth / 2}`);
        } catch {}
      };
      requestAnimationFrame(sizeSvg);
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick && onClick(e);
      });
      shadowRef.current.appendChild(style);
      shadowRef.current.appendChild(btn);
      
      // Lock ALL font properties inline - prevent ANY changes
      const lockStyles = () => {
        btn.style.setProperty('font-family', 'Helvetica, Arial, sans-serif', 'important');
        btn.style.setProperty('font-size', '12px', 'important');
        btn.style.setProperty('font-weight', '400', 'important');
        btn.style.setProperty('font-style', 'normal', 'important');
        btn.style.setProperty('letter-spacing', '0', 'important');
        btn.style.setProperty('text-shadow', 'none', 'important');
        btn.style.setProperty('-webkit-text-stroke', '0', 'important');
        btn.style.setProperty('font-variant-ligatures', 'none', 'important');
        btn.style.setProperty('text-transform', 'none', 'important');
        btn.style.setProperty('text-rendering', 'auto', 'important');
        btn.style.setProperty('-webkit-font-smoothing', 'antialiased', 'important');
        btn.style.setProperty('filter', 'none', 'important');
        btn.style.setProperty('transform', 'none', 'important');
      };
      
      lockStyles();
      
      // Lock styles on every state change
      ['mouseenter', 'mouseleave', 'focus', 'blur', 'mousedown', 'mouseup', 'click'].forEach(evt => {
        btn.addEventListener(evt, lockStyles, true);
      });
      
      // MutationObserver to prevent style changes
      const observer = new MutationObserver(() => {
        lockStyles();
      });
      observer.observe(btn, { attributes: true, attributeFilter: ['style', 'class'] });
    } else {
      const btn = shadowRef.current.querySelector('button');
      if (btn) {
        btn.className = variant === 'delete' ? 'del' : variant === 'add' ? 'add' : 'edit';
        if (title) btn.title = title;
        
        // Update SVG text
        const svg = btn.querySelector('svg');
        if (svg) {
          const text = svg.querySelector('text');
          if (text) {
            text.textContent = label;
            text.setAttribute('fill', variant === 'delete' ? '#d33' : variant === 'add' ? '#0066cc' : '#111');
            // Recompute true width after text change
            const paddingX = 4;
            const measured = Math.ceil(text.getComputedTextLength ? text.getComputedTextLength() : text.getBBox().width);
            const finalWidth = Math.max(measured + paddingX * 2, label.length * 7);
            svg.setAttribute('width', `${finalWidth}`);
            svg.setAttribute('viewBox', `0 0 ${finalWidth} 18`);
            svg.style.width = `${finalWidth}px`;
            text.setAttribute('x', `${finalWidth / 2}`);
          }
        }
      }
    }
  }, [label, onClick, variant, title]);

  return <span ref={hostRef} />;
};


