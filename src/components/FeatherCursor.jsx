import { useEffect, useRef, useState } from 'react';
import './FeatherCursor.css';

export const FeatherCursor = ({ children, hideCursor = false }) => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768;
  });
  const cursorRef = useRef(null);
  const particlesRef = useRef([]);
  const lastParticleTimeRef = useRef(0);
  const mousePositionRef = useRef({ x: 0, y: 0 }); // Target position
  const currentPositionRef = useRef({ x: 0, y: 0 }); // Displayed position (slightly behind for dampening)
  const animationFrameRef = useRef(null);
  const dampenFrameCountRef = useRef(0);
  const particleIdRef = useRef(0);
  const clickTimeoutRef = useRef(null);
  const lastCursorTargetRef = useRef(null);

  // Configurable tip offset - adjust these values to align the feather tip with cursor
  // Positive X moves right, positive Y moves down
  // These values will be fine-tuned to align the tip (bottom-left of feather) with cursor position
  const TIP_OFFSET_X = 15; // Adjust this to move tip left/right (in pixels)
  const TIP_OFFSET_Y = -5; // Adjust this to move tip up/down (in pixels)

  // Detect mobile/desktop
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Desktop: Track mouse movement and create trailing particles
  useEffect(() => {
    if (isMobile) return;

    // Preload feather image for Safari compatibility
    const preloadImg = new Image();
    preloadImg.src = '/feather.png';

    const buildTransform = (scale = 1) => {
      const baseTransform = 'translate(-50%, -50%)';
      const tipOffset = TIP_OFFSET_X !== 0 || TIP_OFFSET_Y !== 0 
        ? ` translate(${TIP_OFFSET_X}px, ${TIP_OFFSET_Y}px)`
        : '';
      return `${baseTransform}${tipOffset} scale(${scale}) translateZ(0)`;
    };

    const createParticle = (x, y) => {
      const particleId = `feather-${particleIdRef.current++}`;
      const particle = document.createElement('div');
      particle.className = 'feather-particle';
      particle.id = particleId;
      
      // Random size variation
      const size = 8 + Math.random() * 6; // 8-14px
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      
      // Random initial rotation
      const initialRotation = Math.random() * 360;
      
      // Random opacity
      const opacity = 0.3 + Math.random() * 0.4; // 0.3-0.7
      particle.style.opacity = opacity;
      particle.style.setProperty('--initial-opacity', opacity.toString());
      
      // Position
      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
      
      // Longer animation duration for gliding effect
      const duration = 2.5 + Math.random() * 1.5; // 2.5-4s (longer)
      particle.style.setProperty('--animation-duration', `${duration}s`);
      
      // Natural feather fall: truly varied horizontal drift (not binary)
      // Create organic path with continuous random variation
      const finalHorizontal = (Math.random() - 0.5) * 200; // -100 to +100px (fully random, not binary)
      
      const fallDistance = 200 + Math.random() * 150; // 200-350px downward
      
      // Oscillation parameters for wobbling
      const maxRotation = 25 + Math.random() * 15; // 25-40° max rotation
      const wobbleSpeed = 0.8 + Math.random() * 0.4; // 0.8-1.2s per wobble cycle
      
      particle.style.setProperty('--horizontal-end', `${finalHorizontal}px`);
      particle.style.setProperty('--fall-distance', `${fallDistance}px`);
      particle.style.setProperty('--max-rotation', `${maxRotation}deg`);
      particle.style.setProperty('--wobble-speed', `${wobbleSpeed}s`);
      particle.style.setProperty('--initial-rotation', `${initialRotation}deg`);
      
      document.body.appendChild(particle);
      particlesRef.current.push(particleId);
      
      // Remove particle after animation
      setTimeout(() => {
        const el = document.getElementById(particleId);
        if (el) {
          el.remove();
          particlesRef.current = particlesRef.current.filter(id => id !== particleId);
        }
      }, duration * 1000);
    };

    // Very slight dampening with a hard frame cap so the loop never runs indefinitely (prevents lag over time).
    const DAMPING = 0.45;
    const STOP_THRESHOLD = 0.5;
    const MAX_DAMPEN_FRAMES = 20; // Stop after 20 frames (~333ms) even if not at target

    const animateCursor = () => {
      if (!cursorRef.current) {
        animationFrameRef.current = null;
        return;
      }
      dampenFrameCountRef.current += 1;
      const targetX = mousePositionRef.current.x;
      const targetY = mousePositionRef.current.y;
      const currentX = currentPositionRef.current.x;
      const currentY = currentPositionRef.current.y;
      const newX = currentX + (targetX - currentX) * DAMPING;
      const newY = currentY + (targetY - currentY) * DAMPING;

      currentPositionRef.current = { x: newX, y: newY };
      cursorRef.current.style.left = `${newX}px`;
      cursorRef.current.style.top = `${newY}px`;

      const done =
        (Math.abs(newX - targetX) < STOP_THRESHOLD && Math.abs(newY - targetY) < STOP_THRESHOLD) ||
        dampenFrameCountRef.current >= MAX_DAMPEN_FRAMES;
      if (done) {
        currentPositionRef.current = { x: targetX, y: targetY };
        cursorRef.current.style.left = `${targetX}px`;
        cursorRef.current.style.top = `${targetY}px`;
        animationFrameRef.current = null;
        return;
      }
      animationFrameRef.current = requestAnimationFrame(animateCursor);
    };

    const handleMouseMove = (e) => {
      const x = e.clientX;
      const y = e.clientY;
      mousePositionRef.current = { x, y };

      if (currentPositionRef.current.x === 0 && currentPositionRef.current.y === 0) {
        currentPositionRef.current = { x, y };
        if (cursorRef.current) {
          cursorRef.current.style.left = `${x}px`;
          cursorRef.current.style.top = `${y}px`;
        }
      }

      if (cursorRef.current && !animationFrameRef.current) {
        dampenFrameCountRef.current = 0;
        animationFrameRef.current = requestAnimationFrame(animateCursor);
      }

      // When over the editor area: hide feather and show native cursor (toolbar, content, dialogs).
      // Otherwise: hide native cursor and show feather.
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const inEditor = target && (
        target.closest('.editor-overlay') ||
        target.closest('.karaoke-dialog-overlay')
      );
      if (cursorRef.current) {
        cursorRef.current.style.opacity = inEditor ? '0' : '1';
      }
      if (lastCursorTargetRef.current && lastCursorTargetRef.current !== target) {
        try {
          lastCursorTargetRef.current.style.removeProperty('cursor');
        } catch (_) {}
        lastCursorTargetRef.current = null;
      }
      if (!inEditor && target && target !== document.body && target !== document.documentElement) {
        target.style.setProperty('cursor', 'none', 'important');
        lastCursorTargetRef.current = target;
      }

      // Create particles only when outside editor (no particles over toolbar/dialogs/content)
      const now = Date.now();
      const maxParticles = 50;
      if (
        !inEditor &&
        now - lastParticleTimeRef.current > 30 &&
        particlesRef.current.length < maxParticles
      ) {
        createParticle(x, y);
        lastParticleTimeRef.current = now;
      }
    };

    // Show cursor immediately when mouse moves (Safari fix)
    let hasShownCursor = false;
    const handleMouseEnter = () => {
      if (cursorRef.current) {
        cursorRef.current.style.opacity = '1';
        hasShownCursor = true;
      }
    };

    const handleMouseLeave = () => {
      if (cursorRef.current) {
        cursorRef.current.style.opacity = '0';
      }
    };

    // Enhanced mouse move handler that shows cursor on first move
    const handleMouseMoveWithShow = (e) => {
      // Show cursor on first mouse move (Safari fix)
      if (!hasShownCursor && cursorRef.current) {
        cursorRef.current.style.opacity = '1';
        hasShownCursor = true;
      }
      handleMouseMove(e);
    };

    // Global click animation – fires on every real click anywhere on the page.
    // Purely visual: does NOT call preventDefault/stopPropagation.
    const handleButtonClick = () => {
      if (!cursorRef.current) return;

      // Run a quick scale-down-then-up animation
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }

      const downTransform = buildTransform(0.85);
      cursorRef.current.style.transform = downTransform;
      cursorRef.current.style.webkitTransform = downTransform;

      clickTimeoutRef.current = setTimeout(() => {
        if (!cursorRef.current) return;
        const upTransform = buildTransform(1);
        cursorRef.current.style.transform = upTransform;
        cursorRef.current.style.webkitTransform = upTransform;
      }, 130);
    };

    // Add class to body to trigger global cursor: none CSS rule
    document.body.classList.add('feather-cursor-active');
    
    window.addEventListener('mousemove', handleMouseMoveWithShow);
    // Use capture so we see the click before React/handlers stop propagation
    document.addEventListener('click', handleButtonClick, true);
    document.addEventListener('mouseenter', handleMouseEnter);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (lastCursorTargetRef.current) {
        try {
          lastCursorTargetRef.current.style.removeProperty('cursor');
        } catch (_) {}
        lastCursorTargetRef.current = null;
      }
      document.body.classList.remove('feather-cursor-active');
      window.removeEventListener('mousemove', handleMouseMoveWithShow);
      document.removeEventListener('click', handleButtonClick, true);
      document.removeEventListener('mouseenter', handleMouseEnter);
      document.removeEventListener('mouseleave', handleMouseLeave);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      // Clean up particles
      particlesRef.current.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      particlesRef.current = [];
    };
  }, [isMobile]);

  // Mobile: Create particles on touch
  useEffect(() => {
    if (!isMobile) return;

    const createTouchParticle = (x, y) => {
      // Create more particles per touch
      const particleCount = 5 + Math.floor(Math.random() * 5); // 5-10 particles
      
      for (let i = 0; i < particleCount; i++) {
        setTimeout(() => {
          const particleId = `feather-${particleIdRef.current++}`;
          const particle = document.createElement('div');
          particle.className = 'feather-particle feather-particle-mobile';
          particle.id = particleId;
          
          // Random size variation (slightly larger for visibility)
          const size = 8 + Math.random() * 6; // 8-14px (larger for visibility)
          particle.style.width = `${size}px`;
          particle.style.height = `${size}px`;
          
          // Random rotation
          const rotation = Math.random() * 360;
          particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
          
          // Lighter opacity on mobile (but still visible)
          const opacity = 0.4 + Math.random() * 0.4; // 0.4-0.8 (more visible)
          particle.style.opacity = opacity;
          particle.style.setProperty('--initial-opacity', opacity.toString());
          
          // Position with slight random offset
          const offsetX = (Math.random() - 0.5) * 30;
          const offsetY = (Math.random() - 0.5) * 30;
          particle.style.left = `${x + offsetX}px`;
          particle.style.top = `${y + offsetY}px`;
          
          // Longer animation duration for gliding effect
          const duration = 2 + Math.random() * 1.5; // 2-3.5s (longer on mobile too)
          particle.style.setProperty('--animation-duration', `${duration}s`);
          
          // Natural feather fall: truly varied horizontal drift (not binary)
          const finalHorizontal = (Math.random() - 0.5) * 150; // -75 to +75px (fully random, not binary)
          
          const fallDistance = 150 + Math.random() * 100; // 150-250px downward
          
          // Oscillation parameters for wobbling
          const maxRotation = 20 + Math.random() * 15; // 20-35° max rotation
          
          particle.style.setProperty('--horizontal-end', `${finalHorizontal}px`);
          particle.style.setProperty('--fall-distance', `${fallDistance}px`);
          particle.style.setProperty('--max-rotation', `${maxRotation}deg`);
          
          document.body.appendChild(particle);
          particlesRef.current.push(particleId);
          
          // Remove particle after animation
          setTimeout(() => {
            const el = document.getElementById(particleId);
            if (el) {
              el.remove();
              particlesRef.current = particlesRef.current.filter(id => id !== particleId);
            }
          }, duration * 1000);
        }, i * 20); // Stagger particles slightly
      }
    };

    const handleTouchStart = (e) => {
      // Only create particles on tap (not during scroll)
      const touch = e.touches[0];
      if (touch) {
        createTouchParticle(touch.clientX, touch.clientY);
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      
      // Clean up particles
      particlesRef.current.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      particlesRef.current = [];
    };
  }, [isMobile]);

  // Only render cursor element on desktop
  if (isMobile) {
    return <>{children}</>;
  }
  
  // Build initial transform with tip offset
  const buildInitialTransform = (scale = 1) => {
    const baseTransform = 'translate(-50%, -50%)'; // Rotation removed for testing
    const tipOffset = TIP_OFFSET_X !== 0 || TIP_OFFSET_Y !== 0 
      ? ` translate(${TIP_OFFSET_X}px, ${TIP_OFFSET_Y}px)`
      : '';
    return `${baseTransform}${tipOffset} scale(${scale}) translateZ(0)`;
  };
  
  return (
    <>
      <div 
        ref={cursorRef}
        className={`feather-cursor ${hideCursor ? 'feather-cursor-hidden' : ''}`}
        style={{
          left: `${mousePositionRef.current.x}px`,
          top: `${mousePositionRef.current.y}px`,
          transform: buildInitialTransform(1),
          WebkitTransform: buildInitialTransform(1),
        }}
      />
      {children}
    </>
  );
};
