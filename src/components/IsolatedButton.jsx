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
        :host {
          display: inline-block !important;
          cursor: pointer !important;
        }
        button {
          all: unset;
          cursor: pointer !important;
          position: relative;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 14px !important;
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
          transition: transform 200ms ease !important;
        }
        button::after {
          content: none !important;
        }
        button:hover,
        button:focus-visible {
          box-shadow: none !important;
        }
        .button-inner {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 9px !important;
          padding: 0.35em 0.25em !important;
          width: 32px !important;
          min-width: 32px !important;
          max-width: 32px !important;
          background-image: linear-gradient(135deg, rgba(240,240,242,1), rgba(210,210,214,1)) !important;
          box-shadow:
            inset -0.05em -0.05em 0.05em rgba(5,5,5,0.3),
            inset 0 0 0.04em 0.18em rgba(255,255,255,0.26),
            inset 0.024em 0.05em 0.1em rgba(255,255,255,0.98),
            inset 0.12em 0.12em 0.12em rgba(255,255,255,0.28),
            inset -0.07em -0.2em 0.2em 0.08em rgba(5,5,5,0.22) !important;
          transition: box-shadow 220ms ease, transform 200ms ease, background-image 200ms ease !important;
        }
        button:hover .button-inner,
        button:focus-visible .button-inner {
          box-shadow:
            inset 0.055em 0.1em 0.038em rgba(5,5,5,0.66),
            inset -0.018em -0.02em 0.035em rgba(5,5,5,0.44),
            inset 0.15em 0.15em 0.11em rgba(5,5,5,0.38),
            inset 0 0 0.026em 0.28em rgba(255,255,255,0.18) !important;
        }
        button:active .button-inner {
          transform: scale(0.97) !important;
        }
        .button-label-svg {
          display: block !important;
          position: relative !important;
          z-index: 2 !important;
          width: 100% !important;
          height: 12px !important;
          pointer-events: none !important;
          flex-shrink: 0 !important;
        }
        button:hover .button-label-svg,
        button:focus-visible .button-label-svg {
          transform: scale(0.978) !important;
        }
        button.add .button-inner { background-image: linear-gradient(135deg, rgba(236,241,250,1), rgba(214,222,242,1)) !important; }
        button.del .button-inner { background-image: linear-gradient(135deg, rgba(253,244,245,1), rgba(242,215,218,1)) !important; }
      `;
      const btn = document.createElement('button');
      btn.className = variant === 'delete' ? 'del' : variant === 'add' ? 'add' : 'edit';
      if (title) btn.title = title;
      
      const inner = document.createElement('div');
      inner.className = 'button-inner';

      // Create SVG text element - fixed width for all buttons
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'button-label-svg');
      const fixedWidth = 32; // Fixed width for all buttons
      svg.setAttribute('width', `${fixedWidth}`);
      svg.setAttribute('height', '12');
      svg.setAttribute('viewBox', `0 0 ${fixedWidth} 12`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.display = 'block';
      
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(fixedWidth / 2));
      text.setAttribute('y', '9');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '600');
      text.setAttribute('letter-spacing', '0.12');
      text.setAttribute('fill', variant === 'delete' ? 'rgba(158,58,64,0.9)' : variant === 'add' ? 'rgba(48,84,156,0.9)' : 'rgba(30,30,36,0.96)');
      text.textContent = label;
      
      svg.appendChild(text);
      inner.appendChild(svg);

      btn.appendChild(inner);
      btn.style.setProperty('cursor', 'pointer', 'important');
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick && onClick(e);
      });
      shadowRef.current.appendChild(style);
      shadowRef.current.appendChild(btn);
      
      // Lock ALL font properties inline - prevent ANY changes
      const lockStyles = () => {
        btn.style.setProperty('cursor', 'pointer', 'important');
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
        const svg = btn.querySelector('.button-label-svg');
        if (svg) {
          const text = svg.querySelector('text');
          if (text) {
            text.textContent = label;
            text.setAttribute('fill', variant === 'delete' ? 'rgba(158,58,64,0.9)' : variant === 'add' ? 'rgba(48,84,156,0.9)' : 'rgba(30,30,36,0.96)');
            // Fixed width for all buttons
            const fixedWidth = 32;
            svg.setAttribute('width', `${fixedWidth}`);
            svg.setAttribute('viewBox', `0 0 ${fixedWidth} 12`);
            text.setAttribute('x', String(fixedWidth / 2));
          }
        }
      }
    }
  }, [label, onClick, variant, title]);

  return <span ref={hostRef} />;
};


