import { useEffect, useRef, useState } from 'react';
import './FeatherCursor.css';

export const FeatherCursor = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768;
  });
  const cursorRef = useRef(null);
  const particlesRef = useRef([]);
  const lastParticleTimeRef = useRef(0);
  const mousePositionRef = useRef({ x: 0, y: 0 });
  const particleIdRef = useRef(0);

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

    const handleMouseMove = (e) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      
      // Update cursor position
      if (cursorRef.current) {
        cursorRef.current.style.left = `${e.clientX}px`;
        cursorRef.current.style.top = `${e.clientY}px`;
      }
      
      // Create particles periodically (throttle to avoid too many)
      const now = Date.now();
      if (now - lastParticleTimeRef.current > 30) { // Every 30ms (more particles)
        createParticle(e.clientX, e.clientY);
        lastParticleTimeRef.current = now;
      }
    };

    const handleMouseEnter = () => {
      if (cursorRef.current) {
        cursorRef.current.style.opacity = '1';
      }
    };

    const handleMouseLeave = () => {
      if (cursorRef.current) {
        cursorRef.current.style.opacity = '0';
      }
    };

    // Hide default cursor
    document.body.style.cursor = 'none';
    
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseenter', handleMouseEnter);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseenter', handleMouseEnter);
      document.removeEventListener('mouseleave', handleMouseLeave);
      
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
    return null;
  }

  return (
    <div 
      ref={cursorRef}
      className="feather-cursor"
      style={{
        left: `${mousePositionRef.current.x}px`,
        top: `${mousePositionRef.current.y}px`,
      }}
    />
  );
};

